import ast
import csv
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import quote

import httpx
from sqlalchemy import select, update

from .config import Settings
from .db import (
    ActiveRelease,
    AuditEvent,
    Dataset,
    Definition,
    IndexBuild,
    QualityIssue,
    Relationship,
    Word,
    now,
)
from .domain import NORMALIZATION_VERSION, DomainError, normalize, stable_id, validate_text
from .security import Principal, Security

SOURCE_POS = {
    "คำนาม",
    "คำกริยา",
    "คำวิเศษณ์",
    "คำคุณศัพท์",
    "คำกริยาวิเศษณ์",
    "คำสรรพนาม",
    "คำสันธาน",
    "คำบุพบท",
    "คำอุทาน",
    "คำลักษณนาม",
    "คำอนุภาค",
    "คำวิสามานยนาม",
    "คำบอกจำนวน",
    "คำกำหนด",
    "คำย่อ",
    "คำอุปสรรค",
    "คำปัจจัย",
    "วลี",
    "สำนวน",
    "สุภาษิต",
    "อักษร",
    "สัญลักษณ์",
    "รากศัพท์",
    "หน่วยคำเติม",
    "พยางค์",
    "คำสันธานวิเศษณ์",
}


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def load_manifest(path: Path) -> dict:
    manifest = json.loads(path.read_text(encoding="utf-8"))
    required = {
        "source_id",
        "name",
        "corpus",
        "version",
        "download_url",
        "retrieved_at",
        "upstream_origin",
        "license",
        "sha256",
        "provenance",
    }
    if any(not manifest.get(k) for k in required) or manifest.get("approved") is not True:
        raise DomainError("UNAPPROVED_SOURCE", "แหล่งข้อมูลหรือสิทธิ์ใช้งานยังไม่ผ่านการตรวจสอบ", 409)
    if manifest["provenance"] != "SOURCE_DATA" or manifest.get("official_royal_society") is not False:
        raise DomainError("INVALID_PROVENANCE", "ประเภทและที่มาของข้อมูลไม่ถูกต้อง", 409)
    if manifest["license"] != "CC-BY-SA-4.0" or not re.fullmatch(r"[a-f0-9]{64}", manifest["sha256"]):
        raise DomainError("UNAPPROVED_SOURCE", "ใบอนุญาตหรือ checksum ไม่ตรงนโยบายของ corpus นี้", 409)
    return manifest


def approved_manifest(settings: Settings) -> dict:
    """Load the manifest for whichever corpus shape this deployment is configured for."""
    from .rid import CORPUS_FORMAT, load_rid_manifest

    try:
        declared = json.loads(settings.source_manifest.read_text(encoding="utf-8")).get("format")
    except (OSError, json.JSONDecodeError, AttributeError):
        declared = None
    if declared == CORPUS_FORMAT:
        return load_rid_manifest(settings.source_manifest)
    return load_manifest(settings.source_manifest)


def acquire(settings: Settings) -> Path:
    """Pinned artifact download. Never trust an unpinned live latest_version registry."""
    from .rid import CORPUS_FORMAT

    manifest = approved_manifest(settings)
    if manifest.get("format") == CORPUS_FORMAT:
        # Licensed corpus: supplied by the operator, verified in place, never fetched.
        path = settings.corpus_dir / manifest["files"]["senses"]
        if not path.exists():
            raise DomainError(
                "CORPUS_MISSING", f"ไม่พบไฟล์ corpus ที่ {path} กรุณาตั้งค่า KHAMLINK_CORPUS_DIR", 409
            )
        if sha256_file(path) != manifest["sha256"]:
            raise DomainError("CHECKSUM_MISMATCH", "ไฟล์ corpus ไม่ตรงกับรุ่นที่อนุมัติ", 409)
        return path
    folder = settings.data_dir / "cache" / manifest["corpus"] / manifest["version"]
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "thai_dictionary.csv"
    if path.exists():
        if sha256_file(path) != manifest["sha256"]:
            raise DomainError("CHECKSUM_MISMATCH", "ไฟล์ corpus ไม่ตรงกับรุ่นที่อนุมัติ", 409)
        return path
    url = manifest["download_url"]
    if not url.startswith("https://github.com/PyThaiNLP/pythainlp-corpus/releases/download/"):
        raise DomainError("UNAPPROVED_DOWNLOAD", "ไม่อนุญาตปลายทางดาวน์โหลดนี้", 409)
    fd, temp_name = tempfile.mkstemp(prefix="download-", suffix=".part", dir=folder)
    try:
        size = 0
        with (
            os.fdopen(fd, "wb") as output,
            httpx.stream("GET", url, follow_redirects=True, timeout=60) as response,
        ):
            response.raise_for_status()
            for chunk in response.iter_bytes():
                size += len(chunk)
                if size > manifest["size_bytes"]:
                    raise DomainError("ARTIFACT_TOO_LARGE", "ขนาดไฟล์ corpus ไม่ตรง manifest", 409)
                output.write(chunk)
        if size != manifest["size_bytes"] or sha256_file(Path(temp_name)) != manifest["sha256"]:
            raise DomainError("CHECKSUM_MISMATCH", "ไฟล์ corpus ไม่ตรงกับรุ่นที่อนุมัติ", 409)
        os.replace(temp_name, path)
    finally:
        if Path(temp_name).exists():
            Path(temp_name).unlink()
    return path


class IngestionService:
    def __init__(self, settings: Settings, sessions, security: Security):
        self.settings, self.sessions, self.security = settings, sessions, security

    @staticmethod
    def integrity_defects(session, source) -> set[str]:
        """Recheck stored records at both gates; import-time validation is not enough."""
        defects = set()
        manifest = source.manifest
        if (
            not source.source_id
            or not source.version
            or not source.imported_by
            or source.source_id != manifest.get("source_id")
            or source.version != manifest.get("version")
            or source.checksum != manifest.get("sha256")
            or manifest.get("provenance") != "SOURCE_DATA"
            or manifest.get("approved") is not True
            or not isinstance(manifest.get("official_royal_society"), bool)
        ):
            defects.add("SOURCE_INTEGRITY_FAILED")
        words = session.scalars(select(Word).where(Word.dataset_id == source.dataset_id)).all()
        word_ids = {word.word_id for word in words}
        if not words or len(words) != source.record_count:
            defects.add("WORD_COUNT_MISMATCH")
        for word in words:
            try:
                validate_text(word.word, 512, "word")
                if (
                    not word.word_id
                    or word.normalized != normalize(word.word)
                    or word.provenance != "SOURCE_DATA"
                ):
                    raise ValueError("invalid_identity")
            except (DomainError, ValueError, TypeError):
                defects.add("WORD_INTEGRITY_FAILED")
        senses = session.scalars(select(Definition).where(Definition.dataset_id == source.dataset_id)).all()
        from .rid import CORPUS_FORMAT, RECORD_PORTALS

        # An exact allow-list, not a bare scheme: relaxing this to "https://" accepted any
        # origin as a source link, which is more than the new corpus ever needed.
        record_prefixes = (
            RECORD_PORTALS if manifest.get("format") == CORPUS_FORMAT else ("https://th.wiktionary.org/wiki/",)
        )
        covered = set()
        seen = set()
        for sense in senses:
            try:
                validate_text(sense.text, 20000, "definition")
                if (
                    not sense.definition_id
                    or sense.word_id not in word_ids
                    or sense.provenance != "SOURCE_DATA"
                    or sense.number < 1
                    or not sense.record_url.startswith(record_prefixes)
                    or (sense.word_id, sense.number) in seen
                ):
                    raise ValueError("invalid_sense")
                covered.add(sense.word_id)
                seen.add((sense.word_id, sense.number))
            except (DomainError, ValueError, TypeError, AttributeError):
                defects.add("DEFINITION_INTEGRITY_FAILED")
        if word_ids != covered:
            defects.add("MISSING_VALID_DEFINITION")
        # Dataset-level defects have row 0 because a stored row need not map to one CSV row.
        existing = set(
            session.scalars(
                select(QualityIssue.code).where(
                    QualityIssue.dataset_id == source.dataset_id, QualityIssue.row_number == 0
                )
            )
        )
        for code in defects - existing:
            session.add(QualityIssue(dataset_id=source.dataset_id, row_number=0, code=code))
            source.issue_count += 1
        return defects

    def stage(
        self, path: Path, principal: Principal, correlation_id: str, manifest: dict | None = None
    ) -> dict:
        self.security.authorize(principal, "import", correlation_id)
        approved = load_manifest(self.settings.source_manifest)
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
        # One transaction: parse failure never exposes a half-imported dataset.
        with self.sessions.begin() as session, path.open(encoding="utf-8-sig", newline="") as stream:
            source = Dataset(
                dataset_id=dataset_id,
                source_id=manifest["source_id"],
                version=manifest["version"],
                manifest=manifest,
                checksum=checksum,
                state="Staged",
                imported_by=principal.subject,
            )
            session.add(source)
            session.flush()
            reader = csv.DictReader(stream)
            if reader.fieldnames != ["word", "meaning"]:
                raise DomainError("INVALID_SOURCE_SCHEMA", "รูปแบบ corpus ไม่ตรงสัญญาการนำเข้า", 409)
            words, definitions, issues = {}, [], []
            source_senses: dict[str, set] = {}
            for number, row in enumerate(reader, 2):
                try:
                    display = row["word"]
                    word = validate_text(display, 512, "word")
                    literal = row["meaning"]
                    if not literal or len(literal) > 100000:
                        raise ValueError("INVALID_MEANING")
                    meaning = ast.literal_eval(literal)
                    if not isinstance(meaning, dict) or not meaning:
                        raise ValueError("MISSING_DEFINITION")
                    senses = []
                    for pos, texts in meaning.items():
                        if not isinstance(pos, str) or not isinstance(texts, list):
                            raise ValueError("INVALID_MEANING")
                        for text in texts:
                            validate_text(text, 20000, "definition")
                            senses.append((pos, text))
                    if not senses:
                        raise ValueError("MISSING_DEFINITION")
                    word_id = stable_id("w", source.source_id, word)
                    words.setdefault(
                        word_id,
                        {
                            "dataset_id": dataset_id,
                            "word_id": word_id,
                            "word": display,
                            "normalized": normalize(display),
                            "provenance": "SOURCE_DATA",
                        },
                    )
                    seen = source_senses.setdefault(word_id, set())
                    for pos, text in senses:
                        if (pos, text) in seen:
                            continue
                        seen.add((pos, text))
                        sense_no = len(seen)
                        definitions.append(
                            {
                                "dataset_id": dataset_id,
                                "definition_id": stable_id("d", word_id, pos, str(sense_no)),
                                "word_id": word_id,
                                "number": sense_no,
                                "text": text,
                                "part_of_speech": pos if pos in SOURCE_POS else None,
                                "metadata_fields": {},
                                "record_url": "https://th.wiktionary.org/wiki/" + quote(word),
                                "provenance": "SOURCE_DATA",
                            }
                        )
                        if pos not in SOURCE_POS:
                            issues.append(
                                {
                                    "dataset_id": dataset_id,
                                    "row_number": number,
                                    "code": "OPTIONAL_POS_UNMAPPED",
                                }
                            )
                except (ValueError, SyntaxError, TypeError, KeyError, DomainError, RecursionError):
                    issues.append(
                        {"dataset_id": dataset_id, "row_number": number, "code": "RECORD_QUARANTINED"}
                    )
            if not words:
                raise DomainError("EMPTY_DATASET", "ไม่มีระเบียนที่ผ่านการตรวจสอบ", 409)
            session.execute(Word.__table__.insert(), list(words.values()))
            session.execute(Definition.__table__.insert(), definitions)
            if issues:
                session.execute(QualityIssue.__table__.insert(), issues)
            # Only explicit cross-references in the source, never model-derived edges.
            by_word = {row["normalized"]: wid for wid, row in words.items()}
            edges = []
            for sense in definitions:
                match = re.fullmatch(r"ดู (.+?)[.]?", sense["text"].strip())
                target = by_word.get(match[1]) if match else None
                if target and target != sense["word_id"]:
                    edges.append(
                        {
                            "dataset_id": dataset_id,
                            "relationship_id": stable_id("r", sense["definition_id"], target),
                            "from_id": sense["word_id"],
                            "to_id": target,
                            "type": "related",
                            "provenance": "SOURCE_DATA",
                            "process_id": "source-explicit-see-reference-v1",
                            "evidence_ids": [sense["definition_id"]],
                        }
                    )
            if edges:
                session.execute(Relationship.__table__.insert(), edges)
            source.record_count, source.issue_count = len(words), len(issues)
            session.add(
                AuditEvent(
                    actor=principal.subject,
                    action="import",
                    outcome="completed",
                    correlation_id=correlation_id,
                    resource_id=dataset_id,
                )
            )
            session.flush()
            return self.summary(source)

    def validate(
        self, dataset_id: str, principal: Principal, correlation_id: str, accept_quarantine=False
    ) -> dict:
        self.security.authorize(principal, "validate", correlation_id, dataset_id)
        with self.sessions.begin() as session:
            source = session.get(Dataset, dataset_id)
            if not source:
                raise DomainError("NOT_FOUND", "ไม่พบชุดข้อมูล", 404)
            if source.state not in {"Staged", "Quarantined", "Validated"}:
                raise DomainError("INVALID_STATE", "สถานะชุดข้อมูลไม่อนุญาตการตรวจสอบใหม่", 409)
            defects = self.integrity_defects(session, source)
            if defects or (source.issue_count and not accept_quarantine):
                source.state = "Quarantined"
            else:
                source.state = "Validated"
            session.add(
                AuditEvent(
                    actor=principal.subject,
                    action="validate",
                    outcome=source.state,
                    correlation_id=correlation_id,
                    resource_id=dataset_id,
                )
            )
            return self.summary(source)

    def publish(
        self,
        dataset_id: str,
        principal: Principal,
        correlation_id: str,
        expected_revision: int,
        index_id: str | None = None,
    ) -> dict:
        self.security.authorize(principal, "publish", correlation_id, dataset_id)
        # Keep integrity reports durable even when publication is rejected. Never alter the
        # active pointer here; only the compare-and-swap transaction below may publish.
        with self.sessions.begin() as session:
            source = session.get(Dataset, dataset_id)
            if not source or source.state not in {"Validated", "Superseded", "Published"}:
                raise DomainError("INVALID_STATE", "ต้องตรวจสอบข้อมูลก่อนเผยแพร่", 409)
            defects = self.integrity_defects(session, source)
            if defects:
                if source.state == "Validated":
                    source.state = "Quarantined"
                session.add(
                    AuditEvent(
                        actor=principal.subject,
                        action="publish",
                        outcome="integrity_failed",
                        correlation_id=correlation_id,
                        resource_id=dataset_id,
                    )
                )
        if defects:
            raise DomainError("DATA_INTEGRITY", "ข้อมูลไม่ผ่านการตรวจสอบความครบถ้วน ไม่สามารถเผยแพร่ได้", 409)
        with self.sessions.begin() as session:
            source = session.get(Dataset, dataset_id)
            if not source or source.state not in {"Validated", "Superseded", "Published"}:
                raise DomainError("INVALID_STATE", "ต้องตรวจสอบข้อมูลก่อนเผยแพร่", 409)
            if source.manifest != approved_manifest(self.settings):
                raise DomainError("UNAPPROVED_SOURCE", "manifest เปลี่ยน ต้องตรวจสอบและนำเข้าใหม่", 409)
            if index_id:
                index = session.get(IndexBuild, index_id)
                if not index or not index.validated or index.dataset_id != dataset_id:
                    raise DomainError("INDEX_MISMATCH", "ดัชนีไม่ตรงกับชุดข้อมูล", 409)
                from .retrieval import verify_index_files

                try:
                    if (
                        index.manifest["dataset_id"] != dataset_id
                        or index.manifest["source_id"] != source.source_id
                        or index.manifest["source_version"] != source.version
                        or index.manifest["source_checksum"] != source.checksum
                        or not re.fullmatch(r"idx_[a-f0-9]{32}", index_id)
                    ):
                        raise ValueError("index_source_mismatch")
                    verify_index_files(
                        self.settings, self.settings.data_dir / "indexes" / index_id, index.manifest
                    )
                except (ValueError, KeyError, OSError, TypeError):
                    raise DomainError("INDEX_MISMATCH", "ดัชนีไม่ตรงรุ่นหรือไฟล์ไม่ผ่านการตรวจสอบ", 409) from None
            active = session.get(ActiveRelease, 1)
            old_dataset_id = active.dataset_id if active else None
            if not active:
                raise DomainError("MIGRATION_REQUIRED", "กรุณาอัปเดตโครงสร้างฐานข้อมูล", 503)
            result = session.execute(
                update(ActiveRelease)
                .where(ActiveRelease.id == 1, ActiveRelease.revision == expected_revision)
                .values(dataset_id=dataset_id, index_id=index_id, revision=expected_revision + 1)
            )
            if result.rowcount != 1:
                raise DomainError("VERSION_CONFLICT", "มีการเผยแพร่รุ่นใหม่แล้ว กรุณาตรวจสอบอีกครั้ง", 409)
            if old_dataset_id and old_dataset_id != dataset_id:
                session.get(Dataset, old_dataset_id).state = "Superseded"
            source.state, source.approved_by = "Published", principal.subject
            session.add(
                AuditEvent(
                    actor=principal.subject,
                    action="publish",
                    outcome="completed",
                    correlation_id=correlation_id,
                    resource_id=dataset_id,
                )
            )
            return {
                "dataset_id": dataset_id,
                "index_id": index_id,
                "revision": expected_revision + 1,
                "published_at": now(),
            }

    @staticmethod
    def summary(source, idempotent=False):
        return {
            "dataset_id": source.dataset_id,
            "state": source.state,
            "records": source.record_count,
            "issues": source.issue_count,
            "idempotent": idempotent,
        }
