"""RID corpus ingestion and the BGE-M3 retrieval pipeline.

Synthetic fixtures only: a ten-entry Parquet bundle and a deterministic stand-in encoder,
so these run without the licensed corpus and without downloading 4+ GB of models. The
real corpus and real models are exercised by ``scripts/benchmark_rid.py``, which is
opt-in because it needs both.
"""

import hashlib
import json
import uuid
from datetime import UTC, datetime, timedelta

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from fastapi.testclient import TestClient
from khamlink.api import create_app
from khamlink.bge import BgeIndex, entry_text, frequency_bonus
from khamlink.config import Settings
from khamlink.db import ActiveRelease, Base, Relationship, WordAlias, make_engine, sessions
from khamlink.domain import DomainError
from khamlink.expansion import QueryExpander, parse_expansion
from khamlink.observability import Telemetry
from khamlink.repository import SQLLexicalRepository
from khamlink.retrieval import IndexBuilder, SearchService
from khamlink.rid import SENSE_FIELDS, RIDIngestionService, aliases_of, definition_id_for, sense_id_of
from khamlink.security import Security
from sqlalchemy import func, select

DIMENSIONS = 16

# (headword, headword_en, pos, definition, edition)
FIXTURE_SENSES = [
    ("อนุรักษ-, อนุรักษ์", "", "ก.", "รักษาให้คงเดิม.", "royal_2542"),
    ("สงวน", "", "ก.", "ถนอมรักษาไว้, หวงแหนไว้.", "royal_2542"),
    ("ตะกละ, ตะกลาม", "", "ว.", "มักกิน, กินไม่เลือก, เห็นแก่กิน.", "royal_2542"),
    ("แพทย-, แพทย์", "", "น.", "หมอรักษาโรค.", "royal_2542"),
    ("คนไข้", "", "น.", "ผู้ป่วยที่อยู่ในความดูแลของแพทย์.", "royal_2542"),
    ("ขัน", "", "น.", "ภาชนะสำหรับตักน้ำ.", "royal_2542"),
    ("ขัน", "", "ก.", "ทำให้แน่นด้วยการหมุน.", "royal_2554"),
    ("ก่ง", "", "ก.", "ทำให้โค้ง.", "royal_2542"),
    ("โก่ง", "", "ก.", "ทำให้โค้ง.", "royal_2542"),
    ("ไร้แบคทีเรีย", "abacterial", "", "", "subject_medical"),
    ("เศษเดน", "", "", "", "royal_2569"),
]
RELATIONS = [(7, 8, "synonym"), (0, 1, "see_also"), (2, 2, "variant"), (3, 99, "synonym")]


def fake_vector(text: str) -> np.ndarray:
    """Deterministic stand-in for BGE-M3. Index and query must agree, so both use this."""
    seed = int.from_bytes(hashlib.sha256(text.encode("utf-8")).digest()[:8], "big")
    vector = np.random.default_rng(seed).normal(size=DIMENSIONS).astype("float32")
    return vector / np.linalg.norm(vector)


class FakeEncoder:
    """Stands in for SentenceTransformer so no model is downloaded or loaded."""

    max_seq_length = 512

    def __init__(self, *_args, **_kwargs):
        pass

    def half(self):
        return self

    def encode(self, texts, **_kwargs):
        return np.vstack([fake_vector(t) for t in texts])


def write_bundle(folder):
    folder.mkdir(parents=True, exist_ok=True)
    columns = {name: [] for name in SENSE_FIELDS}
    vectors = []
    for index, (headword, english, pos, definition, edition) in enumerate(FIXTURE_SENSES):
        for name in SENSE_FIELDS:
            columns[name].append(None)
        columns["id"][-1] = index
        columns["headword"][-1] = headword
        columns["headword_en"][-1] = english
        columns["pos"][-1] = pos
        columns["definition"][-1] = definition
        columns["edition"][-1] = edition
        columns["ipa"][-1] = "kʰaˇn" if headword == "ขัน" else None
        columns["source_row"][-1] = index
        vectors.append(fake_vector(entry_text(headword, english, definition)))
    senses = folder / "senses.parquet"
    pq.write_table(
        pa.table(
            {
                name: pa.array(values, type=pa.int32() if name in {"id", "source_row"} else pa.string())
                for name, values in columns.items()
            }
        ),
        senses,
    )
    pq.write_table(
        pa.table(
            {
                "from_id": pa.array([r[0] for r in RELATIONS], pa.int32()),
                "to_id": pa.array([r[1] for r in RELATIONS], pa.int32()),
                "relation_type": pa.array([r[2] for r in RELATIONS]),
            }
        ),
        folder / "relations.parquet",
    )
    pq.write_table(
        pa.table(
            {
                "sense_id": pa.array(list(range(len(FIXTURE_SENSES))), pa.int32()),
                "vector": pa.array([v.tolist() for v in vectors], pa.list_(pa.float32(), DIMENSIONS)),
            }
        ),
        folder / "embeddings.parquet",
    )
    return senses


def write_manifest(folder, senses):
    with senses.open("rb") as stream:
        checksum = hashlib.file_digest(stream, "sha256").hexdigest()
    manifest = {
        "manifest_version": 1,
        "format": "rid-parquet",
        "source_id": "synthetic-rid-test-source",
        "name": "SYNTHETIC TEST FIXTURE — NOT A DICTIONARY",
        "corpus": "test-only",
        "version": "fixture-v1",
        "retrieved_at": "2026-09-14",
        "upstream_origin": "https://example.invalid",
        "license": "TEST-ONLY",
        "license_url": "https://example.invalid",
        "sha256": checksum,
        "size_bytes": senses.stat().st_size,
        "files": {"senses": "senses.parquet"},
        "provenance": "SOURCE_DATA",
        "official_royal_society": True,
        "approved": True,
    }
    path = folder / "manifest.json"
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    return path


@pytest.fixture
def rid(tmp_path, monkeypatch):
    monkeypatch.setattr("sentence_transformers.SentenceTransformer", FakeEncoder, raising=False)
    corpus = tmp_path / "corpus"
    senses = write_bundle(corpus)
    manifest = write_manifest(corpus, senses)
    identities = {
        hashlib.sha256(b"test-admin-credential").hexdigest(): {
            "subject": "test-admin",
            "roles": ["admin"],
            "expires_at": (datetime.now(UTC) + timedelta(days=1)).isoformat(),
        }
    }
    defaults = {
        name: field.get_default(call_default_factory=True) for name, field in Settings.model_fields.items()
    }
    defaults.update(
        environment="test",
        embedding="bge-m3",
        rerank_enabled=False,
        # The stand-in encoder produces cosines around zero, so the dense floor that a real
        # cross-encoder would apply is lowered here rather than silently passing everything.
        semantic_threshold=0.0,
        provider="extractive",
        database_url=f"sqlite:///{tmp_path / 'rid.db'}",
        data_dir=tmp_path,
        corpus_dir=corpus,
        source_manifest=manifest,
        identities_json=json.dumps(identities),
        lookup_rate=5000,
        costly_rate=5000,
        feedback_rate=5000,
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
    ingest = RIDIngestionService(settings, factory, security)
    correlation = str(uuid.uuid4())
    staged = ingest.stage(senses, principal, correlation)
    ingest.validate(staged["dataset_id"], principal, correlation, accept_quarantine=True)
    repository = SQLLexicalRepository(factory)
    index = IndexBuilder(settings, repository, factory, security).build(
        staged["dataset_id"], principal, correlation
    )
    ingest.publish(staged["dataset_id"], principal, correlation, 0, index["index_id"])
    app = create_app(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "settings": settings,
            "factory": factory,
            "repo": repository,
            "ingest": ingest,
            "principal": principal,
            "security": security,
            "client": client,
            "dataset_id": staged["dataset_id"],
            "staged": staged,
            "index": index,
            "corpus": corpus,
            "cid": correlation,
        }
    engine.dispose()


def data(response):
    assert response.status_code < 400, response.text
    return response.json()["data"]


# ---------------- identifiers ----------------


def test_definition_id_round_trips_to_the_parquet_sense_id():
    for sense_id in [0, 7, 65997]:
        assert sense_id_of(definition_id_for(sense_id)) == sense_id
    assert sense_id_of("d_rid_notanumber") is None
    assert sense_id_of("w_4891eff7") is None
    assert sense_id_of("") is None


def test_aliases_split_comma_joined_headwords_and_bound_forms():
    assert aliases_of("อนุรักษ-, อนุรักษ์") == sorted(
        {"อนุรักษ-, อนุรักษ์", "อนุรักษ-", "อนุรักษ", "อนุรักษ์"}
    )
    assert aliases_of("สงวน") == ["สงวน"]


# ---------------- ingestion ----------------


def test_ingestion_stores_senses_aliases_metadata_and_quarantines_empty_records(rid):
    # 'ขัน' has two senses under one entry, so records (entries) < senses.
    assert rid["staged"]["records"] == len(FIXTURE_SENSES) - 2
    assert rid["repo"].release()["dataset_id"] == rid["dataset_id"]
    with rid["factory"]() as session:
        assert session.scalar(select(func.count()).select_from(WordAlias)) >= rid["staged"]["records"]
    # 'เศษเดน' has neither a definition nor an English equivalent, so it is recorded, not stored.
    assert rid["staged"]["issues"] == 1
    with pytest.raises(DomainError, match="WORD_NOT_FOUND"):
        rid["repo"].lookup("เศษเดน")

    word = data(rid["client"].get("/api/words/ขัน"))
    assert [d["number"] for d in word["definitions"]] == [1, 2]
    assert word["definitions"][0]["metadata"]["ipa"] == "kʰaˇn"
    assert word["definitions"][0]["record_url"].startswith("https://")
    assert word["source"]["official_royal_society"] is True


def test_a_term_list_entry_keeps_its_english_equivalent_as_the_record(rid):
    word = data(rid["client"].get("/api/words/ไร้แบคทีเรีย"))
    assert word["definitions"][0]["text"] == "abacterial"
    assert word["definitions"][0]["metadata"]["record_kind"] == "term_equivalent"


def test_lookup_and_context_detection_accept_any_written_form_of_an_entry(rid):
    entry = data(rid["client"].get("/api/words/อนุรักษ์"))
    assert entry["word"] == "อนุรักษ-, อนุรักษ์"
    assert entry["word_id"] == data(rid["client"].get("/api/words/อนุรักษ-"))["word_id"]

    detected = data(rid["client"].post("/api/context", json={"text": "เราอนุรักษ์ภาษาไทย"}))
    spans = {(s["text"], s["start"], s["end"]) for s in detected["spans"]}
    assert ("อนุรักษ์", 3, 11) in spans


def test_relations_become_word_edges_without_self_loops_or_unresolved_targets(rid):
    with rid["factory"]() as session:
        edges = session.scalars(select(Relationship)).all()
    # 'ก่ง'->'โก่ง' only: the self-reference and the unresolved target are both dropped,
    # and 'อนุรักษ์'->'สงวน' survives as a see_also mapped to 'related'.
    assert {e.type for e in edges} == {"similar", "related"}
    assert all(e.from_id != e.to_id for e in edges)
    assert all(e.provenance == "SOURCE_DATA" for e in edges)

    related = data(rid["client"].get("/api/words/ก่ง/related"))
    assert related["state"] == "available"
    assert [e["word"] for e in related["relationships"]] == ["โก่ง"]
    assert all(e["provenance"] == "SOURCE_DATA" for e in related["relationships"])
    # The word map must never show model-derived triples.
    assert all(e["process_id"] == "rid-source-cross-reference-v1" for e in related["relationships"])


# ---------------- retrieval ----------------


def test_index_is_built_from_the_shipped_vectors_without_re_encoding(rid):
    manifest = rid["index"]
    assert manifest["method"] == "khamlink-bge-m3-rerank-frequency-v1"
    assert set(manifest["files"]) == {"embedding.json", "rows.json", "vectors.npy"}
    folder = rid["settings"].data_dir / "indexes" / manifest["index_id"]
    # Loading re-verifies every checksum and the configuration identity.
    adapter = BgeIndex(rid["settings"], folder, manifest)
    assert adapter.vectors.shape == (manifest["passages"], DIMENSIONS)
    assert len(adapter.definition_ids) == manifest["passages"]
    assert manifest["skipped_without_vector"] == 0


def test_index_entry_text_matches_what_the_encoder_embedded(rid):
    """The cross-encoder must read the same text the vector was built from. A term-list
    record stores its English equivalent as the definition, but was embedded with an empty
    definition, so reconstructing it naively would silently judge a different string."""
    folder = rid["settings"].data_dir / "indexes" / rid["index"]["index_id"]
    adapter = BgeIndex(rid["settings"], folder, rid["index"])
    for row, definition_id in enumerate(adapter.definition_ids):
        headword, english, _pos, definition, _edition = FIXTURE_SENSES[sense_id_of(definition_id)]
        assert adapter.entries[row] == entry_text(headword, english, definition)
    term = adapter.row_of_definition[definition_id_for(9)]
    assert adapter.entries[term] == "ไร้แบคทีเรีย (abacterial)"


def test_retrieve_ranks_the_matching_entry_first_and_reports_its_mode(rid):
    folder = rid["settings"].data_dir / "indexes" / rid["index"]["index_id"]
    adapter = BgeIndex(rid["settings"], folder, rid["index"])
    result = adapter.retrieve(entry_text("แพทย-, แพทย์", "", "หมอรักษาโรค."), 5)
    assert result["mode"].startswith("bge_m3")
    assert result["candidates"][0]["definition_id"] == definition_id_for(3)
    assert result["candidates"][0]["retrieval_score"] >= result["candidates"][-1]["retrieval_score"]
    # One row per entry, even though 'ขัน' has two senses in the corpus.
    assert len({c["word_id"] for c in result["candidates"]}) == len(result["candidates"])


def test_a_word_the_model_proposes_is_looked_up_in_the_corpus_and_ranked_first(rid):
    folder = rid["settings"].data_dir / "indexes" / rid["index"]["index_id"]
    adapter = BgeIndex(rid["settings"], folder, rid["index"])
    boosted = adapter.retrieve("ทำให้โค้ง", 10, boost=["ตะกลาม"])
    top = boosted["candidates"][0]
    # Matched on a written form of the entry, not its full comma-joined headword.
    assert top["definition_id"] == definition_id_for(2)
    assert top["proposed_by_model"] is True


def test_a_word_the_model_invents_retrieves_nothing(rid):
    folder = rid["settings"].data_dir / "indexes" / rid["index"]["index_id"]
    adapter = BgeIndex(rid["settings"], folder, rid["index"])
    plain = adapter.retrieve("ทำให้โค้ง", 10)
    invented = adapter.retrieve("ทำให้โค้ง", 10, boost=["คำที่ไม่มีอยู่จริง"])
    assert {c["word_id"] for c in invented["candidates"]} == {c["word_id"] for c in plain["candidates"]}
    assert not any(c["proposed_by_model"] for c in invented["candidates"])


def test_exact_lexical_match_outranks_every_semantic_candidate(rid):
    result = data(rid["client"].post("/api/search", json={"query": "สงวน", "limit": 5}))
    assert result["candidates"][0]["word"] == "สงวน"
    assert result["candidates"][0]["match_type"] == "exact"
    assert result["retrieval_mode"] == "lexical"


def test_search_degrades_without_a_500_when_the_index_is_unavailable(rid):
    settings = rid["settings"].model_copy(update={"semantic_enabled": False})
    service = SearchService(settings, rid["repo"], rid["factory"], Telemetry(settings, rid["factory"]))
    result = service.search("คำที่หมายถึงการรักษาโรค", 5, 0, rid["cid"])
    assert result["degraded"] is True
    assert result["degraded_reason"] == "SEMANTIC_INDEX_UNAVAILABLE"
    assert result["state"] in {"results", "degraded_empty"}


def test_frequency_prior_prefers_common_words_and_tolerates_a_missing_corpus(monkeypatch):
    monkeypatch.setattr("khamlink.bge._FREQUENCIES", {"บ่อย": 10000, "เนือง": 5})
    assert frequency_bonus("บ่อย", 0.6) > frequency_bonus("เนือง", 0.6) > 0
    assert frequency_bonus("บ่อย", 0.0) == 0.0
    # A comma-joined headword takes the commonest of its written forms.
    assert frequency_bonus("เนือง, บ่อย", 0.6) == frequency_bonus("บ่อย", 0.6)
    monkeypatch.setattr("khamlink.bge._FREQUENCIES", {})
    assert frequency_bonus("บ่อย", 0.6) == 0.0


# ---------------- query expansion ----------------


def test_expansion_parses_json_that_models_wrap_in_prose():
    parsed = parse_expansion('ขอคิดก่อนนะ {"terms": ["กินมากเกินควร", " "], "words": ["ตะกละ"]} จบ')
    assert parsed == {"terms": ["กินมากเกินควร"], "words": ["ตะกละ"]}
    with pytest.raises(ValueError):
        parse_expansion("ไม่มี JSON ในคำตอบนี้")


def test_expansion_is_off_by_default_and_skipped_for_short_or_exact_queries(rid):
    assert QueryExpander(rid["settings"]).available is False
    configured = rid["settings"].model_copy(
        update={"query_expansion": True, "provider_url": "https://example.invalid/v1", "provider_model": "m"}
    )
    expander = QueryExpander(configured)
    assert expander.available is True
    assert expander.wanted("คำที่หมายความว่ากินเยอะเกินไป", exact=False) is True
    assert expander.wanted("ขัน", exact=False) is False
    assert expander.wanted("คำที่หมายความว่ากินเยอะเกินไป", exact=True) is False


def test_search_still_answers_when_the_expansion_provider_fails(rid, monkeypatch):
    settings = rid["settings"].model_copy(
        update={
            "query_expansion": True,
            "provider_url": "https://example.invalid/v1",
            "provider_model": "m",
        }
    )
    service = SearchService(settings, rid["repo"], rid["factory"], Telemetry(settings, rid["factory"]))
    calls = []

    def failing(_query):
        calls.append(_query)
        raise RuntimeError("provider exploded")

    monkeypatch.setattr(service.expander, "expand", failing)
    result = service.search(entry_text("แพทย-, แพทย์", "", "หมอรักษาโรค."), 5, 0, rid["cid"])
    assert calls, "expansion should have been attempted"
    assert result["degraded"] is False
    assert result["candidates"], "a failed rewrite must still return plain retrieval results"
    assert not result["retrieval_mode"].endswith("_expanded")


# ---------------- document review ----------------


def test_register_marks_are_read_from_the_field_and_from_the_definition_text():
    from khamlink.review import register_marks, sense_marks

    assert register_marks("ถิ่น–พายัพ, อีสาน") == ["ถิ่น", "อีสาน"]
    assert register_marks("โบ; กลอน") == ["โบ", "กลอน"]
    assert register_marks("") == []
    # RID prints the mark inline as often as the ETL captured it into its own column.
    inline = {"metadata": {}, "text": "ดีเยี่ยม เช่น ปาฐกถาวันนี้แจ๋ว. (ปาก)"}
    assert "ปาก" in sense_marks(inline)
    assert sense_marks({"metadata": {"register": "ปาก"}, "text": "เลิกล้มกิจการ"}) == ["ปาก"]
    assert sense_marks({"metadata": {}, "text": "ขนที่ขึ้นอยู่บนศีรษะ"}) == []


def test_bounded_edit_distance_accepts_one_change_and_rejects_more():
    from khamlink.review import edit_distance_within

    assert edit_distance_within("ทุกคน", "ทุกหน")
    assert edit_distance_within("กบ", "กบ")
    assert not edit_distance_within("ฟลุ๊คคค", "อนุรักษ์")
    assert not edit_distance_within("กบ", "กบเกบ")


def test_review_reports_offsets_that_address_exactly_the_marked_characters(rid):
    text = "เขาเอาขันไปตักน้ำ แล้วสงวนไว้"
    result = data(rid["client"].post("/api/review", json={"text": text, "formality": "neutral"}))
    assert result["score"] <= 100
    for suggestion in result["suggestions"]:
        assert text[suggestion["start"] : suggestion["end"]] == suggestion["text"]
    for token in result["tokens"]:
        assert text[token["start"] : token["end"]] == token["text"]
    assert result["stats"]["characters"] == len(text)


def test_review_rejects_an_unsupported_formality_goal(rid):
    response = rid["client"].post("/api/review", json={"text": "ทดสอบ", "formality": "shouting"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "INVALID_GOAL"


def test_review_still_answers_when_the_semantic_index_is_unavailable(rid):
    from khamlink.observability import Telemetry
    from khamlink.review import ReviewService
    from khamlink.services import ContextService

    settings = rid["settings"].model_copy(update={"semantic_enabled": False})
    telemetry = Telemetry(settings, rid["factory"])
    search = SearchService(settings, rid["repo"], rid["factory"], telemetry)
    context = ContextService(settings, rid["repo"], search, None)
    service = ReviewService(settings, rid["repo"], search, context, telemetry)
    result = service.review("เขาเอาขันไปตักน้ำ", "neutral", rid["cid"])
    assert result["degraded"] is True
    assert result["degraded_reason"] == "SEMANTIC_INDEX_UNAVAILABLE"
    # Everything that does not need the index still works.
    assert result["tokens"] and result["stats"]["characters"] > 0
