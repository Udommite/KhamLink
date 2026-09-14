from typing import Protocol
from urllib.parse import quote

from sqlalchemy import or_, select

from .db import ActiveRelease, CuratedMetadata, Dataset, Definition, Relationship, Word, WordAlias
from .domain import DomainError, RelationType, normalize


class LexicalRepository(Protocol):
    def release(self) -> dict: ...
    def lookup(self, key: str, dataset_id: str | None = None) -> dict: ...
    def lexical(self, query: str, dataset_id: str, limit: int) -> list[dict]: ...
    def passages(self, dataset_id: str) -> list[dict]: ...


class SQLLexicalRepository:
    def __init__(self, sessions):
        self.sessions = sessions

    def release(self) -> dict:
        with self.sessions() as session:
            active = session.get(ActiveRelease, 1)
            source = session.get(Dataset, active.dataset_id) if active and active.dataset_id else None
            if not source or source.state != "Published" or not self.eligible(source):
                raise DomainError("SOURCE_UNAVAILABLE", "ยังไม่มีชุดข้อมูลที่เผยแพร่ กรุณาลองอีกครั้งภายหลัง", 503)
            return {
                "dataset_id": source.dataset_id,
                "index_id": active.index_id,
                "revision": active.revision,
                "source_id": source.source_id,
                "source_version": source.version,
            }

    @staticmethod
    def eligible(source):
        return (
            source.manifest.get("approved") is True
            and source.manifest.get("provenance") == "SOURCE_DATA"
            and isinstance(source.manifest.get("official_royal_society"), bool)
            and source.version
            and source.source_id
        )

    def source(self, dataset_id: str) -> dict:
        current = self.release()
        if current["dataset_id"] != dataset_id:
            raise DomainError("SOURCE_NOT_CURRENT", "ข้อมูลรุ่นนี้ไม่ได้เผยแพร่อยู่ กรุณาเปิดคำใหม่", 404)
        with self.sessions() as session:
            source = session.get(Dataset, dataset_id)
            manifest = dict(source.manifest)
            manifest.update(
                {
                    "dataset_id": source.dataset_id,
                    "published_state": source.state,
                    "imported_at": source.created_at,
                }
            )
            return manifest

    def lookup(self, key: str, dataset_id: str | None = None) -> dict:
        current = self.release()
        if dataset_id and dataset_id != current["dataset_id"]:
            raise DomainError("VERSION_CHANGED", "ข้อมูลเปลี่ยนรุ่นแล้ว กรุณาลองอีกครั้ง", 409)
        dataset_id = current["dataset_id"]
        with self.sessions() as session:
            source = session.get(Dataset, dataset_id)
            word = session.scalar(
                select(Word).where(
                    Word.dataset_id == dataset_id,
                    Word.word_id == key if key.startswith("w_") else Word.normalized == normalize(key),
                )
            )
            if not word and not key.startswith("w_"):
                # A reader types one written form; RID files several under one entry
                # ('อนุรักษ-, อนุรักษ์'), so the display headword alone would not match.
                word = session.scalar(
                    select(Word)
                    .join(
                        WordAlias,
                        (Word.dataset_id == WordAlias.dataset_id) & (Word.word_id == WordAlias.word_id),
                    )
                    .where(WordAlias.dataset_id == dataset_id, WordAlias.alias == normalize(key))
                    .order_by(Word.word_id)
                )
            if not word:
                raise DomainError("WORD_NOT_FOUND", "ไม่พบคำนี้ในชุดข้อมูลที่เผยแพร่ ลองกลับไปค้นหาคำอื่น", 404)
            senses = session.scalars(
                select(Definition)
                .where(Definition.dataset_id == dataset_id, Definition.word_id == word.word_id)
                .order_by(Definition.number)
            ).all()
            if (
                not senses
                or not word.word.strip()
                or word.provenance != "SOURCE_DATA"
                or any(
                    not s.text.strip() or not s.record_url or s.provenance != "SOURCE_DATA" for s in senses
                )
            ):
                raise DomainError("DATA_INTEGRITY", "ข้อมูลคำนี้ยังตรวจสอบได้ไม่ครบ กรุณาลองคำอื่นหรือแจ้งปัญหา", 503)
            source_ref = {
                "source_id": source.source_id,
                "version": source.version,
                "dataset_id": dataset_id,
                "name": source.manifest["name"],
                "license": source.manifest["license"],
                "license_url": source.manifest["license_url"],
                "official_royal_society": source.manifest["official_royal_society"],
                "provenance": "SOURCE_DATA",
            }
            definitions = [
                {
                    "definition_id": s.definition_id,
                    "number": s.number,
                    "text": s.text,
                    "part_of_speech": s.part_of_speech,
                    "metadata": s.metadata_fields,
                    "record_url": s.record_url,
                    "history_url": s.record_url
                    if source.manifest.get("format")
                    else "https://th.wiktionary.org/w/index.php?title="
                    + quote(word.word)
                    + "&action=history",
                    "provenance": "SOURCE_DATA",
                    "source": source_ref,
                }
                for s in senses
            ]
            valid_ids = {s.definition_id for s in senses}
            curated = [
                {
                    "id": m.id,
                    "definition_id": m.definition_id,
                    "kind": m.kind,
                    "text": m.text,
                    "evidence_ids": m.evidence_ids,
                    "process_id": m.process_id,
                    "provenance": "CURATED_METADATA",
                }
                for m in session.scalars(
                    select(CuratedMetadata).where(
                        CuratedMetadata.dataset_id == dataset_id,
                        CuratedMetadata.word_id == word.word_id,
                        CuratedMetadata.provenance == "CURATED_METADATA",
                    )
                )
                if m.evidence_ids
                and set(m.evidence_ids) <= valid_ids
                and (not m.definition_id or m.definition_id in valid_ids)
            ]
            return {
                "word_id": word.word_id,
                "word": word.word,
                "dataset_id": dataset_id,
                "state": "Published",
                "provenance": "SOURCE_DATA",
                "definitions": definitions,
                "source": source_ref,
                "curated_metadata": curated,
                "ai_generated_metadata": [],
                "user_generated_data": [],
            }

    def lexical(self, query: str, dataset_id: str, limit: int) -> list[dict]:
        """Exact and prefix matches over every written form of an entry, not only its
        display headword. A dataset with no alias rows behaves exactly as before."""
        escaped = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        with self.sessions() as session:
            exact = set(
                session.scalars(
                    select(Word.word_id).where(Word.dataset_id == dataset_id, Word.normalized == query)
                )
            )
            exact |= set(
                session.scalars(
                    select(WordAlias.word_id).where(
                        WordAlias.dataset_id == dataset_id, WordAlias.alias == query
                    )
                )
            )
            forms = []
            for table, column in ((Word, Word.normalized), (WordAlias, WordAlias.alias)):
                forms.extend(
                    session.execute(
                        select(table.word_id, column)
                        .where(
                            table.dataset_id == dataset_id,
                            column != query,
                            column.like(escaped + "%", escape="\\"),
                        )
                        .order_by(column, table.word_id)
                        .limit(limit)
                    ).all()
                )
            partial, seen = [], set(exact)
            for word_id, _form in sorted(forms, key=lambda row: (row[1], row[0])):
                if word_id in seen:
                    continue
                seen.add(word_id)
                partial.append(word_id)
                if len(partial) >= limit:
                    break
            return [{"word_id": w, "match_type": "exact", "lexical": 1.0} for w in sorted(exact)] + [
                {"word_id": w, "match_type": "partial", "lexical": 0.8} for w in partial
            ]

    def word_forms(self, dataset_id: str) -> dict[str, str]:
        """Every form Context Lens may detect in running text, aliases included."""
        with self.sessions() as session:
            forms = {
                w.normalized: w.word_id
                for w in session.scalars(select(Word).where(Word.dataset_id == dataset_id))
            }
            for alias, word_id in session.execute(
                select(WordAlias.alias, WordAlias.word_id).where(WordAlias.dataset_id == dataset_id)
            ).all():
                forms.setdefault(alias, word_id)
            return forms

    def passages(self, dataset_id: str) -> list[dict]:
        with self.sessions() as session:
            source = session.get(Dataset, dataset_id)
            if (
                not source
                or source.state not in {"Validated", "Published", "Superseded"}
                or not self.eligible(source)
            ):
                raise DomainError("INELIGIBLE_INDEX_SOURCE", "ดัชนีต้องสร้างจากชุดข้อมูลที่ผ่านการตรวจสอบ", 409)
            rows = session.execute(
                select(Word, Definition)
                .join(
                    Definition,
                    (Word.dataset_id == Definition.dataset_id) & (Word.word_id == Definition.word_id),
                )
                .where(Word.dataset_id == dataset_id)
                .order_by(Word.word_id, Definition.number)
            ).all()
            return [
                {
                    "passage_id": d.definition_id,
                    "word_id": w.word_id,
                    "definition_id": d.definition_id,
                    "word": w.word,
                    "number": d.number,
                    "text": d.text,
                    "part_of_speech": d.part_of_speech,
                    "source_id": source.source_id,
                    "source_version": source.version,
                    "dataset_id": dataset_id,
                    "provenance": "SOURCE_DATA",
                    "publication_state_at_build": source.state,
                }
                for w, d in rows
                if w.provenance == d.provenance == "SOURCE_DATA"
                and w.word.strip()
                and d.text.strip()
                and d.record_url
            ]

    def related(self, key: str, limit: int) -> dict:
        center = self.lookup(key)
        dataset_id = center["dataset_id"]
        with self.sessions() as session:
            relations = session.scalars(
                select(Relationship)
                .where(
                    Relationship.dataset_id == dataset_id,
                    or_(Relationship.from_id == center["word_id"], Relationship.to_id == center["word_id"]),
                    Relationship.provenance.in_(["SOURCE_DATA", "CURATED_METADATA"]),
                )
                .order_by(Relationship.type, Relationship.relationship_id)
            ).all()
            result = []
            inverse = {"broader": "narrower", "narrower": "broader"}
            for edge in relations:
                if edge.type not in set(RelationType) or not edge.evidence_ids:
                    continue
                evidence = session.scalars(
                    select(Definition.definition_id).where(
                        Definition.dataset_id == dataset_id,
                        Definition.definition_id.in_(edge.evidence_ids),
                        Definition.provenance == "SOURCE_DATA",
                    )
                ).all()
                if set(evidence) != set(edge.evidence_ids):
                    continue
                outgoing = edge.from_id == center["word_id"]
                target_id = edge.to_id if outgoing else edge.from_id
                try:
                    target = self.lookup(target_id, dataset_id)
                except DomainError:
                    continue
                result.append(
                    {
                        "relationship_id": edge.relationship_id,
                        "from_id": center["word_id"],
                        "to_id": target_id,
                        "type": (edge.type if outgoing else inverse.get(edge.type, edge.type)).replace(
                            "confused-with", "confused_with"
                        ),
                        "source_word_id": edge.from_id,
                        "target_word_id": edge.to_id,
                        "publication_state": "Published",
                        "eligible": True,
                        "node_type": "word",
                        "word": target["word"],
                        "description": target["definitions"][0]["text"],
                        "provenance": edge.provenance,
                        "process_id": edge.process_id,
                        "evidence_ids": edge.evidence_ids,
                        "source": center["source"],
                    }
                )
                if len(result) >= limit:
                    break
            return {
                "center": {"word_id": center["word_id"], "word": center["word"], "node_type": "word"},
                "relationships": result,
                "limit": limit,
                "complete": False,
                "state": "available" if result else "no_relationships",
                "dataset_id": dataset_id,
            }

    def evidence(self, definition_id: str) -> dict:
        release = self.release()
        with self.sessions() as session:
            definition = session.get(Definition, (release["dataset_id"], definition_id))
            if not definition:
                raise DomainError("EVIDENCE_NOT_FOUND", "ไม่พบหลักฐานในรุ่นที่เผยแพร่", 404)
            word = self.lookup(definition.word_id)
            return {
                **next(d for d in word["definitions"] if d["definition_id"] == definition_id),
                "word": word["word"],
                "word_id": word["word_id"],
            }
