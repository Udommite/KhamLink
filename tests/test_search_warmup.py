"""REQ-UX-030: local startup warm-up, concurrent initialization and optional failures."""

import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from khamlink.bge import BgeIndex
from khamlink.retrieval import SearchService


def adapter():
    """Build a model-free adapter so tests cannot read or download actual models."""
    index = object.__new__(BgeIndex)
    index.settings = SimpleNamespace(rerank_enabled=True, bge_model="cached", rerank_model="cached")
    index._model_lock = threading.RLock()
    index._encoder = index._reranker = None
    return index


def test_warmup_attempts_both_models_even_when_encoder_is_missing():
    """A missing encoder cache must not prevent an independently available reranker loading."""
    index = adapter()
    index.encode_query = Mock(side_effect=OSError("not cached"))
    index._rerank = Mock()
    index.warmup()
    index.encode_query.assert_called_once()
    index._rerank.assert_called_once()


def test_concurrent_encoder_load_is_local_and_single(monkeypatch):
    """Startup and requests must share one fully initialized, local-only model."""
    import sys

    model = SimpleNamespace(max_seq_length=0)
    constructor = Mock(return_value=model)
    monkeypatch.setitem(sys.modules, "sentence_transformers", SimpleNamespace(SentenceTransformer=constructor))
    monkeypatch.setattr(BgeIndex, "device", property(lambda self: "cpu"))
    index = adapter()
    with ThreadPoolExecutor(max_workers=8) as workers:
        loaded = list(workers.map(lambda _: index.encoder, range(16)))
    assert all(item is model for item in loaded)
    constructor.assert_called_once_with("cached", device="cpu", local_files_only=True)
    assert model.max_seq_length == 512


def test_reranker_loading_uses_only_local_files(monkeypatch):
    """Both tokenizer and model forbid remote cache resolution."""
    import sys

    model = Mock()
    model.to.return_value.eval.return_value = model
    tokenizer_factory, model_factory = Mock(), Mock(return_value=model)
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace())
    monkeypatch.setitem(sys.modules, "transformers", SimpleNamespace(
        AutoTokenizer=SimpleNamespace(from_pretrained=tokenizer_factory),
        AutoModelForSequenceClassification=SimpleNamespace(from_pretrained=model_factory),
    ))
    monkeypatch.setattr(BgeIndex, "device", property(lambda self: "cpu"))
    index = adapter()
    assert index.reranker is index.reranker
    tokenizer_factory.assert_called_once_with("cached", local_files_only=True)
    model_factory.assert_called_once_with("cached", local_files_only=True)


@pytest.mark.parametrize("embedding,enabled", [("lsa", True), ("qwen", True), ("bge-m3", False)])
def test_warmup_skips_disabled_and_remote_adapters(embedding, enabled):
    """Startup must never warm a remote embedding provider or disabled retrieval."""
    service = object.__new__(SearchService)
    service.settings = SimpleNamespace(embedding=embedding, semantic_enabled=enabled)
    service.repository = Mock()
    service.warmup()
    service.repository.release.assert_not_called()


def test_warmup_failure_does_not_block_lexical_service():
    """A missing release or invalid index retains the offline lexical startup path."""
    service = object.__new__(SearchService)
    service.settings = SimpleNamespace(embedding="bge-m3", semantic_enabled=True)
    service.repository = Mock()
    service.load_adapter = Mock(side_effect=ValueError("missing index"))
    service.warmup()
    service.load_adapter.assert_called_once()


def test_lifespan_warms_before_serving_and_cleans_up(system, monkeypatch):
    """Warm-up finishes before lifespan yields and teardown closes telemetry."""
    from fastapi.testclient import TestClient
    from khamlink.api import create_app

    app = create_app(system["settings"])
    warmed, closed = Mock(), Mock()
    monkeypatch.setattr(app.state.search, "warmup", warmed)
    monkeypatch.setattr(app.state.telemetry, "close", closed)
    with TestClient(app) as client:
        warmed.assert_called_once()
        assert client.get("/health").status_code == 200
        closed.assert_not_called()
    closed.assert_called_once()
