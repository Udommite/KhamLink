from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


def now() -> str:
    return datetime.now(UTC).isoformat()


class Base(DeclarativeBase):
    pass


class Dataset(Base):
    __tablename__ = "source_versions"
    dataset_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    source_id: Mapped[str] = mapped_column(String(80), index=True)
    version: Mapped[str] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(24), default="Staged")
    manifest: Mapped[dict] = mapped_column(JSON)
    checksum: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    imported_by: Mapped[str] = mapped_column(String(80))
    approved_by: Mapped[str | None] = mapped_column(String(80))
    record_count: Mapped[int] = mapped_column(Integer, default=0)
    issue_count: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (
        CheckConstraint("state IN ('Staged','Quarantined','Validated','Published','Superseded','Withdrawn')"),
    )


class ActiveRelease(Base):
    __tablename__ = "active_release"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dataset_id: Mapped[str | None] = mapped_column(ForeignKey("source_versions.dataset_id"))
    index_id: Mapped[str | None] = mapped_column(String(80))
    revision: Mapped[int] = mapped_column(Integer, default=0)
    __table_args__ = (CheckConstraint("id = 1"),)


class Word(Base):
    __tablename__ = "source_words"
    dataset_id: Mapped[str] = mapped_column(ForeignKey("source_versions.dataset_id"), primary_key=True)
    word_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    word: Mapped[str] = mapped_column(String(512))
    normalized: Mapped[str] = mapped_column(String(512))
    provenance: Mapped[str] = mapped_column(String(30), default="SOURCE_DATA")
    __table_args__ = (
        Index("ix_words_lookup", "dataset_id", "normalized"),
        CheckConstraint("provenance = 'SOURCE_DATA'"),
    )


class Definition(Base):
    __tablename__ = "source_definitions"
    dataset_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    definition_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    word_id: Mapped[str] = mapped_column(String(80), index=True)
    number: Mapped[int] = mapped_column(Integer)
    text: Mapped[str] = mapped_column(Text)
    part_of_speech: Mapped[str | None] = mapped_column(String(100))
    metadata_fields: Mapped[dict] = mapped_column(JSON, default=dict)
    record_url: Mapped[str] = mapped_column(Text)
    provenance: Mapped[str] = mapped_column(String(30), default="SOURCE_DATA")
    __table_args__ = (
        ForeignKeyConstraint(["dataset_id", "word_id"], ["source_words.dataset_id", "source_words.word_id"]),
        CheckConstraint("number > 0"),
        CheckConstraint("provenance = 'SOURCE_DATA'"),
        Index("ix_senses_word", "dataset_id", "word_id", "number", unique=True),
    )


class CuratedMetadata(Base):
    __tablename__ = "curated_metadata"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(String(80))
    word_id: Mapped[str] = mapped_column(String(80))
    definition_id: Mapped[str | None] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(40))
    text: Mapped[str] = mapped_column(Text)
    evidence_ids: Mapped[list] = mapped_column(JSON)
    process_id: Mapped[str] = mapped_column(String(80))
    provenance: Mapped[str] = mapped_column(String(30), default="CURATED_METADATA")
    __table_args__ = (
        ForeignKeyConstraint(["dataset_id", "word_id"], ["source_words.dataset_id", "source_words.word_id"]),
        CheckConstraint("provenance = 'CURATED_METADATA'"),
    )


class Relationship(Base):
    __tablename__ = "published_relationships"
    dataset_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    relationship_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    from_id: Mapped[str] = mapped_column(String(80), index=True)
    to_id: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(20))
    provenance: Mapped[str] = mapped_column(String(30))
    process_id: Mapped[str] = mapped_column(String(100))
    evidence_ids: Mapped[list] = mapped_column(JSON)
    __table_args__ = (
        ForeignKeyConstraint(["dataset_id", "from_id"], ["source_words.dataset_id", "source_words.word_id"]),
        ForeignKeyConstraint(["dataset_id", "to_id"], ["source_words.dataset_id", "source_words.word_id"]),
        CheckConstraint("provenance IN ('SOURCE_DATA','CURATED_METADATA')"),
        CheckConstraint("type IN ('similar','opposite','broader','narrower','confused-with','related')"),
    )


class QualityIssue(Base):
    __tablename__ = "quality_issues"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("source_versions.dataset_id"))
    row_number: Mapped[int] = mapped_column(Integer)
    code: Mapped[str] = mapped_column(String(50))


class IndexBuild(Base):
    __tablename__ = "derived_ai_indexes"
    index_id: Mapped[str] = mapped_column(String(80), primary_key=True)
    dataset_id: Mapped[str] = mapped_column(ForeignKey("source_versions.dataset_id"))
    manifest: Mapped[dict] = mapped_column(JSON)
    validated: Mapped[bool] = mapped_column(Boolean, default=False)
    provenance: Mapped[str] = mapped_column(String(30), default="AI_GENERATED_METADATA")
    __table_args__ = (CheckConstraint("provenance = 'AI_GENERATED_METADATA'"),)


class Feedback(Base):
    __tablename__ = "user_feedback"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)
    target_id: Mapped[str] = mapped_column(String(100))
    target_type: Mapped[str] = mapped_column(String(30))
    dataset_id: Mapped[str] = mapped_column(String(80))
    interaction_hash: Mapped[str] = mapped_column(String(64))
    rating: Mapped[str | None] = mapped_column(String(16))
    reason: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[str] = mapped_column(String(40), default=now)
    provenance: Mapped[str] = mapped_column(String(30), default="USER_GENERATED_DATA")
    __table_args__ = (CheckConstraint("provenance = 'USER_GENERATED_DATA'"),)


class TelemetryEvent(Base):
    __tablename__ = "telemetry_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurred_at: Mapped[str] = mapped_column(String(40), default=now)
    name: Mapped[str] = mapped_column(String(60))
    correlation_id: Mapped[str] = mapped_column(String(40))
    environment: Mapped[str] = mapped_column(String(20))
    dimensions: Mapped[dict] = mapped_column(JSON)
    duration_ms: Mapped[float | None] = mapped_column(Float)


class AuditEvent(Base):
    __tablename__ = "administrative_audit"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    occurred_at: Mapped[str] = mapped_column(String(40), default=now)
    actor: Mapped[str] = mapped_column(String(80))
    action: Mapped[str] = mapped_column(String(40))
    outcome: Mapped[str] = mapped_column(String(20))
    correlation_id: Mapped[str] = mapped_column(String(40))
    resource_id: Mapped[str | None] = mapped_column(String(100))


def make_engine(url: str):
    options = (
        {"connect_args": {"check_same_thread": False, "timeout": 30}}
        if url.startswith("sqlite")
        else {"pool_pre_ping": True}
    )
    engine = create_engine(url, **options)
    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def sqlite_constraints(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")
            connection.execute("PRAGMA journal_mode=WAL")

    return engine


def sessions(engine):
    return sessionmaker(engine, expire_on_commit=False)
