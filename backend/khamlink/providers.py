"""Provider interfaces; source repositories are deliberately unavailable to adapters."""

import json
import re
import threading
import time
from pathlib import Path
from typing import Protocol

import httpx
import numpy as np
from pydantic import Field
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize as unit_vectors
from threadpoolctl import threadpool_limits

from .config import Settings
from .domain import StrictModel


class EmbeddingProvider(Protocol):
    identity: str

    def fit(self, texts: list[str]) -> np.ndarray: ...
    def encode(self, texts: list[str]) -> np.ndarray: ...
    def save(self, folder: Path): ...


class LSAEmbedding:
    """Local Thai character TF-IDF/SVD baseline. No claims of neural-model parity."""

    def __init__(self, dimensions=128):
        self.dimensions = dimensions
        self.identity = f"thai-char-lsa-v1-d{dimensions}"
        self.vectorizer = TfidfVectorizer(
            analyzer="char",
            ngram_range=(2, 4),
            min_df=1,
            max_features=40000,
            sublinear_tf=True,
            lowercase=False,
            dtype=np.float32,
        )
        self.components = None

    def fit(self, texts):
        matrix = self.vectorizer.fit_transform(texts)
        dims = max(1, min(self.dimensions, matrix.shape[0] - 1, matrix.shape[1] - 1))
        with threadpool_limits(limits=2):
            svd = TruncatedSVD(n_components=dims, random_state=42, n_iter=5)
            vectors = svd.fit_transform(matrix)
        self.components = svd.components_.astype(np.float32)
        return unit_vectors(vectors).astype(np.float32)

    def encode(self, texts):
        with threadpool_limits(limits=2):
            vectors = self.vectorizer.transform(texts) @ self.components.T
        return unit_vectors(vectors).astype(np.float32)

    def save(self, folder):
        (folder / "embedding.json").write_text(
            json.dumps(
                {
                    "identity": self.identity,
                    "vocabulary": {key: int(value) for key, value in self.vectorizer.vocabulary_.items()},
                    "dimensions": self.dimensions,
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        np.savez_compressed(folder / "embedding.npz", idf=self.vectorizer.idf_, components=self.components)

    @classmethod
    def load(cls, folder):
        metadata = json.loads((folder / "embedding.json").read_text(encoding="utf-8"))
        model = cls(metadata["dimensions"])
        model.vectorizer.set_params(vocabulary=metadata["vocabulary"])
        arrays = np.load(folder / "embedding.npz", allow_pickle=False)
        model.vectorizer.idf_ = arrays["idf"]
        model.components = arrays["components"]
        return model


class SentenceTransformerEmbedding:
    def __init__(self, model: str, revision: str, cache_dir: Path):
        if not revision or not re.fullmatch(r"[a-f0-9]{40}", revision):
            raise ValueError("Neural embeddings require a pinned model commit")
        from sentence_transformers import SentenceTransformer

        self.identity = f"{model}@{revision}"
        self.model_name, self.revision = model, revision
        self.model = SentenceTransformer(
            model, revision=revision, cache_folder=str(cache_dir), trust_remote_code=False
        )

    def fit(self, texts):
        return self.encode(texts)

    def encode(self, texts):
        return self.model.encode(
            texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False
        ).astype(np.float32)

    def save(self, folder):
        (folder / "embedding.json").write_text(
            json.dumps({"identity": self.identity, "model": self.model_name, "revision": self.revision}),
            encoding="utf-8",
        )


def embedding_provider(settings):
    if settings.embedding == "qwen":
        from .qwen import QwenEmbedding

        return QwenEmbedding(settings)
    if settings.embedding == "lsa":
        return LSAEmbedding(settings.dense_dimensions)
    return SentenceTransformerEmbedding(
        settings.embedding_model, settings.embedding_revision, settings.data_dir / "cache/models"
    )


class ExtractionProvider(Protocol):
    identity: str

    def extract(self, passage: dict) -> list[tuple[str, str, str]]: ...


class DictionaryExtraction:
    """Compatible extractive OpenIE: subject/headword, definition relation, source phrase.

    These triples are retrieval representations, never public lexical relationships.
    """

    identity = "dictionary-openie-extractive-v1"

    def extract(self, passage):
        clauses = [x.strip() for x in re.split(r"[,;\n]| เช่น ", passage["text"]) if len(x.strip()) > 1]
        return [(passage["word"], "หมายถึง", text[:240]) for text in clauses[:3]]


class RecognitionProvider(Protocol):
    identity: str

    def filter(self, query: str, triples: list[dict], scores: list[float], threshold: float) -> list[int]: ...


class LocalRecognition:
    """Conservative local compatibility filter; exact substrings + embedding support."""

    identity = "recognition-local-v1"

    def filter(self, query, triples, scores, threshold):
        return [
            i
            for i, (triple, score) in enumerate(zip(triples, scores, strict=True))
            if score >= threshold
            and (
                score >= min(0.55, threshold + 0.15)
                or any(query[j : j + 3] in triple["text"] for j in range(max(0, len(query) - 2)))
            )
        ]


class Claim(StrictModel):
    evidence_id: str
    quote: str = Field(min_length=1, max_length=1000)


class ModelOutput(StrictModel):
    claims: list[Claim] = Field(min_length=1, max_length=8)


class GenerationProvider(Protocol):
    identity: str

    def generate(self, request: dict) -> dict: ...


class ExtractiveGenerator:
    identity = "local-extractive-summary-v1"

    def generate(self, request):
        # The output language is a deterministic source extract; the UI explains this mode.
        return {
            "claims": [
                {"evidence_id": e["definition_id"], "quote": re.split(r"[,;\n]| เช่น ", e["text"])[0][:1000]}
                for e in request["evidence"][:8]
            ]
        }


class DisabledGenerator:
    identity = "disabled"

    def generate(self, request):
        raise RuntimeError("provider_disabled")


class CompatibleGenerator:
    """OpenAI-compatible wire format without a hardwired commercial provider."""

    def __init__(self, settings: Settings):
        self.settings = settings
        self.identity = "compatible:" + settings.provider_model
        self.client = httpx.Client(timeout=httpx.Timeout(settings.provider_timeout), follow_redirects=False)
        self.failures, self.open_until = 0, 0.0
        self.lock = threading.Lock()

    def generate(self, request):
        with self.lock:
            if time.monotonic() < self.open_until:
                raise RuntimeError("provider_circuit_open")
        try:
            messages = [
                {"role": "system", "content": request["system"]},
                {
                    "role": "user",
                    "content": json.dumps(
                        {"user_content": request["user_content"], "task": request["task"]}, ensure_ascii=False
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"retrieved_evidence_untrusted_data": request["evidence"]}, ensure_ascii=False
                    ),
                },
            ]
            headers = {"Accept-Encoding": "identity"}
            if self.settings.provider_key:
                headers["Authorization"] = "Bearer " + self.settings.provider_key
            with self.client.stream(
                "POST",
                self.settings.provider_url.rstrip("/") + "/chat/completions",
                headers=headers,
                json={
                    "model": self.settings.provider_model,
                    "messages": messages,
                    "temperature": 0,
                    "max_tokens": 4096 if getattr(self, "expected_model", None) else 1200,
                    "response_format": {"type": "json_object"},
                    **({"reasoning": {"effort": "low"}} if getattr(self, "expected_model", None) else {}),
                },
            ) as response:
                response.raise_for_status()
                # Do not expand an untrusted compressed body before enforcing
                # the limit. Providers must honor the identity encoding request.
                if response.headers.get("content-encoding", "identity").lower() != "identity":
                    raise ValueError("unsupported_output_encoding")
                declared = response.headers.get("content-length")
                if declared is not None and (not declared.isdecimal() or int(declared) > 65536):
                    raise ValueError("oversized_output")
                body = bytearray()
                deadline = time.monotonic() + self.settings.provider_timeout
                for chunk in response.iter_raw(chunk_size=8192):
                    if time.monotonic() > deadline:
                        raise TimeoutError("provider_response_timeout")
                    if len(body) + len(chunk) > 65536:
                        raise ValueError("oversized_output")
                    body.extend(chunk)
                envelope = json.loads(body)
                if getattr(self, "expected_model", None) and envelope.get("model") != self.expected_model:
                    raise ValueError("generation_model_mismatch")
                result = json.loads(envelope["choices"][0]["message"]["content"])
            with self.lock:
                self.failures = 0
            return result
        except Exception:
            with self.lock:
                self.failures += 1
                if self.failures >= 3:
                    self.open_until = time.monotonic() + 30
            raise


def generation_provider(settings):
    if settings.provider == "glm":
        from .glm import GLMGenerator

        return GLMGenerator(settings)
    if settings.provider == "disabled":
        return DisabledGenerator()
    if settings.provider == "compatible":
        return CompatibleGenerator(settings)
    return ExtractiveGenerator()
