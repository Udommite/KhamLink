import base64
import hashlib
import hmac
import json
import secrets
import threading
import time
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import sessionmaker

from .config import Settings
from .db import AuditEvent
from .domain import DomainError

ROLE_PERMISSIONS = {
    "evaluator": {"analytics"},
    "curator": {"import", "validate", "quality", "curate"},
    "operator": {"metrics", "logs", "runtime"},
    "admin": {
        "analytics",
        "reports",
        "import",
        "validate",
        "publish",
        "quality",
        "curate",
        "metrics",
        "logs",
        "runtime",
        "roles",
        "retention",
    },
    "search_service": {"telemetry"},
    "ingestion_service": {"import", "validate"},
}
EXTRA_PERMISSIONS = {"publish", "reports", "analytics"}


@dataclass(frozen=True)
class Principal:
    subject: str
    permissions: frozenset[str]


class Security:
    def __init__(self, settings: Settings, sessions: sessionmaker):
        self.settings, self.sessions = settings, sessions
        self.identities = json.loads(settings.identities_json)
        self.feedback_key = secrets.token_bytes(32)

    def authenticate(self, token: str | None) -> Principal:
        digest = hashlib.sha256((token or "").encode()).hexdigest()
        identity = next((v for k, v in self.identities.items() if hmac.compare_digest(digest, k)), None)
        if not identity or not token:
            raise DomainError("UNAUTHENTICATED", "กรุณายืนยันตัวตนสำหรับงานผู้ดูแล", 401)
        try:
            expires = datetime.fromisoformat(identity["expires_at"])
            if expires.tzinfo is None or expires <= datetime.now(UTC):
                raise ValueError("expired")
            subject = identity["subject"]
            if not isinstance(subject, str) or not subject or len(subject) > 80:
                raise ValueError("invalid subject")
            roles = identity["roles"]
            permissions = set().union(*(ROLE_PERMISSIONS.get(role, set()) for role in roles))
            permissions |= set(identity.get("permissions", [])) & EXTRA_PERMISSIONS
            return Principal(subject, frozenset(permissions))
        except (KeyError, TypeError, ValueError):
            raise DomainError("UNAUTHENTICATED", "ข้อมูลยืนยันตัวตนหมดอายุหรือไม่ถูกต้อง", 401) from None

    def authorize(self, principal: Principal, action: str, correlation_id: str, resource_id=None):
        allowed = action in principal.permissions
        # Privileged paths fail closed if their required audit cannot be persisted.
        with self.sessions.begin() as session:
            session.add(
                AuditEvent(
                    actor=principal.subject,
                    action=action,
                    outcome="authorized" if allowed else "denied",
                    correlation_id=correlation_id,
                    resource_id=resource_id,
                )
            )
        if not allowed:
            raise DomainError("FORBIDDEN", "บัญชีนี้ไม่มีสิทธิ์ดำเนินการ", 403)

    def target_token(self, target_type: str, target_id: str, dataset_id: str) -> str:
        payload = json.dumps(
            {"type": target_type, "id": target_id, "dataset": dataset_id, "exp": int(time.time()) + 7200},
            separators=(",", ":"),
        ).encode()
        body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
        signature = hmac.new(self.feedback_key, body.encode(), hashlib.sha256).hexdigest()
        return body + "." + signature

    def verify_target(self, token: str) -> dict:
        try:
            body, signature = token.split(".")
            if not hmac.compare_digest(
                hmac.new(self.feedback_key, body.encode(), hashlib.sha256).hexdigest(), signature
            ):
                raise ValueError("signature")
            data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
            if data["exp"] < time.time():
                raise ValueError("expired")
            return data
        except (ValueError, KeyError, TypeError):
            raise DomainError("INVALID_TARGET", "ผลลัพธ์หมดอายุ กรุณาเปิดผลลัพธ์ใหม่แล้วลองอีกครั้ง") from None


class RateLimiter:
    """Bounded ephemeral, keyed-HMAC buckets. A single API worker is the MVP topology."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.salt = secrets.token_bytes(32)
        self.buckets: dict[tuple[str, str], tuple[int, int]] = {}
        self.lock = threading.Lock()

    def check(self, peer: str, cost: str):
        limits = {
            "lookup": self.settings.lookup_rate,
            "costly": self.settings.costly_rate,
            "feedback": self.settings.feedback_rate,
        }
        minute = int(time.time() // 60)
        key = (hmac.new(self.salt, peer.encode(), hashlib.sha256).hexdigest(), cost)
        with self.lock:
            if len(self.buckets) > 10000:
                self.buckets = {k: v for k, v in self.buckets.items() if v[0] == minute}
                if len(self.buckets) > 10000:
                    raise DomainError("RATE_LIMITED", "มีผู้ใช้งานจำนวนมาก กรุณาลองอีกครั้งในหนึ่งนาที", 429)
            old_minute, count = self.buckets.get(key, (minute, 0))
            count = count if old_minute == minute else 0
            if count >= limits[cost]:
                raise DomainError("RATE_LIMITED", "ส่งคำขอถี่เกินไป กรุณาลองอีกครั้งในหนึ่งนาที", 429)
            self.buckets[key] = (minute, count + 1)
