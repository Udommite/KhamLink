"""Royal Institute Dictionary corpus ingestion from the normalised Parquet bundle.

The Wiktionary CSV path in `ingestion.py` stays untouched; this stages a different
source shape (``senses.parquet`` + ``relations.parquet``) into the same tables, so
every downstream contract — lookup, evidence, word map, provenance — is unchanged.

Identifiers are derived from the Parquet row id rather than hashed, because the
precomputed BGE-M3 index in ``embeddings.parquet`` is keyed by that id: retrieval
has to get from a vector row back to a stored definition without a side table.
"""

import json
import re
from pathlib import Path

import pyarrow.parquet as pq

from .db import AuditEvent, Dataset, Definition, QualityIssue, Relationship, Word, WordAlias
from .domain import NORMALIZATION_VERSION, DomainError, normalize, stable_id, validate_text
from .ingestion import IngestionService, sha256_file
from .security import Principal

CORPUS_FORMAT = "rid-parquet"
SENSE_FIELDS = [
    "id",
    "headword",
    "headword_en",
    "sense_no",
    "pronunciation",
    "ipa",
    "pos",
    "definition",
    "register",
    "example",
    "etymology",
    "citation",
    "note",
    "edition",
    "tags",
    "source_file",
    "source_row",
]
METADATA_FIELDS = [
    "headword_en",
    "sense_no",
    "pronunciation",
    "ipa",
    "register",
    "example",
    "etymology",
    "citation",
    "note",
    "edition",
    "tags",
    "source_file",
    "source_row",
]
# The published dictionary editions are searchable on the Society's dictionary portal;
# the term lists and dialect studies are only on its main site. Neither exposes a stable
# per-entry address, so the exact locator is carried in sense metadata instead.
DICTIONARY_PORTAL = "https://dictionary.orst.go.th/"
SOCIETY_PORTAL = "https://www.orst.go.th/"
RECORD_PORTALS = (DICTIONARY_PORTAL, SOCIETY_PORTAL)
RELATION_MAP = {"synonym": "similar", "variant": "related", "see_also": "related"}
_DEFINITION_ID = re.compile(r"d_rid_(\d+)")


def definition_id_for(sense_id: int) -> str:
    return f"d_rid_{int(sense_id)}"


def sense_id_of(definition_id: str) -> int | None:
    match = _DEFINITION_ID.fullmatch(definition_id or "")
    return int(match[1]) if match else None


def aliases_of(headword: str) -> list[str]:
    """Written forms a reader might type. 'อนุรักษ-, อนุรักษ์' -> both, plus the bound stem."""
    forms = {headword.strip()}
    for part in headword.split(","):
        part = part.strip()
        if part:
            forms.add(part)
            if part.endswith("-"):
                forms.add(part[:-1])
    return sorted(f for f in forms if f)


def load_rid_manifest(path: Path) -> dict:
    manifest = json.loads(Path(path).read_text(encoding="utf-8"))
    required = {"source_id", "name", "corpus", "version", "retrieved_at", "license", "sha256", "provenance"}
    if manifest.get("format") != CORPUS_FORMAT:
        raise DomainError("INVALID_SOURCE_SCHEMA", "manifest นี้ไม่ใช่รูปแบบ rid-parquet", 409)
    if any(not manifest.get(k) for k in required) or manifest.get("approved") is not True:
        raise DomainError("UNAPPROVED_SOURCE", "แหล่งข้อมูลหรือสิทธิ์ใช้งานยังไม่ผ่านการตรวจสอบ", 409)
    if manifest["provenance"] != "SOURCE_DATA":
        raise DomainError("INVALID_PROVENANCE", "ประเภทและที่มาของข้อมูลไม่ถูกต้อง", 409)
    if not isinstance(manifest.get("official_royal_society"), bool):
        raise DomainError("INVALID_PROVENANCE", "ต้องระบุสถานะความเป็นข้อมูลทางการอย่างชัดเจน", 409)
    if not re.fullmatch(r"[a-f0-9]{64}", manifest["sha256"]):
        raise DomainError("UNAPPROVED_SOURCE", "checksum ไม่ถูกต้อง", 409)
    return manifest


def _clean(value) -> str:
    return value.strip() if isinstance(value, str) else ("" if value is None else str(value))


class RIDIngestionService(IngestionService):
    """Stages the Parquet bundle. Validation and publication are inherited unchanged."""

    def stage(
        self, path: Path, principal: Principal, correlation_id: str, manifest: dict | None = None
    ) -> dict:
        self.security.authorize(principal, "import", correlation_id)
        path = Path(path)
        approved = load_rid_manifest(self.settings.source_manifest)
        if manifest is not None and manifest != approved:
            raise DomainError("UNAPPROVED_SOURCE", "ข้อมูลแหล่งที่มาไม่ตรงกับ manifest ที่อนุมัติ", 409)
        manifest = approved
        checksum = sha256_file(path)
        if checksum != manifest["sha256"]:
            raise DomainError("CHECKSUM_MISMATCH", "ไฟล์ corpus ไม่ตรงกับรุ่นที่อนุมัติ", 409)
        dataset_id = stable_id(
            "ds", manifest["source_id"], manifest["version"], checksum, NORMALIZATION_VERSION
        )
        with self.sessions() as session:
            existing = session.get(Dataset, dataset_id)
            if existing:
                return self.summary(existing, idempotent=True)

        words, definitions, aliases, issues = self._read_senses(path, dataset_id)
        if not words:
            raise DomainError("EMPTY_DATASET", "ไม่มีระเบียนที่ผ่านการตรวจสอบ", 409)
        edges = self._read_relations(path.with_name("relations.parquet"), dataset_id, definitions)

        with self.sessions.begin() as session:
            session.add(
                Dataset(
                    dataset_id=dataset_id,
                    source_id=manifest["source_id"],
                    version=manifest["version"],
                    manifest=manifest,
                    checksum=checksum,
                    state="Staged",
                    imported_by=principal.subject,
                    record_count=len(words),
                    issue_count=len(issues),
                )
            )
            session.flush()
            for table, rows in [
                (Word, list(words.values())),
                (Definition, definitions),
                (WordAlias, aliases),
                (QualityIssue, issues),
                (Relationship, edges),
            ]:
                for start in range(0, len(rows), 5000):
                    session.execute(table.__table__.insert(), rows[start : start + 5000])
            session.add(
                AuditEvent(
                    actor=principal.subject,
                    action="import",
                    outcome="completed",
                    correlation_id=correlation_id,
                    resource_id=dataset_id,
                )
            )
            return self.summary(session.get(Dataset, dataset_id))

    @staticmethod
    def _read_senses(path: Path, dataset_id: str):
        columns = pq.read_table(path, columns=SENSE_FIELDS).to_pydict()
        words: dict[str, dict] = {}
        alias_seen: set[tuple[str, str]] = set()
        definitions: list[dict] = []
        aliases: list[dict] = []
        issues: list[dict] = []
        numbering: dict[str, int] = {}
        for row in range(len(columns["id"])):
            sense_id = columns["id"][row]
            headword = _clean(columns["headword"][row])
            text = _clean(columns["definition"][row])
            english = _clean(columns["headword_en"][row])
            # Coined-term and transliteration lists carry no prose definition: the record IS
            # the Thai/English equivalence, so that equivalence is the text. Flagged in
            # metadata so the card can say what kind of record it is rather than imply a gloss.
            term_equivalent = not text and bool(english)
            if term_equivalent:
                text = english
            if not headword or not text:
                issues.append(
                    {
                        "dataset_id": dataset_id,
                        "row_number": int(sense_id) + 1,
                        "code": "MISSING_DEFINITION_TEXT" if headword else "MISSING_HEADWORD",
                    }
                )
                continue
            try:
                validate_text(headword, 512, "word")
                validate_text(text, 20000, "definition")
            except DomainError:
                issues.append(
                    {"dataset_id": dataset_id, "row_number": int(sense_id) + 1, "code": "RECORD_QUARANTINED"}
                )
                continue
            word_id = stable_id("w", "rid", headword)
            if word_id not in words:
                words[word_id] = {
                    "dataset_id": dataset_id,
                    "word_id": word_id,
                    "word": headword,
                    "normalized": normalize(headword),
                    "provenance": "SOURCE_DATA",
                }
                for alias in aliases_of(headword):
                    if (alias, word_id) not in alias_seen:
                        alias_seen.add((alias, word_id))
                        aliases.append({"dataset_id": dataset_id, "alias": alias, "word_id": word_id})
            edition = _clean(columns["edition"][row])
            numbering[word_id] = numbering.get(word_id, 0) + 1
            definitions.append(
                {
                    "dataset_id": dataset_id,
                    "definition_id": definition_id_for(sense_id),
                    "word_id": word_id,
                    "number": numbering[word_id],
                    "text": text,
                    "part_of_speech": _clean(columns["pos"][row]) or None,
                    "metadata_fields": {
                        **{
                            name: _clean(columns[name][row])
                            for name in METADATA_FIELDS
                            if _clean(columns[name][row])
                        },
                        **({"record_kind": "term_equivalent"} if term_equivalent else {}),
                    },
                    "record_url": DICTIONARY_PORTAL if edition.startswith("royal_") else SOCIETY_PORTAL,
                    "provenance": "SOURCE_DATA",
                }
            )
        return words, definitions, aliases, issues

    @staticmethod
    def _read_relations(path: Path, dataset_id: str, definitions: list[dict]):
        if not path.exists():
            return []
        stored = {sense_id_of(d["definition_id"]): d for d in definitions}
        columns = pq.read_table(path, columns=["from_id", "to_id", "relation_type"]).to_pydict()
        edges: dict[str, dict] = {}
        for row in range(len(columns["from_id"])):
            source, target = columns["from_id"][row], columns["to_id"][row]
            kind = RELATION_MAP.get(columns["relation_type"][row])
            if target is None or not kind:
                continue
            from_sense, to_sense = stored.get(source), stored.get(target)
            if not from_sense or not to_sense:
                continue
            from_word, to_word = from_sense["word_id"], to_sense["word_id"]
            if from_word == to_word:
                continue
            relationship_id = stable_id("r", from_word, to_word, kind)
            edges.setdefault(
                relationship_id,
                {
                    "dataset_id": dataset_id,
                    "relationship_id": relationship_id,
                    "from_id": from_word,
                    "to_id": to_word,
                    "type": kind,
                    "provenance": "SOURCE_DATA",
                    "process_id": "rid-source-cross-reference-v1",
                    "evidence_ids": [from_sense["definition_id"]],
                },
            )
        return list(edges.values())
