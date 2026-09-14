import json
import threading
import time
import uuid

from conftest import auth
from fastapi.testclient import TestClient
from khamlink.api import create_app
from khamlink.db import TelemetryEvent
from khamlink.observability import PRODUCT_EVENTS
from sqlalchemy import select
from test_api import data


def test_VAL_035_049_050_allowlisted_telemetry(system, monkeypatch):
    telemetry = system["app"].state.telemetry
    system["settings"].analytics_enabled = True
    secret = "RAW-QUERY-CONTEXT-PII"
    for name in PRODUCT_EVENTS:
        telemetry.emit(
            name,
            str(uuid.uuid4()),
            {
                "word_id": "w_test",
                "status": "ok",
                "query": secret,
                "context": secret,
                "ip": "192.0.2.1",
                "user_agent": secret,
                "details": secret,
            },
            product=True,
        )
    assert telemetry.flush()
    with system["factory"]() as session:
        events = session.scalars(select(TelemetryEvent)).all()
        assert {e.name for e in events} == PRODUCT_EVENTS
        assert secret not in json.dumps([e.dimensions for e in events])
    data(
        system["client"].post(
            "/api/events", json={"name": "source_opened", "refs": {"source_id": {"private": secret}}}
        )
    )
    assert telemetry.flush()
    monkeypatch.setattr(telemetry, "sessions", lambda: (_ for _ in ()).throw(RuntimeError("outage")))
    telemetry.emit("search_submitted", system["cid"], {"status": "ok"}, product=True)
    assert telemetry.flush()
    assert telemetry.failures == 1
    assert system["client"].get("/api/words/อนุรักษ์").status_code == 200
    system["settings"].analytics_enabled = False
    before = len(telemetry.recent)
    telemetry.emit("search_submitted", system["cid"], {"status": "ok"}, product=True)
    assert len(telemetry.recent) == before
    metrics = data(system["client"].get("/api/admin/metrics", headers=auth("operator")))
    assert metrics["telemetry_failures"] == 1 and metrics["alerts"]


def test_VAL_050_059_slow_telemetry_is_bounded_and_does_not_block_lookup(system, monkeypatch):
    telemetry = system["app"].state.telemetry
    assert telemetry.flush()
    entered, release = threading.Event(), threading.Event()

    def slow_sink(_record):
        entered.set()
        release.wait(timeout=5)

    monkeypatch.setattr("khamlink.observability.logger.info", slow_sink)
    try:
        telemetry.emit("request", system["cid"], {"status": "ok"})
        assert entered.wait(timeout=1)
        began = time.monotonic()
        for _ in range(1100):
            telemetry.emit("request", system["cid"], {"status": "ok"})
        response = system["client"].get("/api/words/อนุรักษ์")
        assert response.status_code == 200
        assert time.monotonic() - began < 1
        assert telemetry.snapshot()["telemetry_pending"] <= 1025
        assert telemetry.snapshot()["alerts"] == ["telemetry_unavailable"]
    finally:
        release.set()
        assert telemetry.flush(timeout=3)


def test_VAL_045_privileged_audit_metadata(system):
    system["client"].get("/api/admin/reports", headers=auth("curator"))
    result = data(system["client"].get("/api/admin/audit", headers=auth("operator")))
    denial = next(r for r in result if r["action"] == "reports")
    assert denial["actor"] == "test-curator" and denial["outcome"] == "denied"
    assert denial["occurred_at"] and denial["correlation_id"]
    assert "credential" not in json.dumps(result)


def test_VAL_046_tls_boundary_and_untrusted_proxy(system):
    # Same app with production transport policy; SQLite is solely the isolated test backend.
    settings = system["settings"].model_copy(update={"environment": "production"})
    app = create_app(settings)
    with TestClient(app, base_url="http://testserver") as client:
        response = client.get("/api/words/อนุรักษ์", headers={"X-Forwarded-Proto": "https"})
        assert response.status_code == 400 and response.json()["error"]["code"] == "TLS_REQUIRED"
        response = client.post("/api/admin/imports", json={}, headers=auth())
        assert response.status_code == 400
    with TestClient(app, base_url="https://testserver") as client:
        response = client.get("/api/words/อนุรักษ์")
        assert response.status_code == 200
        assert "max-age=" in response.headers["strict-transport-security"]
