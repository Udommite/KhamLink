import argparse
import hashlib
import json
import logging
import os
import secrets
import uuid
from datetime import UTC, datetime, timedelta

from alembic import command
from alembic.config import Config

from .config import ROOT, Settings
from .db import ActiveRelease, IndexBuild, make_engine, sessions
from .ingestion import IngestionService, acquire
from .observability import configure_logging
from .repository import SQLLexicalRepository
from .retrieval import IndexBuilder, index_identity
from .security import Security


def migrate(settings):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    config = Config(str(ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(ROOT / "migrations"))
    command.upgrade(config, "head")


def bootstrap(settings, token=None, demo=False):
    if demo:
        if settings.environment != "local":
            raise RuntimeError("demo bootstrap is available only in local mode")
        token = secrets.token_urlsafe(48)
        identity = {
            hashlib.sha256(token.encode()).hexdigest(): {
                "subject": "local-demo-bootstrap",
                "roles": ["admin"],
                "expires_at": (datetime.now(UTC) + timedelta(minutes=30)).isoformat(),
            }
        }
        settings = settings.model_copy(update={"identities_json": json.dumps(identity)})
    engine = make_engine(settings.database_url)
    factory = sessions(engine)
    security = Security(settings, factory)
    principal = security.authenticate(token)
    correlation = str(uuid.uuid4())
    security.authorize(principal, "import", correlation)
    path = acquire(settings)
    ingest = IngestionService(settings, factory, security)
    result = ingest.stage(path, principal, correlation)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    with factory() as session:
        active = session.get(ActiveRelease, 1)
        revision = active.revision
        current_index = session.get(IndexBuild, active.index_id) if active.index_id else None
        if (
            active.dataset_id == result["dataset_id"]
            and current_index
            and current_index.manifest["configuration_hash"] == index_identity(settings)[1]
        ):
            print("Published dataset/index already available; no changes.", flush=True)
            engine.dispose()
            return
    if result["state"] not in {"Published", "Superseded"}:
        result = ingest.validate(result["dataset_id"], principal, correlation, accept_quarantine=True)
        if result["state"] != "Validated":
            raise RuntimeError("source validation failed")
    repository = SQLLexicalRepository(factory)
    manifest = IndexBuilder(settings, repository, factory, security).build(
        result["dataset_id"], principal, correlation
    )
    published = ingest.publish(result["dataset_id"], principal, correlation, revision, manifest["index_id"])
    print(
        json.dumps(
            {
                **published,
                "passages": manifest["passages"],
                "phrases": manifest["phrases"],
                "triples": manifest["triples"],
            },
            ensure_ascii=False,
        ),
        flush=True,
    )
    engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="KhamLink protected data and local demo commands")
    parser.add_argument("command", choices=["migrate", "acquire", "bootstrap", "demo", "serve"])
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--ssl-certfile")
    parser.add_argument("--ssl-keyfile")
    parser.add_argument("--no-serve", action="store_true")
    args = parser.parse_args()
    settings = Settings()
    logging.basicConfig(level=logging.WARNING)
    configure_logging()
    if args.command == "migrate":
        migrate(settings)
    elif args.command == "acquire":
        print(acquire(settings))
    elif args.command in {"bootstrap", "demo"}:
        migrate(settings)
        bootstrap(settings, os.getenv("KHAMLINK_ADMIN_TOKEN"), demo=args.command == "demo")
    if args.command == "serve" or (args.command == "demo" and not args.no_serve):
        import uvicorn

        if settings.environment == "production" and not (args.ssl_certfile and args.ssl_keyfile):
            parser.error(
                "Production serving requires --ssl-certfile and --ssl-keyfile; proxy headers are not trusted"
            )

        # No privileged bootstrap token is installed in the web application's runtime.
        uvicorn.run(
            "khamlink.api:create_app",
            factory=True,
            host=args.host,
            port=args.port,
            access_log=False,
            proxy_headers=False,
            ssl_certfile=args.ssl_certfile,
            ssl_keyfile=args.ssl_keyfile,
        )


if __name__ == "__main__":
    main()
