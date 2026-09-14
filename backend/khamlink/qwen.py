"""Qwen embedding service adapter. Never substitutes another model or lexical vectors."""

import hashlib
import json
import logging
import os
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import httpx
import numpy as np

from .domain import DomainError

QUERY_INSTRUCTION = "Given a Thai word, meaning, question, sentence or scenario, retrieve dictionary senses that match the intended meaning."


class QwenEmbedding:
    def __init__(self, settings):
        self.settings = settings
        self.metadata = {
            "provider": "qwen",
            "model": settings.embedding_model,
            "api_model": settings.embedding_api_model,
            "upstream_reference_revision": settings.embedding_revision,
            "revision_enforcement": "hosted_model_slug_not_immutable_weight_revision",
            "route": settings.embedding_route,
            "endpoint_sha256": hashlib.sha256(settings.embedding_url.encode()).hexdigest(),
            "dimensions": settings.embedding_dimensions,
            "query_instruction": QUERY_INSTRUCTION,
            "normalization": "l2-after-mrl-truncation-v1",
        }
        digest = hashlib.sha256(json.dumps(self.metadata, sort_keys=True).encode()).hexdigest()
        self.identity = f"qwen:{settings.embedding_model}@{settings.embedding_revision}:d{settings.embedding_dimensions}:{digest[:16]}"
        self.client = httpx.Client(timeout=settings.embedding_timeout, follow_redirects=False)

    def _batch(self, texts):
        if not self.settings.embedding_url:
            raise DomainError("EMBEDDING_NOT_CONFIGURED", "ยังไม่ได้ตั้งค่าบริการค้นหาความหมาย", 503)
        if any(not isinstance(t, str) or not t.strip() or len(t) > 20000 for t in texts):
            raise DomainError("EMBEDDING_INPUT_INVALID", "ข้อความสำหรับค้นหาความหมายไม่ถูกต้อง", 400)
        payload = {
            "model": self.settings.embedding_api_model,
            "input": texts,
            "encoding_format": "float",
            "dimensions": self.settings.embedding_dimensions,
        }
        if "openrouter.ai" == httpx.URL(self.settings.embedding_url).host:
            payload["provider"] = {"only": [self.settings.embedding_route], "allow_fallbacks": False}
        headers = {"Accept-Encoding": "identity"}
        if self.settings.embedding_key:
            headers["Authorization"] = "Bearer " + self.settings.embedding_key
        try:
            with self.client.stream(
                "POST", self.settings.embedding_url.rstrip("/") + "/embeddings", json=payload, headers=headers
            ) as response:
                response.raise_for_status()
                if response.headers.get("content-encoding", "identity") != "identity":
                    raise ValueError("unexpected_encoding")
                body = bytearray()
                cap = len(texts) * 2560 * 32 + 65536
                for chunk in response.iter_raw(chunk_size=8192):
                    if len(body) + len(chunk) > cap:
                        raise ValueError("oversized_embedding_response")
                    body.extend(chunk)
                result = json.loads(body)
            if result.get("model", "").lower() != self.settings.embedding_api_model.lower():
                raise ValueError("embedding_model_mismatch")
            rows = result["data"]
            if len(rows) != len(texts) or sorted(r["index"] for r in rows) != list(range(len(texts))):
                raise ValueError("embedding_row_mismatch")
            vectors = np.asarray(
                [r["embedding"] for r in sorted(rows, key=lambda r: r["index"])], dtype=np.float32
            )
            if vectors.ndim != 2 or vectors.shape[1] not in {self.settings.embedding_dimensions, 2560}:
                raise ValueError("embedding_dimension_mismatch")
            vectors = vectors[:, : self.settings.embedding_dimensions]
            norms = np.linalg.norm(vectors, axis=1, keepdims=True)
            if not np.isfinite(vectors).all() or not np.isfinite(norms).all() or np.any(norms <= 0):
                raise ValueError("embedding_nonfinite_or_zero")
            return vectors / norms
        except httpx.TimeoutException:
            raise DomainError(
                "EMBEDDING_TIMEOUT", "บริการค้นหาความหมายใช้เวลานานเกินไป ยังค้นหาคำตรงตัวได้", 503
            ) from None
        except httpx.HTTPStatusError as error:
            code = {400: "EMBEDDING_REQUEST_REJECTED", 401: "EMBEDDING_AUTH_FAILED", 402: "EMBEDDING_CREDIT_REQUIRED", 403: "EMBEDDING_AUTH_FAILED", 422: "EMBEDDING_REQUEST_REJECTED", 429: "EMBEDDING_RATE_LIMITED"}.get(error.response.status_code, "EMBEDDING_UNAVAILABLE")
            raise DomainError(code, "บริการค้นหาความหมายปฏิเสธคำขอ ยังค้นหาคำตรงตัวได้", 503) from None
        except (ValueError, KeyError, TypeError):
            raise DomainError("EMBEDDING_INVALID_RESPONSE", "ผลจากบริการค้นหาความหมายไม่ตรงกับดัชนี", 503) from None
        except DomainError:
            raise
        except Exception:
            raise DomainError(
                "EMBEDDING_UNAVAILABLE", "บริการค้นหาความหมายไม่พร้อม ยังค้นหาคำตรงตัวได้", 503
            ) from None

    def _encode_all(self, texts, cache=False):
        size = self.settings.embedding_batch_size
        batches = [texts[i : i + size] for i in range(0, len(texts), size)]
        cache_dir = self.settings.data_dir / "cache" / "qwen" / hashlib.sha256(self.identity.encode()).hexdigest()
        if cache:
            cache_dir.mkdir(parents=True, exist_ok=True)

        def retry_batch(batch):
            digest = hashlib.sha256(json.dumps(batch, ensure_ascii=False).encode()).hexdigest()
            path = cache_dir / (digest + ".npy")
            if cache and path.exists():
                try:
                    vectors = np.load(path, allow_pickle=False)
                    if vectors.shape == (len(batch), self.settings.embedding_dimensions) and np.isfinite(vectors).all() and np.allclose(np.linalg.norm(vectors, axis=1), 1, atol=1e-4):
                        return vectors
                except (ValueError, OSError):
                    pass
            for attempt in range(3):
                try:
                    vectors = self._batch(batch)
                    if cache:
                        temporary = cache_dir / (uuid.uuid4().hex + ".npy")
                        np.save(temporary, vectors, allow_pickle=False)
                        os.replace(temporary, path)
                    return vectors
                except DomainError as error:
                    if attempt == 2 or error.code not in {"EMBEDDING_TIMEOUT", "EMBEDDING_UNAVAILABLE", "EMBEDDING_RATE_LIMITED"}:
                        raise
                    time.sleep(min(4, 0.5 * 2 ** attempt))

        results = []
        with ThreadPoolExecutor(max_workers=self.settings.embedding_workers) as pool:
            # Bounded scheduling: a permanent error does not send the remaining corpus.
            for start in range(0, len(batches), self.settings.embedding_workers):
                results.extend(pool.map(retry_batch, batches[start:start + self.settings.embedding_workers]))
                if cache and (len(results) % 32 == 0 or len(results) == len(batches)):
                    logging.getLogger("khamlink").info(json.dumps({"event": "embedding_build_progress", "batches_completed": len(results), "batches_total": len(batches)}))
        return np.vstack(results)

    def fit(self, texts):
        # Only public, approved dictionary passages use the persisted build cache.
        return self._encode_all(texts, cache=True)

    def encode(self, texts):
        return self._encode_all(texts, cache=False)

    def encode_query(self, text):
        return self._batch([f"Instruct: {QUERY_INSTRUCTION}\nQuery: {text}"])[0]

    def save(self, folder):
        (folder / "embedding.json").write_text(
            json.dumps({"identity": self.identity, **self.metadata}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def close(self):
        self.client.close()
