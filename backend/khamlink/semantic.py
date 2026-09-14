"""Versioned dictionary-sense vector index. Explicit lexical edges live only in SQL."""

import json
import os
import uuid

import numpy as np
from threadpoolctl import threadpool_limits

from .db import Dataset, IndexBuild, now
from .domain import NORMALIZATION_VERSION, DomainError
from .ingestion import sha256_file
from .providers import embedding_provider


def build_semantic_index(settings, repository, sessions, security, dataset_id, principal, correlation_id):
    from .retrieval import index_identity

    security.authorize(principal, "import", correlation_id, dataset_id)
    passages = repository.passages(dataset_id)
    if not passages:
        raise DomainError("INDEX_TOO_SMALL", "ไม่มีความหมายที่ผ่านการตรวจสอบสำหรับสร้างดัชนี", 409)
    config, digest = index_identity(settings)
    index_id = "idx_" + uuid.uuid4().hex
    root = settings.data_dir / "indexes"
    root.mkdir(parents=True, exist_ok=True)
    folder = root / ("staging-" + uuid.uuid4().hex)
    folder.mkdir(mode=0o750)
    embedding = embedding_provider(settings)
    try:
        vectors = embedding.fit(
            [
                f"คำ: {p['word']}\nความหมายที่ {p['number']}: {p['text']}\nชนิดคำ: {p['part_of_speech'] or 'ไม่ระบุ'}"
                for p in passages
            ]
        )
        if vectors.shape != (len(passages), settings.embedding_dimensions) or not np.isfinite(vectors).all():
            raise DomainError("INVALID_INDEX", "ดัชนีไม่ผ่านการตรวจสอบ", 409)
        embedding.save(folder)
        np.save(folder / "vectors.npy", vectors, allow_pickle=False)
        (folder / "passages.json").write_text(json.dumps(passages, ensure_ascii=False), encoding="utf-8")
        with sessions() as session:
            source = session.get(Dataset, dataset_id)
            manifest = {
                "index_id": index_id,
                "dataset_id": dataset_id,
                "corpus": source.manifest["corpus"],
                "corpus_version": source.version,
                "source_id": source.source_id,
                "source_version": source.version,
                "source_checksum": source.checksum,
                "normalization_version": NORMALIZATION_VERSION,
                "embedding_identity": embedding.identity,
                "embedding_metadata": embedding.metadata,
                "extraction_model_identity": "none-explicit-relationships-in-sql",
                "config": config,
                "configuration_hash": digest,
                "built_at": now(),
                "method": "qwen-semantic-v1",
                "provenance": "AI_GENERATED_METADATA",
                "passages": len(passages),
                "phrases": 0,
                "triples": 0,
                "synonym_edges": 0,
                "files": {p.name: sha256_file(p) for p in folder.iterdir()},
            }
        (folder / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(folder, root / index_id)
        with sessions.begin() as session:
            session.add(
                IndexBuild(index_id=index_id, dataset_id=dataset_id, manifest=manifest, validated=True)
            )
        return manifest
    finally:
        embedding.close()


class SemanticAdapter:
    def __init__(self, settings, folder, manifest):
        from .retrieval import verify_index_files

        verify_index_files(settings, folder, manifest)
        self.settings, self.manifest = settings, manifest
        self.embedding = embedding_provider(settings)
        if self.embedding.identity != manifest["embedding_identity"]:
            self.embedding.close()
            raise ValueError("embedding_identity_mismatch")
        self.passages = json.loads((folder / "passages.json").read_text(encoding="utf-8"))
        self.passage_vectors = np.load(folder / "vectors.npy", mmap_mode="r", allow_pickle=False)
        if self.passage_vectors.shape != (len(self.passages), settings.embedding_dimensions):
            self.embedding.close()
            raise ValueError("invalid_vector_shape")

    def retrieve(self, query, limit):
        vector = self.embedding.encode_query(query)
        with threadpool_limits(limits=2):
            scores = self.passage_vectors @ vector
        if not np.isfinite(scores).all():
            raise ValueError("invalid_similarity")
        ordered = np.argsort(-scores, kind="stable")
        return {
            "mode": "qwen_semantic",
            "recognized_triples": 0,
            "candidates": [
                {
                    "word_id": self.passages[i]["word_id"],
                    "definition_id": self.passages[i]["definition_id"],
                    "dense": float(scores[i]),
                    "graph": 0.0,
                    "retrieval_score": float(scores[i]),
                    "evidence_id": self.passages[i]["definition_id"],
                }
                for i in ordered[:limit]
                if scores[i] >= self.settings.semantic_threshold
            ],
        }
