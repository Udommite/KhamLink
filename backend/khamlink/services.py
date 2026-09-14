import hashlib
import threading

import numpy as np

from .db import Feedback
from .domain import DomainError, stable_id, validate_text


class ComparisonService:
    def __init__(self, repository, grounding):
        self.repository, self.grounding = repository, grounding

    def compare(self, ids):
        """Compare distinct words, bounding total input instead of the visible column count."""
        terms = [validate_text(key, 512, "word_ids") for key in ids]
        if sum(len(key) for key in terms) > 4096:
            raise DomainError("INPUT_TOO_LONG", "ข้อมูลคำที่เปรียบเทียบยาวเกิน 4096 ตัวอักษร", fields=["word_ids"])
        if len(terms) < 2 or len(set(terms)) != len(terms):
            raise DomainError("INVALID_COMPARISON", "กรุณาเลือกคำที่แตกต่างกันอย่างน้อยสองคำ", fields=["word_ids"])
        records, errors = [], []
        for key in terms:
            try:
                records.append(self.repository.lookup(key))
            except DomainError as error:
                errors.append({"word_id": key, "code": error.code, "message": error.message})
        if len({r["word_id"] for r in records}) != len(records):
            raise DomainError("DUPLICATE_COMPARISON", "กรุณาเลือกคำที่แตกต่างกันอย่างน้อยสองคำ", fields=["word_ids"])
        return {
            "words": records,
            "errors": errors,
            "state": "results" if not errors else "partial_failure" if records else "failed",
            "guidance": "แสดงเฉพาะบริบท ตัวอย่าง และข้อควรระวังที่มีหลักฐาน หากไม่มีข้อมูลจะไม่สร้างกฎการใช้คำขึ้นเอง",
        }


class ContextService:
    def __init__(self, settings, repository, search, grounding):
        self.settings, self.repository, self.search, self.grounding = settings, repository, search, grounding
        self.dataset_id, self.trie = None, {}
        self.lock = threading.Lock()

    def detect(self, text):
        release = self.repository.release()
        with self.lock:
            if self.dataset_id != release["dataset_id"]:
                trie = {}
                for word, word_id in self.repository.word_forms(release["dataset_id"]).items():
                    node = trie
                    for char in word:
                        node = node.setdefault(char, {})
                    node[""] = word_id
                self.trie, self.dataset_id = trie, release["dataset_id"]
            trie = self.trie
        # Leftmost longest matching against approved source forms, retaining code-point offsets.
        spans, start = [], 0
        while start < len(text):
            node, end, found = trie, start, None
            while end < len(text) and text[end] in node:
                node = node[text[end]]
                end += 1
                if "" in node:
                    found = {"word_id": node[""], "text": text[start:end], "start": start, "end": end}
            if found:
                spans.append(found)
                start = found["end"]
            else:
                start += 1
        return {
            "spans": spans,
            "offset_unit": "unicode_code_points",
            "state": "detected" if spans else "no_detection",
            "dataset_id": release["dataset_id"],
        }

    def explain(self, selection, correlation_id):
        spans = self.detect(selection.text)["spans"]
        if not any(
            s["word_id"] == selection.word_id and s["start"] == selection.start and s["end"] == selection.end
            for s in spans
        ):
            raise DomainError(
                "INVALID_SPAN", "กรุณาเลือกคำที่ตรวจพบในข้อความนี้", fields=["start", "end", "word_id"]
            )
        record = self.repository.lookup(selection.word_id)
        senses = record["definitions"]
        selected_ids, ambiguous = [s["definition_id"] for s in senses], len(senses) > 1
        if len(senses) > 1:
            try:
                adapter = self.search.load_adapter(self.repository.release())
                # Remove the selected span before scoring so the headword does not pick its own sense.
                context = selection.text[: selection.start] + " " + selection.text[selection.end :]
                # Prefer the cross-encoder. Measured on this corpus, the bi-encoder's gap
                # between two senses of one word is ~0.01 (max 0.07 over 40 words), so no
                # absolute cosine margin can separate them and the old 0.12 resolved none
                # of them — every polysemous word came back "ambiguous". The cross-encoder
                # reads context and sense together and separates them in logit space.
                texts = [s["text"] for s in senses]
                scores = getattr(adapter, "score_senses", lambda *_: None)(context, texts)
                if scores is not None:
                    scores = np.asarray(scores, dtype="float32")
                    order = np.argsort(-scores, kind="stable")
                    resolved = scores[order[0]] - scores[order[1]] >= self.settings.sense_logit_margin
                else:
                    query = (
                        adapter.embedding.encode_query(context)
                        if hasattr(adapter.embedding, "encode_query")
                        else adapter.embedding.encode([context])[0]
                    )
                    scores = adapter.embedding.encode(texts) @ query
                    order = np.argsort(-scores, kind="stable")
                    resolved = (
                        scores[order[0]] >= self.settings.semantic_threshold
                        and scores[order[0]] - scores[order[1]] >= self.settings.sense_margin
                    )
                if resolved:
                    selected_ids, ambiguous = [senses[order[0]]["definition_id"]], False
            except Exception:
                # Visible rather than silent: an adapter failure and a genuinely ambiguous
                # word produced the same output before, so neither could be diagnosed.
                self.search.telemetry.emit(
                    "dependency", correlation_id, {"dependency": "sense_selection", "status": "failed"}
                )
        explanation = (
            self.grounding.fallback("ambiguous")
            if ambiguous
            else self.grounding.explain(
                [record], correlation_id, task="context", user_content=selection.text, sense_ids=selected_ids
            )
        )
        relations = self.repository.related(record["word_id"], self.settings.map_limit)["relationships"]
        alternatives = (
            [
                {
                    "word_id": r["to_id"],
                    "word": r["word"],
                    "description": r["description"],
                    "source": r["source"],
                    "provenance": r["provenance"],
                    "evidence_ids": r["evidence_ids"],
                    "qualification": "คำใกล้เคียงที่มีหลักฐานความสัมพันธ์ โปรดเทียบความหมายก่อนใช้แทน",
                }
                for r in relations
                if r["type"] == "similar"
            ]
            if not ambiguous
            else []
        )
        if getattr(self.grounding.provider, "generates_paraphrases", False):
            qualified = []
            for alternative in alternatives[:1]:
                target = self.repository.lookup(alternative["word_id"], record["dataset_id"])
                rationale = self.grounding.explain(
                    [record, target],
                    correlation_id,
                    task="alternatives",
                    user_content=selection.text,
                    sense_ids=selected_ids + [s["definition_id"] for s in target["definitions"]],
                )
                if rationale["state"] == "grounded":
                    qualified.append({**alternative, "generated_explanation": rationale})
            alternatives = qualified
        return {
            "selection": {
                "word_id": selection.word_id,
                "start": selection.start,
                "end": selection.end,
                "text": selection.text[selection.start : selection.end],
            },
            "word": record,
            "sense_ids": selected_ids,
            "ambiguous": ambiguous,
            "explanation": explanation,
            "alternatives": alternatives,
        }


class FeedbackService:
    def __init__(self, settings, sessions, security, repository):
        self.settings, self.sessions, self.security, self.repository = (
            settings,
            sessions,
            security,
            repository,
        )
        self.lock = threading.Lock()

    def submit(self, payload):
        target = self.security.verify_target(payload.target_token)
        if target["dataset"] != self.repository.release()["dataset_id"]:
            raise DomainError("STALE_TARGET", "ข้อมูลเปลี่ยนรุ่นแล้ว กรุณาเปิดผลลัพธ์ใหม่", 409)
        if (payload.rating is None) == (payload.reason is None):
            raise DomainError("INVALID_FEEDBACK", "กรุณาเลือกคะแนนหรือเหตุผลอย่างใดอย่างหนึ่ง")
        if payload.rating and payload.rating not in {"useful", "not_useful"}:
            raise DomainError("INVALID_RATING", "กรุณาเลือกคะแนนที่รองรับ", fields=["rating"])
        if payload.reason and payload.reason not in {"incorrect", "confusing", "source", "other"}:
            raise DomainError("INVALID_REASON", "กรุณาเลือกเหตุผลที่รองรับ", fields=["reason"])
        if payload.details:
            validate_text(payload.details, self.settings.report_limit, "details")
            raise DomainError(
                "FREE_TEXT_DISABLED", "รุ่นนี้รับเฉพาะเหตุผลที่เลือก ไม่เก็บรายละเอียดข้อความ", fields=["details"]
            )
        interaction = hashlib.sha256(payload.interaction_id.encode()).hexdigest()
        feedback_id = stable_id(
            "fb",
            interaction,
            target["dataset"],
            target["type"],
            target["id"],
            "rating" if payload.rating else "report",
        )
        with self.lock, self.sessions.begin() as session:
            existing = session.get(Feedback, feedback_id)
            if existing:
                existing.rating, existing.reason = payload.rating, payload.reason
            else:
                session.add(
                    Feedback(
                        id=feedback_id,
                        target_id=target["id"],
                        target_type=target["type"],
                        dataset_id=target["dataset"],
                        interaction_hash=interaction,
                        rating=payload.rating,
                        reason=payload.reason,
                    )
                )
        return {"feedback_id": feedback_id, "state": "submitted", "provenance": "USER_GENERATED_DATA"}
