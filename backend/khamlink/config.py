import os
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

ROOT = Path(os.environ.get("KHAMLINK_PROJECT_ROOT", Path(__file__).resolve().parents[2])).resolve()


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="KHAMLINK_",
        env_file=".env",
        extra="ignore",
        hide_input_in_errors=True,
        populate_by_name=True,
    )
    environment: Literal["local", "test", "production"] = "local"
    database_url: str = "sqlite:///data/khamlink.db"
    data_dir: Path = ROOT / "data"
    source_manifest: Path = ROOT / "sources/thai_dict-1.0.json"
    query_limit: int = Field(300, ge=1, le=2000)
    context_limit: int = Field(3000, ge=1, le=20000)
    report_limit: int = Field(1000, ge=1, le=4000)
    page_limit: int = Field(20, ge=1, le=100)
    map_limit: int = Field(16, ge=1, le=50)
    body_limit: int = Field(65536, ge=1024, le=1048576)
    lookup_rate: int = Field(240, ge=1)
    costly_rate: int = Field(40, ge=1)
    feedback_rate: int = Field(20, ge=1)
    cache_ttl: int = Field(120, ge=0, le=3600)
    cache_size: int = Field(512, ge=1, le=10000)
    analytics_enabled: bool = False
    retention_days: int = Field(7, ge=1, le=365)
    # SHA256 bearer digests mapped to server-side roles, expiry and explicit extra permissions.
    identities_json: str = "{}"
    provider: Literal["disabled", "extractive", "compatible", "glm"] = Field(
        "glm", validation_alias=AliasChoices("LLM_PROVIDER", "KHAMLINK_PROVIDER")
    )
    provider_url: str = Field("", validation_alias=AliasChoices("LLM_BASE_URL", "KHAMLINK_PROVIDER_URL"))
    provider_model: str = Field(
        "z-ai/glm-5.3-flash", validation_alias=AliasChoices("LLM_MODEL", "KHAMLINK_PROVIDER_MODEL")
    )
    provider_key: str = Field(
        "", repr=False, validation_alias=AliasChoices("LLM_API_KEY", "KHAMLINK_PROVIDER_KEY")
    )
    provider_timeout: float = Field(
        30.0, gt=0, le=60, validation_alias=AliasChoices("LLM_TIMEOUT", "KHAMLINK_PROVIDER_TIMEOUT")
    )
    embedding: Literal["qwen", "lsa", "sentence-transformers"] = Field(
        "qwen", validation_alias=AliasChoices("EMBEDDING_PROVIDER", "KHAMLINK_EMBEDDING")
    )
    embedding_model: str = Field(
        "Qwen/Qwen3-Embedding-4B",
        validation_alias=AliasChoices("EMBEDDING_MODEL", "KHAMLINK_EMBEDDING_MODEL"),
    )
    embedding_revision: str = Field(
        "5cf2132abc99cad020ac570b19d031efec650f2b",
        validation_alias=AliasChoices("EMBEDDING_REVISION", "KHAMLINK_EMBEDDING_REVISION"),
    )
    embedding_url: str = Field("", validation_alias="EMBEDDING_BASE_URL")
    embedding_key: str = Field("", repr=False, validation_alias="EMBEDDING_API_KEY")
    embedding_api_model: str = Field("qwen/qwen3-embedding-4b", validation_alias="EMBEDDING_API_MODEL")
    embedding_route: str = Field("DeepInfra", validation_alias="EMBEDDING_ROUTE")
    embedding_timeout: float = Field(10.0, gt=0, le=60, validation_alias="EMBEDDING_TIMEOUT")
    embedding_batch_size: int = Field(64, ge=1, le=128, validation_alias="EMBEDDING_BATCH_SIZE")
    embedding_workers: int = Field(4, ge=1, le=8, validation_alias="EMBEDDING_WORKERS")
    embedding_dimensions: int = Field(1024, ge=32, le=2560, validation_alias="EMBEDDING_DIMENSIONS")
    semantic_enabled: bool = True
    dense_dimensions: int = Field(128, ge=8, le=1024)
    lexical_weight: float = Field(0.35, ge=0, le=1)
    dense_weight: float = Field(0.30, ge=0, le=1)
    graph_weight: float = Field(0.20, ge=0, le=1)
    metadata_weight: float = Field(0.05, ge=0, le=1)
    context_weight: float = Field(0.10, ge=0, le=1)
    semantic_threshold: float = Field(0.18, ge=0, le=1)
    recognition_threshold: float = Field(0.26, ge=0, le=1)
    synonym_threshold: float = Field(0.92, ge=0, le=1)
    synonym_enabled: bool = False
    ppr_damping: float = Field(0.5, gt=0, lt=1)
    passage_seed_weight: float = Field(0.05, gt=0, le=1)
    sense_margin: float = Field(0.12, ge=0, le=1)
    production_policy_ack: bool = False

    @model_validator(mode="after")
    def production_boundaries(self):
        if self.embedding == "qwen" and self.embedding_model.lower() != self.embedding_api_model.lower():
            raise ValueError("Embedding canonical model and endpoint model must identify the same model")
        if self.provider == "glm" and not self.provider_model:
            raise ValueError("GLM requires an explicit model identity")
        if self.environment == "production":
            for endpoint in [self.embedding_url, self.provider_url]:
                if endpoint and not endpoint.startswith("https://"):
                    raise ValueError("Production model traffic requires HTTPS")
        if self.provider == "compatible":
            if not self.provider_url or not self.provider_model:
                raise ValueError("Compatible provider needs an explicit endpoint and model identity")
            if self.environment == "production" and not self.provider_url.startswith("https://"):
                raise ValueError("Production model traffic requires HTTPS")
        if self.environment == "production":
            if not self.production_policy_ack:
                raise ValueError("Ratify Q-009/Q-012 deployment policies before production activation")
            try:
                database = make_url(self.database_url)
            except (ArgumentError, ValueError):
                raise ValueError("Production database URL is invalid") from None
            if database.drivername != "postgresql+psycopg":
                raise ValueError("Production requires PostgreSQL with TLS")
            # Inspect the actual option, not text inside a password or another
            # parameter. Repeated sslmode options are ambiguous and rejected.
            if database.query.get("sslmode") != "verify-full":
                raise ValueError("Production database must verify TLS hostname and certificate")
            if self.identities_json == "{}":
                raise ValueError("Production requires configured privileged identities")
        return self
