import hashlib
import re
import unicodedata
from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

NORMALIZATION_VERSION = "thai-display-preserving-trim-v1"


class Provenance(StrEnum):
    SOURCE = "SOURCE_DATA"
    CURATED = "CURATED_METADATA"
    AI = "AI_GENERATED_METADATA"
    USER = "USER_GENERATED_DATA"


class RelationType(StrEnum):
    SIMILAR = "similar"
    OPPOSITE = "opposite"
    BROADER = "broader"
    NARROWER = "narrower"
    CONFUSED = "confused-with"
    RELATED = "related"


class DomainError(Exception):
    def __init__(self, code: str, message: str, status: int = 400, fields: list | None = None):
        super().__init__(code)
        self.code, self.message, self.status, self.fields = code, message, status, fields or []


def normalize(text: str) -> str:
    """Do not NFC/NFKC, remove marks, fold Thai vowels, or conflate orthographic forms."""
    return text.strip()


def validate_text(text: str, limit: int, field: str = "query") -> str:
    if not isinstance(text, str) or not normalize(text):
        raise DomainError("INVALID_INPUT", "กรุณากรอกข้อความก่อนดำเนินการ", fields=[field])
    if len(text) > limit:
        raise DomainError("INPUT_TOO_LONG", f"กรุณาใช้ข้อความไม่เกิน {limit} ตัวอักษร", fields=[field])
    if any(
        unicodedata.category(c) in {"Cs", "Co"}
        or (unicodedata.category(c) == "Cc" and c not in "\n\r\t")
        or c in "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069"
        for c in text
    ):
        raise DomainError("INVALID_ENCODING", "ข้อความมีอักขระควบคุมที่ไม่รองรับ", fields=[field])
    return normalize(text)


def stable_id(prefix: str, *parts: str) -> str:
    return prefix + "_" + hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()[:24]


def safe_id(value: str) -> bool:
    return bool(re.fullmatch(r"[a-z][a-z0-9_-]{1,100}", value))


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class SearchRequest(StrictModel):
    query: str
    limit: int = 10
    offset: int = 0


class CompareRequest(StrictModel):
    word_ids: list[str] = Field(min_length=2)


class ContextRequest(StrictModel):
    text: str


class ContextSelection(ContextRequest):
    word_id: str
    start: int = Field(ge=0)
    end: int = Field(gt=0)


class ReviewRequest(StrictModel):
    text: str
    formality: str = "neutral"


class ExplanationRequest(StrictModel):
    word_id: str
    definition_id: str | None = None


class FeedbackRequest(StrictModel):
    target_token: str = Field(max_length=4096)
    interaction_id: str = Field(pattern=r"^[a-f0-9-]{36}$")
    rating: str | None = None
    reason: str | None = None
    details: str | None = None


class EventRequest(StrictModel):
    name: str = Field(max_length=50)
    refs: dict[str, Any] = Field(default_factory=dict)
