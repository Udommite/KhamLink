import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, select, text
from starlette.exceptions import HTTPException

from .config import ROOT, Settings
from .db import AuditEvent, Feedback, QualityIssue, TelemetryEvent, make_engine, sessions
from .domain import (
    CompareRequest,
    ContextRequest,
    ContextSelection,
    DomainError,
    EventRequest,
    ExplanationRequest,
    FeedbackRequest,
    ReviewRequest,
    SearchRequest,
    validate_text,
)
from .grounding import GroundingService
from .ingestion import IngestionService, acquire
from .observability import PRODUCT_EVENTS, Telemetry
from .providers import generation_provider
from .repository import SQLLexicalRepository
from .retrieval import IndexBuilder, SearchService
from .review import ReviewService
from .security import RateLimiter, Security
from .services import ComparisonService, ContextService, FeedbackService

GENERIC_SOURCE_NOTICE = "ความหมายทั้งหมดมาจากชุดข้อมูลที่เผยแพร่ ตรวจสอบแหล่งข้อมูลได้จากทุกความหมาย"


def configured_source(settings: Settings) -> dict | None:
    """The manifest this deployment is configured for, or None if it cannot be read."""
    from .ingestion import approved_manifest

    try:
        return approved_manifest(settings)
    except Exception:
        return None


def source_notice(settings: Settings) -> str:
    """What the interface tells readers about the data. Taken from the configured source
    so the claim can never drift from the corpus actually being served."""
    manifest = configured_source(settings)
    if not manifest:
        return GENERIC_SOURCE_NOTICE
    if manifest.get("notice"):
        return manifest["notice"]
    origin = "เป็นพจนานุกรมทางการของสำนักงานราชบัณฑิตยสภา"
    if manifest.get("official_royal_society") is False:
        origin = "ไม่ใช่พจนานุกรมทางการของสำนักงานราชบัณฑิตยสภา"
    return f"ข้อมูลจาก {manifest['name']} {origin}"


def source_label(settings: Settings) -> str:
    """Short attribution for the page footer."""
    manifest = configured_source(settings)
    return f"{manifest['name']} · {manifest['license']}" if manifest else ""


def ingestion_service(settings: Settings, factory, security):
    """The staging path that matches the configured corpus shape."""
    from .rid import CORPUS_FORMAT, RIDIngestionService

    manifest = configured_source(settings)
    service = RIDIngestionService if (manifest or {}).get("format") == CORPUS_FORMAT else IngestionService
    return service(settings, factory, security)


def embedding_identity_for_display(settings: Settings) -> str | None:
    if settings.embedding == "qwen":
        return settings.embedding_model
    if settings.embedding == "bge-m3":
        return settings.bge_model
    return None


def create_app(settings: Settings | None = None, provider=None) -> FastAPI:
    settings = settings or Settings()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = make_engine(settings.database_url)
    factory = sessions(engine)
    security, telemetry = Security(settings, factory), Telemetry(settings, factory)
    repository = SQLLexicalRepository(factory)
    search = SearchService(settings, repository, factory, telemetry)
    generator = provider or generation_provider(settings)
    grounding = GroundingService(settings, repository, generator, telemetry)
    comparisons = ComparisonService(repository, grounding)
    context = ContextService(settings, repository, search, grounding)
    feedback = FeedbackService(settings, factory, security, repository)
    reviewer = ReviewService(settings, repository, search, context, telemetry)
    ingestion = ingestion_service(settings, factory, security)
    limiter = RateLimiter(settings)

    @asynccontextmanager
    async def lifespan(_app):
        telemetry.start()
        yield
        telemetry.close()
        grounding.executor.shutdown(wait=False, cancel_futures=True)
        if search.adapter is not None and hasattr(search.adapter.embedding, "close"):
            search.adapter.embedding.close()
        if hasattr(generator, "client"):
            generator.client.close()
        engine.dispose()

    app = FastAPI(
        title="KhamLink API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.environment != "production" else None,
    )
    if settings.environment != "production":
        from .api_docs import STYLES, render

        @app.get("/api/docs", response_class=HTMLResponse, include_in_schema=False)
        def api_reference():
            return render(app.openapi())

        @app.get("/api/docs/styles.css", include_in_schema=False)
        def api_reference_styles():
            return Response(STYLES, media_type="text/css")

    for name, value in {
        "settings": settings,
        "engine": engine,
        "sessions": factory,
        "repository": repository,
        "search": search,
        "grounding": grounding,
        "telemetry": telemetry,
        "security": security,
        "limiter": limiter,
        "context": context,
        "ingestion": ingestion,
    }.items():
        setattr(app.state, name, value)

    def failure(request, error):
        headers = {"Retry-After": "60"} if error.status == 429 else {}
        return JSONResponse(
            {
                "data": None,
                "meta": {"correlation_id": request.state.correlation_id},
                "error": {
                    "code": error.code,
                    "message": error.message,
                    "fields": error.fields,
                    "correlation_id": request.state.correlation_id,
                },
            },
            status_code=error.status,
            headers=headers,
        )

    @app.middleware("http")
    async def boundaries(request, call_next):
        request.state.correlation_id = str(uuid.uuid4())
        start = time.monotonic()
        try:
            if settings.environment == "production" and request.url.scheme != "https":
                raise DomainError("TLS_REQUIRED", "การเชื่อมต่อต้องใช้ HTTPS", 400)
            if request.url.path.startswith("/api"):
                path = request.url.path
                cost = (
                    "feedback"
                    if path.endswith("feedback") or path.endswith("events")
                    else "costly"
                    if any(
                        segment in path
                        for segment in ("search", "explanations", "context", "compare", "/admin/")
                    )
                    else "lookup"
                )
                limiter.check(request.client.host if request.client else "unknown", cost)
                if request.method in {"POST", "PUT", "PATCH"}:
                    if not request.headers.get("content-type", "").lower().startswith("application/json"):
                        raise DomainError("JSON_REQUIRED", "กรุณาส่งข้อมูลในรูปแบบ JSON", 400)
                    content_length = request.headers.get("content-length")
                    if content_length and (
                        not content_length.isdigit() or int(content_length) > settings.body_limit
                    ):
                        raise DomainError("BODY_TOO_LARGE", "คำขอมีขนาดใหญ่เกินกำหนด", 413)
                    size = 0
                    chunks = []
                    async for chunk in request.stream():
                        size += len(chunk)
                        if size > settings.body_limit:
                            raise DomainError("BODY_TOO_LARGE", "คำขอมีขนาดใหญ่เกินกำหนด", 413)
                        chunks.append(chunk)
                    request._body = b"".join(chunks)
            response = await call_next(request)
        except DomainError as error:
            response = failure(request, error)
        except Exception:
            response = failure(
                request, DomainError("SERVICE_UNAVAILABLE", "ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้ง", 503)
            )
        route = request.scope.get("route")
        route_template = getattr(route, "path", "unmatched")
        telemetry.emit(
            "request",
            request.state.correlation_id,
            {
                "route": route_template,
                "method": request.method,
                "http_status": response.status_code,
                "status": "ok" if response.status_code < 400 else "failed",
            },
            (time.monotonic() - start) * 1000,
        )
        response.headers.update(
            {
                "X-Correlation-ID": request.state.correlation_id,
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "X-Frame-Options": "DENY",
                "Cache-Control": "no-store",
                "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
            }
        )
        if settings.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if response.headers.get("content-type") == "application/json":
            response.headers["content-type"] = "application/json; charset=utf-8"
        return response

    @app.exception_handler(DomainError)
    async def domain_handler(request, error):
        return failure(request, error)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request, error):
        fields = [
            ".".join(str(p) for p in item["loc"] if isinstance(p, (str, int))) for item in error.errors()
        ][:10]
        return failure(request, DomainError("INVALID_REQUEST", "ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบช่องที่ระบุ", 400, fields))

    @app.exception_handler(HTTPException)
    async def http_handler(request, error):
        return failure(
            request,
            DomainError(
                "NOT_FOUND" if error.status_code == 404 else "HTTP_ERROR",
                "ไม่พบรายการหรือไม่รองรับคำขอนี้",
                error.status_code,
            ),
        )

    def result(request, data):
        return {"data": data, "meta": {"correlation_id": request.state.correlation_id}, "error": None}

    def target(data, kind, key, dataset_id):
        data["feedback_target"] = security.target_token(kind, key, dataset_id)
        return data

    def auth(request, action, resource_id=None):
        bearer = request.headers.get("authorization", "")
        try:
            principal = security.authenticate(bearer[7:] if bearer.startswith("Bearer ") else None)
            security.authorize(principal, action, request.state.correlation_id, resource_id)
            return principal
        except DomainError:
            telemetry.emit("authorization", request.state.correlation_id, {"status": "denied"})
            raise

    @app.get("/api/config")
    def public_config(request: Request):
        return result(
            request,
            {
                "query_limit": settings.query_limit,
                "context_limit": settings.context_limit,
                "report_limit": settings.report_limit,
                "page_limit": settings.page_limit,
                "map_limit": settings.map_limit,
                "provider_mode": settings.provider,
                "llm_model": settings.provider_model if settings.provider in {"glm", "compatible"} else None,
                "embedding_model": embedding_identity_for_display(settings),
                # Query expansion sends the reader's own words to the provider, so it counts
                # as remote processing even when the embeddings themselves are local.
                "remote_processing": settings.embedding == "qwen"
                or settings.provider in {"glm", "compatible"}
                or settings.query_expansion,
                "analytics_enabled": settings.analytics_enabled,
                "retention_days": settings.retention_days,
                "free_text_reports": False,
                "source_notice": source_notice(settings),
                "source_label": source_label(settings),
            },
        )

    @app.get("/health")
    def health(request: Request):
        return result(request, {"status": "alive"})

    @app.get("/ready")
    def ready(request: Request):
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        release = repository.release()
        return result(
            request,
            {
                "status": "ready",
                "lexical": "available",
                "semantic": "configured" if release["index_id"] and settings.semantic_enabled else "degraded",
                "generation": settings.provider,
            },
        )

    def do_search(request, payload):
        query = validate_text(payload.query, settings.query_limit)
        if not 1 <= payload.limit <= settings.page_limit or not 0 <= payload.offset <= 100:
            raise DomainError("INVALID_PAGE", "จำนวนผลลัพธ์หรือหน้าที่ขอไม่ถูกต้อง", fields=["limit", "offset"])
        telemetry.emit("search_submitted", request.state.correlation_id, {"length": len(query)}, product=True)
        found = search.search(query, payload.limit, payload.offset, request.state.correlation_id)
        return result(
            request, target(found, "search", request.state.correlation_id, found["release"]["dataset_id"])
        )

    @app.post("/api/search")
    def search_post(request: Request, payload: SearchRequest):
        return do_search(request, payload)

    @app.get("/api/search")
    def search_get(request: Request, q: str, limit: int = 10, offset: int = 0):
        return do_search(request, SearchRequest(query=q, limit=limit, offset=offset))

    @app.get("/api/words/{key}")
    def word_lookup(request: Request, key: str):
        validate_text(key, 512, "word")
        word = repository.lookup(key)
        return result(request, target(word, "word", word["word_id"], word["dataset_id"]))

    @app.get("/api/words/{key}/related")
    def related(request: Request, key: str):
        validate_text(key, 512, "word")
        related_data = repository.related(key, settings.map_limit)
        # Model-derived neighbours ride alongside the source map, never inside it: the map
        # shows only relationships the dictionary itself declares.
        related_data["semantic_neighbours"] = []
        related_data["semantic_neighbours_state"] = "unavailable"
        try:
            neighbours = search.load_adapter(repository.release()).neighbours
            word = repository.lookup(related_data["center"]["word_id"], related_data["dataset_id"])
            related_data["semantic_neighbours"] = neighbours(
                [d["definition_id"] for d in word["definitions"]], settings.map_limit
            )
            related_data["semantic_neighbours_state"] = "available"
        except Exception:
            telemetry.emit(
                "dependency",
                request.state.correlation_id,
                {"dependency": "neighbours", "status": "failed"},
            )
        return result(
            request,
            target(related_data, "map", related_data["center"]["word_id"], related_data["dataset_id"]),
        )

    @app.get("/api/sources/{dataset_id}")
    def sources(request: Request, dataset_id: str):
        return result(request, repository.source(dataset_id))

    @app.get("/api/evidence/{definition_id}")
    def evidence(request: Request, definition_id: str):
        return result(request, repository.evidence(definition_id))

    @app.post("/api/explanations")
    def explain(request: Request, payload: ExplanationRequest):
        word = repository.lookup(payload.word_id)
        if payload.definition_id and payload.definition_id not in {
            d["definition_id"] for d in word["definitions"]
        }:
            raise DomainError("INVALID_SENSE", "ความหมายที่เลือกไม่ตรงกับคำนี้")
        data = grounding.explain(
            [word],
            request.state.correlation_id,
            sense_ids=[payload.definition_id] if payload.definition_id else None,
        )
        return result(
            request,
            target(data, "explanation", data.get("explanation_id", word["word_id"]), word["dataset_id"]),
        )

    @app.post("/api/compare")
    def compare(request: Request, payload: CompareRequest):
        data = comparisons.compare(payload.word_ids)
        if data["words"]:
            target(data, "comparison", "cmp_" + request.state.correlation_id, data["words"][0]["dataset_id"])
        return result(request, data)

    @app.post("/api/compare/explanations")
    def compare_explain(request: Request, payload: CompareRequest):
        data = comparisons.compare(payload.word_ids)
        if data["errors"]:
            return result(request, grounding.fallback("empty"))
        explanation = grounding.explain(data["words"], request.state.correlation_id, task="compare")
        return result(
            request,
            target(
                explanation,
                "comparison_explanation",
                explanation.get("explanation_id", "cmp_" + request.state.correlation_id),
                data["words"][0]["dataset_id"],
            ),
        )

    @app.post("/api/review")
    def review_document(request: Request, payload: ReviewRequest):
        text = validate_text(payload.text, settings.context_limit, "text")
        if payload.formality not in {"formal", "neutral", "casual"}:
            raise DomainError("INVALID_GOAL", "ระดับภาษาที่เลือกไม่รองรับ", fields=["formality"])
        data = reviewer.review(text, payload.formality, request.state.correlation_id)
        return result(request, data)

    @app.post("/api/context")
    def detect_context(request: Request, payload: ContextRequest):
        validate_text(payload.text, settings.context_limit, "text")
        telemetry.emit(
            "context_analysis_requested",
            request.state.correlation_id,
            {"length": len(payload.text)},
            product=True,
        )
        return result(request, context.detect(payload.text))

    @app.post("/api/context/explanations")
    def context_explain(request: Request, payload: ContextSelection):
        validate_text(payload.text, settings.context_limit, "text")
        data = context.explain(payload, request.state.correlation_id)
        return result(
            request,
            target(data, "context", "ctx_" + request.state.correlation_id, data["word"]["dataset_id"]),
        )

    @app.post("/api/feedback", status_code=201)
    def submit_feedback(request: Request, payload: FeedbackRequest):
        data = feedback.submit(payload)
        name = (
            "feedback_positive"
            if payload.rating == "useful"
            else "feedback_negative"
            if payload.rating
            else "result_reported"
        )
        telemetry.emit(name, request.state.correlation_id, {"target_id": data["feedback_id"]}, product=True)
        return result(request, data)

    @app.post("/api/events", status_code=202)
    def event_capture(request: Request, payload: EventRequest):
        if payload.name not in PRODUCT_EVENTS:
            raise DomainError("INVALID_EVENT", "ไม่รองรับเหตุการณ์นี้")
        telemetry.emit(payload.name, request.state.correlation_id, payload.refs, product=True)
        return result(request, {"accepted": True, "enabled": settings.analytics_enabled})

    @app.get("/api/admin/metrics")
    def metrics(request: Request):
        auth(request, "metrics")
        snapshot = telemetry.snapshot()
        try:
            search.load_adapter(repository.release())
            snapshot["semantic_health"] = "available"
        except Exception:
            snapshot["semantic_health"] = "degraded"
            snapshot["alerts"].append("semantic_unavailable")
        snapshot["generation"] = {
            "mode": settings.provider,
            "circuit_open": getattr(generator, "open_until", 0) > time.monotonic(),
        }
        return result(request, snapshot)

    @app.get("/api/admin/analytics")
    def analytics(request: Request):
        auth(request, "analytics")
        with factory() as session:
            counts = session.execute(
                select(TelemetryEvent.name, func.count()).group_by(TelemetryEvent.name)
            ).all()
            return result(
                request,
                {
                    "events": dict(counts),
                    "ratings": dict(
                        session.execute(
                            select(Feedback.rating, func.count())
                            .where(Feedback.rating.is_not(None))
                            .group_by(Feedback.rating)
                        ).all()
                    ),
                },
            )

    @app.get("/api/admin/reports")
    def reports(request: Request):
        auth(request, "reports")
        with factory() as session:
            rows = session.scalars(
                select(Feedback)
                .where(Feedback.reason.is_not(None))
                .order_by(Feedback.created_at.desc())
                .limit(100)
            ).all()
            return result(
                request,
                [
                    {
                        "id": row.id,
                        "target_id": row.target_id,
                        "reason": row.reason,
                        "created_at": row.created_at,
                        "provenance": row.provenance,
                    }
                    for row in rows
                ],
            )

    @app.get("/api/admin/audit")
    def audit(request: Request):
        auth(request, "logs")
        with factory() as session:
            rows = session.scalars(select(AuditEvent).order_by(AuditEvent.id.desc()).limit(100)).all()
            return result(
                request,
                [
                    {
                        "actor": r.actor,
                        "action": r.action,
                        "outcome": r.outcome,
                        "occurred_at": r.occurred_at,
                        "correlation_id": r.correlation_id,
                        "resource_id": r.resource_id,
                    }
                    for r in rows
                ],
            )

    @app.get("/api/admin/quality/{dataset_id}")
    def quality(request: Request, dataset_id: str):
        auth(request, "quality", dataset_id)
        with factory() as session:
            rows = session.scalars(
                select(QualityIssue).where(QualityIssue.dataset_id == dataset_id).limit(1000)
            ).all()
            return result(request, [{"row_number": row.row_number, "code": row.code} for row in rows])

    @app.post("/api/admin/imports")
    def import_source(request: Request):
        principal = auth(request, "import")
        data = ingestion.stage(acquire(settings), principal, request.state.correlation_id)
        return result(request, data)

    @app.post("/api/admin/imports/{dataset_id}/validate")
    def validate_source(request: Request, dataset_id: str, accept_quarantine: bool = False):
        principal = auth(request, "validate", dataset_id)
        return result(
            request,
            ingestion.validate(dataset_id, principal, request.state.correlation_id, accept_quarantine),
        )

    @app.post("/api/admin/imports/{dataset_id}/index")
    def build_index(request: Request, dataset_id: str):
        principal = auth(request, "import", dataset_id)
        data = IndexBuilder(settings, repository, factory, security).build(
            dataset_id, principal, request.state.correlation_id
        )
        return result(request, data)

    @app.post("/api/admin/imports/{dataset_id}/publish")
    def publish_source(
        request: Request, dataset_id: str, expected_revision: int, index_id: str | None = None
    ):
        principal = auth(request, "publish", dataset_id)
        return result(
            request,
            ingestion.publish(
                dataset_id, principal, request.state.correlation_id, expected_revision, index_id
            ),
        )

    @app.get("/api/admin/runtime")
    def runtime(request: Request):
        auth(request, "runtime")
        return result(
            request,
            {
                "environment": settings.environment,
                "provider": settings.provider,
                "semantic_enabled": settings.semantic_enabled,
                "configuration_mutation": "deployment_environment_only",
                "workers": 1,
            },
        )

    @app.get("/api/admin/roles")
    def roles(request: Request):
        auth(request, "roles")
        return result(
            request,
            {
                "identities": [
                    {"subject": i["subject"], "roles": i["roles"], "expires_at": i["expires_at"]}
                    for i in security.identities.values()
                ],
                "mutation": "deployment_secret_configuration_only",
            },
        )

    @app.post("/api/admin/retention")
    def retention(request: Request):
        from datetime import UTC, datetime, timedelta

        auth(request, "retention")
        cutoff = (datetime.now(UTC) - timedelta(days=settings.retention_days)).isoformat()
        with factory.begin() as session:
            events_deleted = session.execute(
                delete(TelemetryEvent).where(TelemetryEvent.occurred_at < cutoff)
            ).rowcount
            feedback_deleted = session.execute(delete(Feedback).where(Feedback.created_at < cutoff)).rowcount
        return result(request, {"events_deleted": events_deleted, "feedback_deleted": feedback_deleted})

    dist = ROOT / "frontend/dist"
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.get("/")
    def index():
        if not (dist / "index.html").exists():
            raise DomainError("FRONTEND_NOT_BUILT", "กรุณา build ส่วนติดต่อผู้ใช้ก่อนเปิดแอป", 503)
        return FileResponse(dist / "index.html")

    return app
