"""Synthetic fixtures only. Never used by the application's real corpus bootstrap."""

import csv
import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from khamlink.api import create_app
from khamlink.config import Settings
from khamlink.db import ActiveRelease, Base, make_engine, sessions
from khamlink.ingestion import IngestionService
from khamlink.repository import SQLLexicalRepository
from khamlink.retrieval import IndexBuilder
from khamlink.security import Security

FIXTURE_WORDS = {
    "อนุรักษ์": {"คำกริยา": ["รักษาให้คงเดิม"]},
    "สงวน": {"คำกริยา": ["ถนอมรักษาไว้", "หวงแหนไว้"]},
    "รักษา": {"คำกริยา": ["ดูแล", "ป้องกัน"]},
    "ความสุข": {"คำนาม": ["ความสบายใจ"]},
    "ทุกข์": {"คำนาม": ["ความไม่สบายใจ"]},
    "ประสิทธิภาพ": {"คำนาม": ["ความสามารถทำงานให้ได้ผลโดยใช้ทรัพยากรคุ้มค่า"]},
    "ประสิทธิผล": {"คำนาม": ["ผลสำเร็จตามเป้าหมายที่ตั้งไว้"]},
    "ขัน": {"คำนาม": ["ภาชนะสำหรับตักน้ำ"], "คำกริยา": ["อาการร้องของไก่", "ทำให้แน่นด้วยการหมุน"]},
    "น้ำ": {"คำนาม": ["ของเหลวสำหรับดื่ม"]},
    "ไก่": {"คำนาม": ["นกเลี้ยงชนิดหนึ่ง"]},
    "ศูนย์": {"คำนาม": ["ดู กลาง"]},
    "กลาง": {"คำนาม": ["ส่วนที่อยู่ระหว่างปลายทั้งสอง"]},
}


def write_corpus(tmp_path, words, version="fixture-v1"):
    path = tmp_path / f"corpus-{version}.csv"
    with path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["word", "meaning"])
        for word, meaning in words.items():
            writer.writerow([word, repr(meaning)])
    manifest = {
        "manifest_version": 1,
        "source_id": "synthetic-test-source",
        "name": "SYNTHETIC TEST FIXTURE — NOT A DICTIONARY",
        "corpus": "test-only",
        "version": version,
        "download_url": "https://example.invalid/test.csv",
        "retrieved_at": "2026-09-14",
        "upstream_origin": "https://example.invalid",
        "license": "CC-BY-SA-4.0",
        "license_url": "https://creativecommons.org/licenses/by-sa/4.0/",
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "size_bytes": path.stat().st_size,
        "provenance": "SOURCE_DATA",
        "official_royal_society": False,
        "approved": True,
    }
    manifest_path = tmp_path / f"manifest-{version}.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    return path, manifest_path


@pytest.fixture
def system(tmp_path):
    path, manifest = write_corpus(tmp_path, FIXTURE_WORDS)
    identities = {}
    for role in ["admin", "curator", "operator", "evaluator", "search_service", "ingestion_service"]:
        token = f"test-{role}-credential"
        identities[hashlib.sha256(token.encode()).hexdigest()] = {
            "subject": f"test-{role}",
            "roles": [role],
            "expires_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        }
    identities[hashlib.sha256(b"expired").hexdigest()] = {
        "subject": "expired",
        "roles": ["admin"],
        "expires_at": "2000-01-01T00:00:00+00:00",
    }
    # Every setting comes from explicit defaults/fixture overrides, not the user's
    # production environment. In particular, a configured neural/remote provider
    # must never make these deterministic tests download models or send evidence.
    defaults = {
        name: field.get_default(call_default_factory=True) for name, field in Settings.model_fields.items()
    }
    defaults.update(
        embedding="lsa",
        embedding_model="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        embedding_revision="",
        provider="extractive",
        environment="test",
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        data_dir=tmp_path,
        source_manifest=manifest,
        identities_json=json.dumps(identities),
        lookup_rate=5000,
        costly_rate=5000,
        feedback_rate=5000,
        dense_dimensions=8,
        provider_timeout=0.15,
    )
    settings = Settings(_env_file=None, **defaults)
    engine = make_engine(settings.database_url)
    Base.metadata.create_all(engine)
    factory = sessions(engine)
    with factory.begin() as session:
        session.add(ActiveRelease(id=1, revision=0))
    security = Security(settings, factory)
    principal = security.authenticate("test-admin-credential")
    ingest = IngestionService(settings, factory, security)
    cid = str(uuid.uuid4())
    staged = ingest.stage(path, principal, cid)
    ingest.validate(staged["dataset_id"], principal, cid)
    repo = SQLLexicalRepository(factory)
    index = IndexBuilder(settings, repo, factory, security).build(staged["dataset_id"], principal, cid)
    ingest.publish(staged["dataset_id"], principal, cid, 0, index["index_id"])
    app = create_app(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "settings": settings,
            "path": path,
            "factory": factory,
            "repo": repo,
            "ingest": ingest,
            "principal": principal,
            "security": security,
            "app": app,
            "client": client,
            "dataset_id": staged["dataset_id"],
            "index": index,
            "cid": cid,
        }
    engine.dispose()


def auth(role="admin"):
    return {"Authorization": f"Bearer test-{role}-credential"}
