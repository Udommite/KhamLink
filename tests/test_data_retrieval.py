import pytest
from conftest import FIXTURE_WORDS, write_corpus
from khamlink.db import CuratedMetadata, Dataset, Definition, QualityIssue, Relationship, Word
from khamlink.domain import DomainError, RelationType, stable_id
from khamlink.ingestion import IngestionService
from khamlink.retrieval import HippoRAG2Adapter, IndexBuilder
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from test_api import data


def test_VAL_040_041_042_idempotent_quarantine_publication(system, tmp_path):
    old_release = system["repo"].release()
    same = system["ingest"].stage(system["path"], system["principal"], system["cid"])
    assert same["idempotent"] and same["dataset_id"] == old_release["dataset_id"]
    invalid_path, manifest = write_corpus(
        tmp_path,
        {**FIXTURE_WORDS, "": {"คำนาม": ["bad identity"]}, "บกพร่อง": {}, "เสีย": {"คำนาม": [""]}},
        "fixture-v2",
    )
    settings = system["settings"].model_copy(update={"source_manifest": manifest})
    ingestion = IngestionService(settings, system["factory"], system["security"])
    staged = ingestion.stage(invalid_path, system["principal"], system["cid"])
    assert staged["issues"] == 3 and staged["records"] == len(FIXTURE_WORDS)
    assert (
        ingestion.validate(staged["dataset_id"], system["principal"], system["cid"])["state"] == "Quarantined"
    )
    with pytest.raises(DomainError, match="INVALID_STATE"):
        ingestion.publish(staged["dataset_id"], system["principal"], system["cid"], old_release["revision"])
    assert system["repo"].release() == old_release
    assert system["repo"].lookup("อนุรักษ์")["source"]["version"] == "fixture-v1"
    approved = ingestion.validate(
        staged["dataset_id"], system["principal"], system["cid"], accept_quarantine=True
    )
    assert approved["state"] == "Validated"
    # Explicit approval publishes only the valid subset; bad rows remain quarantined.
    ingestion.publish(staged["dataset_id"], system["principal"], system["cid"], old_release["revision"])
    new_word = system["repo"].lookup("อนุรักษ์")
    assert new_word["word_id"] == stable_id("w", "synthetic-test-source", "อนุรักษ์")
    assert new_word["source"]["version"] == "fixture-v2"
    with system["factory"]() as session:
        assert session.get(Dataset, old_release["dataset_id"]).state == "Superseded"
        assert (
            len(
                session.scalars(
                    select(QualityIssue).where(QualityIssue.dataset_id == staged["dataset_id"])
                ).all()
            )
            == 3
        )
    # A stale publish revision must not win a race or silently overwrite the current release.
    with pytest.raises(DomainError, match="VERSION_CONFLICT"):
        ingestion.publish(staged["dataset_id"], system["principal"], system["cid"], old_release["revision"])
    # Roll back using the explicitly approved old manifest and current revision.
    system["ingest"].publish(
        old_release["dataset_id"],
        system["principal"],
        system["cid"],
        old_release["revision"] + 1,
        old_release["index_id"],
    )
    assert system["repo"].lookup("อนุรักษ์")["source"]["version"] == "fixture-v1"


def test_VAL_042_unapproved_checksum_and_roles(system, tmp_path):
    wrong = tmp_path / "wrong.csv"
    wrong.write_text("word,meaning\nword,untrusted", encoding="utf-8")
    with pytest.raises(DomainError, match="CHECKSUM_MISMATCH"):
        system["ingest"].stage(wrong, system["principal"], system["cid"])
    with pytest.raises(DomainError, match="UNAPPROVED_SOURCE"):
        system["ingest"].stage(
            system["path"], system["principal"], system["cid"], manifest={"approved": True}
        )
    curator = system["security"].authenticate("test-curator-credential")
    with pytest.raises(DomainError, match="FORBIDDEN"):
        system["ingest"].publish(system["dataset_id"], curator, system["cid"], 1)
    with pytest.raises(DomainError, match="FORBIDDEN"):
        system["ingest"].stage(
            system["path"], system["security"].authenticate("test-operator-credential"), system["cid"]
        )


@pytest.mark.parametrize(
    "entity,field,value",
    [
        (Word, "word", " "),
        (Word, "normalized", "wrong"),
        (Definition, "text", ""),
        (Definition, "record_url", ""),
        (Dataset, "source_id", ""),
        (Dataset, "version", ""),
    ],
)
@pytest.mark.parametrize("gate", ["validate", "publish"])
def test_VAL_040_041_042_stored_mandatory_defects_block_both_gates(
    system, tmp_path, entity, field, value, gate
):
    old = system["repo"].release()
    path, manifest = write_corpus(tmp_path, FIXTURE_WORDS, "fixture-gate")
    settings = system["settings"].model_copy(update={"source_manifest": manifest})
    ingest = IngestionService(settings, system["factory"], system["security"])
    staged = ingest.stage(path, system["principal"], system["cid"])
    dataset_id = staged["dataset_id"]
    if gate == "publish":
        assert ingest.validate(dataset_id, system["principal"], system["cid"])["state"] == "Validated"
    with system["factory"].begin() as session:
        row = session.scalars(select(entity).where(entity.dataset_id == dataset_id)).first()
        setattr(row, field, value)
    if gate == "validate":
        result = ingest.validate(dataset_id, system["principal"], system["cid"], accept_quarantine=True)
        assert result["state"] == "Quarantined"  # Explicit subset approval never bypasses a mandatory defect.
    else:
        with pytest.raises(DomainError, match="DATA_INTEGRITY"):
            ingest.publish(dataset_id, system["principal"], system["cid"], old["revision"])
    with system["factory"]() as session:
        assert session.scalars(
            select(QualityIssue).where(QualityIssue.dataset_id == dataset_id, QualityIssue.row_number == 0)
        ).first()
    assert system["repo"].release() == old
    assert system["repo"].lookup("อนุรักษ์")["source"]["version"] == "fixture-v1"


def test_VAL_042_057_corrupt_or_incompatible_index_cannot_publish(system):
    old = system["repo"].release()
    index = IndexBuilder(system["settings"], system["repo"], system["factory"], system["security"]).build(
        system["dataset_id"], system["principal"], system["cid"]
    )
    mismatched = system["settings"].model_copy(update={"recognition_threshold": 0.99})
    ingest = IngestionService(mismatched, system["factory"], system["security"])
    with pytest.raises(DomainError, match="INDEX_MISMATCH"):
        ingest.publish(
            system["dataset_id"], system["principal"], system["cid"], old["revision"], index["index_id"]
        )
    graph = system["settings"].data_dir / "indexes" / index["index_id"] / "graph.json"
    with graph.open("ab") as stream:
        stream.write(b" ")
    with pytest.raises(DomainError, match="INDEX_MISMATCH"):
        system["ingest"].publish(
            system["dataset_id"], system["principal"], system["cid"], old["revision"], index["index_id"]
        )
    assert system["repo"].release() == old


def test_VAL_013_023_024_025_026_038_all_relationship_types(system):
    repo = system["repo"]
    center, target = repo.lookup("ความสุข"), repo.lookup("ทุกข์")
    for kind in RelationType:
        with system["factory"].begin() as session:
            session.add(
                Relationship(
                    dataset_id=center["dataset_id"],
                    relationship_id=stable_id("r", kind),
                    from_id=center["word_id"],
                    to_id=target["word_id"],
                    type=kind.value,
                    provenance="CURATED_METADATA",
                    process_id="synthetic-human-review-test",
                    evidence_ids=[center["definitions"][0]["definition_id"]],
                )
            )
    relationships = data(system["client"].get("/api/words/ความสุข/related"))["relationships"]
    assert {r["type"] for r in relationships} == {k.value.replace("confused-with", "confused_with") for k in RelationType}
    assert all(r["eligible"] and r["publication_state"] == "Published" for r in relationships)
    assert all(r["source_word_id"] == center["word_id"] and r["target_word_id"] == target["word_id"] for r in relationships)
    assert all(
        r["provenance"] == "CURATED_METADATA" and repo.lookup(r["to_id"])["word"] == "ทุกข์"
        for r in relationships
    )
    assert repo.related("อนุรักษ์", 16)["relationships"] == []
    explicit_source_edge = repo.related("ศูนย์", 16)["relationships"][0]
    assert explicit_source_edge["type"] == "related" and explicit_source_edge["provenance"] == "SOURCE_DATA"
    with pytest.raises(IntegrityError), system["factory"].begin() as session:
        session.add(
            Relationship(
                dataset_id=center["dataset_id"],
                relationship_id="r_unknown",
                from_id=center["word_id"],
                to_id=target["word_id"],
                type="made-up",
                provenance="SOURCE_DATA",
                process_id="bad",
                evidence_ids=[],
            )
        )
    with pytest.raises(IntegrityError), system["factory"].begin() as session:
        session.add(
            Relationship(
                dataset_id=center["dataset_id"],
                relationship_id="r_ai",
                from_id=center["word_id"],
                to_id=target["word_id"],
                type="related",
                provenance="AI_GENERATED_METADATA",
                process_id="model",
                evidence_ids=[],
            )
        )
    # Broken required target definition is suppressed, never silently linked.
    with system["factory"].begin() as session:
        session.get(Definition, (target["dataset_id"], target["definitions"][0]["definition_id"])).text = ""
    assert repo.related("ความสุข", 16)["relationships"] == []


def test_VAL_011_012_029_041_curated_evidence(system):
    word = system["repo"].lookup("อนุรักษ์")
    with system["factory"].begin() as session:
        session.add(
            CuratedMetadata(
                id="m_summary",
                dataset_id=word["dataset_id"],
                word_id=word["word_id"],
                kind="simplified_explanation",
                text="รักษาสิ่งนั้นไว้ในสภาพเดิม",
                evidence_ids=[word["definitions"][0]["definition_id"]],
                process_id="synthetic-human-test",
            )
        )
        session.add(
            CuratedMetadata(
                id="m_unlinked",
                dataset_id=word["dataset_id"],
                word_id=word["word_id"],
                kind="example",
                text="should never display without evidence",
                evidence_ids=["d_missing"],
                process_id="synthetic-test",
            )
        )
    result = data(system["client"].post("/api/explanations", json={"word_id": word["word_id"]}))
    assert result["state"] == "curated" and result["provenance"] == "CURATED_METADATA"
    assert len(system["repo"].lookup(word["word_id"])["curated_metadata"]) == 1
    with pytest.raises(IntegrityError), system["factory"].begin() as session:
        session.add(
            Word(
                dataset_id=word["dataset_id"],
                word_id="w_ai",
                word="invented",
                normalized="invented",
                provenance="AI_GENERATED_METADATA",
            )
        )


def test_VAL_005_026_057_fresh_index_and_dense_fallback(system, tmp_path):
    builder = IndexBuilder(system["settings"], system["repo"], system["factory"], system["security"])
    index = builder.build(system["dataset_id"], system["principal"], system["cid"])
    assert index["index_id"] != system["index"]["index_id"]
    assert index["source_checksum"] == system["index"]["source_checksum"]
    assert system["repo"].release()["index_id"] == system["index"]["index_id"]
    folder = system["settings"].data_dir / "indexes" / index["index_id"]

    class NoSeeds:
        identity = "fake-recognition-empty"

        def filter(self, *_args):
            return []

    adapter = HippoRAG2Adapter(system["settings"], folder, index, recognition=NoSeeds())
    assert adapter.retrieve("รักษาให้คงเดิม", 10)["mode"] == "dense_fallback"
    assert adapter.retrieve("รักษาให้คงเดิม", 10)["candidates"]
    assert index["provenance"] == "AI_GENERATED_METADATA"
    assert index["triples"] > 0 and index["phrases"] > 0
    wrong = system["settings"].model_copy(update={"recognition_threshold": 0.99})
    with pytest.raises(ValueError, match="incompatible_index_identity"):
        HippoRAG2Adapter(wrong, folder, index)
    with (folder / "graph.json").open("ab") as stream:
        stream.write(b" ")
    with pytest.raises(ValueError, match="index_checksum_mismatch"):
        HippoRAG2Adapter(system["settings"], folder, index)


def test_VAL_005_057_synonym_rule_benchmark(system):
    settings = system["settings"].model_copy(update={"synonym_enabled": True, "synonym_threshold": 0.999})
    index = IndexBuilder(settings, system["repo"], system["factory"], system["security"]).build(
        system["dataset_id"], system["principal"], system["cid"]
    )
    assert index["config"]["synonym_threshold"] == 0.999
    assert index["configuration_hash"] != system["index"]["configuration_hash"]
    adapter = HippoRAG2Adapter(settings, settings.data_dir / "indexes" / index["index_id"], index)
    hits = adapter.retrieve("รักษาให้คงเดิม", 5)["candidates"]
    assert system["repo"].lookup("อนุรักษ์")["word_id"] in {h["word_id"] for h in hits}
