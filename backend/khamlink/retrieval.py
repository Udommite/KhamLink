"""Replaceable HippoRAG 2 method adapter: passage/phrase graph, filtering, PPR.

Reference: OSU-NLP-Group/HippoRAG 1438aba3fc44ff10573e5a5e1e7cc3c7f9794aff,
2.0.0a5 (MIT). See THIRD_PARTY_NOTICES.md and docs/architecture.md for deviations.
"""

import copy
import hashlib
import importlib.metadata
import json
import math
import os
import threading
import time
import uuid
from collections import OrderedDict, defaultdict
from pathlib import Path
from typing import Protocol

import numpy as np
from scipy import sparse
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors
from threadpoolctl import threadpool_limits

from .bge import frequency_bonus
from .db import Dataset, IndexBuild, now
from .domain import NORMALIZATION_VERSION, DomainError, stable_id
from .ingestion import sha256_file
from .providers import DictionaryExtraction, LocalRecognition, LSAEmbedding, embedding_provider

METHOD_VERSION = "khamlink-hipporag2-method-v2"
# Rerank logits are unbounded, so lexical tiers need sentinels above their range.
EXACT_MATCH_SCORE = 1_000_000.0
PARTIAL_MATCH_SCORE = 1_000.0
UPSTREAM_COMMIT = "1438aba3fc44ff10573e5a5e1e7cc3c7f9794aff"


def index_identity(settings):
    if settings.embedding == "bge-m3":
        from .bge import FREQUENCY_SOURCE

        config = {
            "method": "khamlink-bge-m3-rerank-frequency-v1",
            "normalization": NORMALIZATION_VERSION,
            "frequency_source": FREQUENCY_SOURCE,
            # rerank_floor and semantic_threshold are query-time knobs: they change no
            # stored vector, so binding them into the index identity only forced a
            # 268 MB rebuild to retune a number.
            **{
                name: getattr(settings, name)
                for name in [
                    "embedding",
                    "bge_model",
                    "rerank_model",
                    "rerank_enabled",
                    "rerank_candidates",
                    "frequency_weight",
                ]
            },
        }
        return config, hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    if settings.embedding == "qwen":
        config = {
            "method": "qwen-semantic-v1",
            "normalization": NORMALIZATION_VERSION,
            **{
                name: getattr(settings, name)
                for name in [
                    "embedding",
                    "embedding_model",
                    "embedding_api_model",
                    "embedding_revision",
                    "embedding_route",
                    "embedding_dimensions",
                    "lexical_weight",
                    "dense_weight",
                    "metadata_weight",
                    "context_weight",
                    "semantic_threshold",
                ]
            },
            "endpoint_sha256": hashlib.sha256(settings.embedding_url.encode()).hexdigest(),
        }
        return config, hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()
    names = [
        "embedding",
        "embedding_model",
        "embedding_revision",
        "dense_dimensions",
        "lexical_weight",
        "dense_weight",
        "graph_weight",
        "metadata_weight",
        "context_weight",
        "semantic_threshold",
        "recognition_threshold",
        "synonym_enabled",
        "synonym_threshold",
        "ppr_damping",
        "passage_seed_weight",
    ]
    config = {k: getattr(settings, k) for k in names}
    config.update(
        {
            "method": METHOD_VERSION,
            "normalization": NORMALIZATION_VERSION,
            "extraction": DictionaryExtraction.identity,
            "recognition": LocalRecognition.identity,
            "numpy": importlib.metadata.version("numpy"),
            "sklearn": importlib.metadata.version("scikit-learn"),
        }
    )
    return config, hashlib.sha256(json.dumps(config, sort_keys=True).encode()).hexdigest()


class RetrievalAdapter(Protocol):
    def retrieve(self, query: str, limit: int) -> dict: ...


class IndexBuilder:
    def __init__(self, settings, repository, sessions, security):
        self.settings, self.repository, self.sessions, self.security = (
            settings,
            repository,
            sessions,
            security,
        )

    def build(self, dataset_id, principal, correlation_id):
        if self.settings.embedding == "bge-m3":
            from .bge import build_bge_index

            return build_bge_index(
                self.settings,
                self.repository,
                self.sessions,
                self.security,
                dataset_id,
                principal,
                correlation_id,
            )
        if self.settings.embedding == "qwen":
            from .semantic import build_semantic_index

            return build_semantic_index(
                self.settings,
                self.repository,
                self.sessions,
                self.security,
                dataset_id,
                principal,
                correlation_id,
            )
        self.security.authorize(principal, "import", correlation_id, dataset_id)
        passages = self.repository.passages(dataset_id)
        if len(passages) < 2:
            raise DomainError("INDEX_TOO_SMALL", "ต้องมีอย่างน้อยสองความหมายเพื่อสร้างดัชนี", 409)
        config, config_hash = index_identity(self.settings)
        index_id = "idx_" + uuid.uuid4().hex
        root = self.settings.data_dir / "indexes"
        root.mkdir(parents=True, exist_ok=True)
        # Inherit the operator-controlled data-directory ACL on Windows. Python's
        # mkdtemp(mode=0700) creates an owner-only DACL, which can make an index
        # built by an isolated ingestion identity unreadable to the serving identity.
        folder = root / ("staging-" + uuid.uuid4().hex)
        folder.mkdir(mode=0o750)
        embedding, extraction = embedding_provider(self.settings), DictionaryExtraction()
        passage_vectors = embedding.fit([p["word"] + " " + p["text"] for p in passages])
        term_encoder = TfidfVectorizer(
            analyzer="char",
            ngram_range=(2, 4),
            max_features=40000,
            lowercase=False,
            sublinear_tf=True,
            dtype=np.float32,
        )
        passage_terms = term_encoder.fit_transform([p["word"] + " " + p["text"] for p in passages])
        sparse.save_npz(folder / "passage_terms.npz", passage_terms)
        (folder / "terms.json").write_text(
            json.dumps(
                {
                    "vocabulary": {k: int(v) for k, v in term_encoder.vocabulary_.items()},
                    "idf": term_encoder.idf_.tolist(),
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        phrases, phrase_ids, triples, links = [], {}, [], []
        passage_count = len(passages)

        def phrase_node(text):
            if text not in phrase_ids:
                phrase_ids[text] = passage_count + len(phrases)
                phrases.append(text)
            return phrase_ids[text]

        for passage_index, passage in enumerate(passages):
            for subject, predicate, obj in extraction.extract(passage):
                subject_node, object_node = phrase_node(subject), phrase_node(obj)
                triples.append(
                    {
                        "id": stable_id("tr", passage["passage_id"], subject, predicate, obj),
                        "text": f"{subject} {predicate} {obj}",
                        "nodes": [subject_node, object_node],
                        "passage_index": passage_index,
                        "provenance": "AI_GENERATED_METADATA",
                    }
                )
                links.extend(
                    [
                        (passage_index, subject_node, 1.0),
                        (passage_index, object_node, 1.0),
                        (subject_node, object_node, 1.0),
                    ]
                )
        triple_vectors = (
            embedding.encode([t["text"] for t in triples])
            if triples
            else np.zeros((0, passage_vectors.shape[1]), dtype=np.float32)
        )
        synonym_count = 0
        if self.settings.synonym_enabled and len(phrases) > 1:
            vectors = embedding.encode(phrases)
            neighbors = NearestNeighbors(
                n_neighbors=min(4, len(phrases)), metric="cosine", algorithm="brute", n_jobs=2
            ).fit(vectors)
            # Bounded batches avoid a full NxN similarity matrix.
            for offset in range(0, len(phrases), 256):
                with threadpool_limits(limits=2):
                    distances, indices = neighbors.kneighbors(vectors[offset : offset + 256])
                for local_i, (ds, ids) in enumerate(zip(distances, indices, strict=True)):
                    i = offset + local_i
                    for distance, j in zip(ds, ids, strict=True):
                        if j > i and 1 - distance >= self.settings.synonym_threshold:
                            links.append((passage_count + i, passage_count + int(j), float(1 - distance)))
                            synonym_count += 1
        size = passage_count + len(phrases)
        rows, cols, weights = [], [], []
        for left, right, weight in links:
            rows.extend((left, right))
            cols.extend((right, left))
            weights.extend((weight, weight))
        graph = sparse.csr_matrix((np.asarray(weights, dtype=np.float32), (rows, cols)), shape=(size, size))
        graph.sum_duplicates()
        degree = np.asarray(graph.sum(axis=1)).ravel()
        transition = sparse.diags(np.divide(1.0, degree, out=np.zeros_like(degree), where=degree > 0)) @ graph
        embedding.save(folder)
        np.savez_compressed(folder / "vectors.npz", passages=passage_vectors, triples=triple_vectors)
        sparse.save_npz(folder / "transition.npz", transition.tocsr())
        (folder / "graph.json").write_text(
            json.dumps({"passages": passages, "phrases": phrases, "triples": triples}, ensure_ascii=False),
            encoding="utf-8",
        )
        with self.sessions() as session:
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
                "extraction_model_identity": extraction.identity,
                "recognition_identity": LocalRecognition.identity,
                "config": config,
                "configuration_hash": config_hash,
                "built_at": now(),
                "method": METHOD_VERSION,
                "hipporag_reference_commit": UPSTREAM_COMMIT,
                "provenance": "AI_GENERATED_METADATA",
                "passages": passage_count,
                "phrases": len(phrases),
                "triples": len(triples),
                "synonym_edges": synonym_count,
                "files": {p.name: sha256_file(p) for p in folder.iterdir()},
            }
        if not np.isfinite(passage_vectors).all() or not np.isfinite(triple_vectors).all() or graph.nnz == 0:
            raise DomainError("INVALID_INDEX", "ดัชนีไม่ผ่านการตรวจสอบ", 409)
        (folder / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        os.replace(folder, root / index_id)
        # Only fully persisted, validated builds enter the catalog. Publication is a separate transaction.
        with self.sessions.begin() as session:
            session.add(
                IndexBuild(index_id=index_id, dataset_id=dataset_id, manifest=manifest, validated=True)
            )
        return manifest


def verify_index_files(settings, folder: Path, expected_manifest: dict):
    """Shared publication/load gate. Catalog flags alone cannot validate mutable files."""
    _, expected_hash = index_identity(settings)
    on_disk = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
    if (
        expected_manifest != on_disk
        or on_disk["configuration_hash"] != expected_hash
        or on_disk["provenance"] != "AI_GENERATED_METADATA"
        or on_disk["normalization_version"] != NORMALIZATION_VERSION
    ):
        raise ValueError("incompatible_index_identity")
    required = {
        "embedding.json",
        "graph.json",
        "vectors.npz",
        "transition.npz",
        "terms.json",
        "passage_terms.npz",
    }
    if settings.embedding == "lsa":
        required.add("embedding.npz")
    if settings.embedding == "qwen":
        required = {"embedding.json", "passages.json", "vectors.npy"}
    if settings.embedding == "bge-m3":
        required = {"embedding.json", "rows.json", "vectors.npy"}
    if set(on_disk["files"]) != required:
        raise ValueError("index_file_set_mismatch")
    for name, checksum in on_disk["files"].items():
        if Path(name).name != name or (folder / name).is_symlink() or sha256_file(folder / name) != checksum:
            raise ValueError("index_checksum_mismatch")
    return on_disk


class HippoRAG2Adapter:
    def __init__(self, settings, folder: Path, expected_manifest: dict, recognition=None):
        self.settings, self.manifest = settings, expected_manifest
        on_disk = verify_index_files(settings, folder, expected_manifest)
        data = json.loads((folder / "graph.json").read_text(encoding="utf-8"))
        self.passages, self.phrases, self.triples = data["passages"], data["phrases"], data["triples"]
        vectors = np.load(folder / "vectors.npz", allow_pickle=False)
        self.passage_vectors, self.triple_vectors = vectors["passages"], vectors["triples"]
        terms = json.loads((folder / "terms.json").read_text(encoding="utf-8"))
        self.term_encoder = TfidfVectorizer(
            analyzer="char",
            ngram_range=(2, 4),
            vocabulary=terms["vocabulary"],
            lowercase=False,
            sublinear_tf=True,
            dtype=np.float32,
        )
        self.term_encoder.idf_ = np.asarray(terms["idf"], dtype=np.float32)
        self.passage_terms = sparse.load_npz(folder / "passage_terms.npz")
        self.transition = sparse.load_npz(folder / "transition.npz").T.tocsr()
        self.dangling = np.asarray(self.transition.sum(axis=0)).ravel() == 0
        self.embedding = (
            LSAEmbedding.load(folder) if settings.embedding == "lsa" else embedding_provider(settings)
        )
        if self.embedding.identity != on_disk["embedding_identity"]:
            raise ValueError("embedding_identity_mismatch")
        self.recognition = recognition or LocalRecognition()

    def retrieve(self, query, limit):
        vector = self.embedding.encode([query])[0]
        term_scores = (self.passage_terms @ self.term_encoder.transform([query]).T).toarray().ravel()
        with threadpool_limits(limits=2):
            dense = np.clip(self.passage_vectors @ vector, 0, 1)
            triple_scores = np.clip(self.triple_vectors @ vector, 0, 1)
        if not np.isfinite(dense).all() or not np.isfinite(triple_scores).all():
            raise ValueError("nonfinite_embedding")
        order = np.argsort(-triple_scores, kind="stable")[:40]
        candidate_triples = [self.triples[i] for i in order]
        selected = self.recognition.filter(
            query, candidate_triples, triple_scores[order].tolist(), self.settings.recognition_threshold
        )
        if any(not isinstance(i, int) or i < 0 or i >= len(order) for i in selected):
            raise ValueError("invalid_recognition_output")
        graph_scores = np.zeros(len(self.passages), dtype=np.float32)
        mode = "dense_fallback"
        if selected:
            phrase_scores = defaultdict(list)
            for local_i in selected:
                for node in candidate_triples[local_i]["nodes"]:
                    phrase_scores[node].append(float(triple_scores[order[local_i]]))
            phrase_seeds = sorted(
                ((node, sum(scores) / len(scores)) for node, scores in phrase_scores.items()),
                key=lambda x: (-x[1], x[0]),
            )[:5]
            personalization = np.zeros(self.transition.shape[0], dtype=np.float64)
            personalization[: len(dense)] = dense * self.settings.passage_seed_weight
            for node, score in phrase_seeds:
                personalization[node] = score
            if personalization.sum() > 0:
                personalization /= personalization.sum()
                rank = personalization.copy()
                damping = self.settings.ppr_damping
                for _ in range(60):
                    next_rank = (
                        damping * (self.transition @ rank + rank[self.dangling].sum() * personalization)
                        + (1 - damping) * personalization
                    )
                    if np.abs(next_rank - rank).sum() < 1e-8:
                        rank = next_rank
                        break
                    rank = next_rank
                graph_scores = rank[: len(dense)]
                if graph_scores.max() > 0:
                    graph_scores = graph_scores / graph_scores.max()
                mode = "hipporag2_ppr"
        combined = (
            self.settings.lexical_weight * term_scores
            + self.settings.dense_weight * dense
            + self.settings.graph_weight * graph_scores
        )
        ranked = np.argsort(-combined, kind="stable")
        results = []
        for i in ranked:
            if max(dense[i], term_scores[i]) < self.settings.semantic_threshold:
                continue
            passage = self.passages[i]
            results.append(
                {
                    "word_id": passage["word_id"],
                    "definition_id": passage["definition_id"],
                    "dense": float(dense[i]),
                    "text_lexical": float(term_scores[i]),
                    "retrieval_score": float(combined[i]),
                    "graph": float(graph_scores[i]),
                    "evidence_id": passage["definition_id"],
                }
            )
            if len(results) >= limit:
                break
        return {"candidates": results, "mode": mode, "recognized_triples": len(selected)}


class SafeCache:
    def __init__(self, size, ttl):
        self.entries, self.size, self.ttl = OrderedDict(), size, ttl
        self.lock = threading.Lock()

    def get(self, key):
        with self.lock:
            item = self.entries.get(key)
            if item and item[0] > time.monotonic():
                self.entries.move_to_end(key)
                return copy.deepcopy(item[1])
            self.entries.pop(key, None)

    def put(self, key, value):
        with self.lock:
            self.entries[key] = (time.monotonic() + self.ttl, copy.deepcopy(value))
            while len(self.entries) > self.size:
                self.entries.popitem(last=False)


class SearchService:
    def __init__(self, settings, repository, sessions, telemetry):
        self.settings, self.repository, self.sessions, self.telemetry = (
            settings,
            repository,
            sessions,
            telemetry,
        )
        self.cache = SafeCache(settings.cache_size, settings.cache_ttl)
        self.adapter = None
        self.loaded_index = None
        self.index_lock = threading.Lock()
        from .expansion import QueryExpander

        self.expander = QueryExpander(settings)

    def load_adapter(self, release):
        if not self.settings.semantic_enabled or not release["index_id"]:
            raise ValueError("semantic_disabled_or_unbuilt")
        with self.index_lock:
            if self.loaded_index != release["index_id"]:
                with self.sessions() as session:
                    index = session.get(IndexBuild, release["index_id"])
                    if not index or not index.validated or index.dataset_id != release["dataset_id"]:
                        raise ValueError("incompatible_index")
                    if self.settings.embedding == "bge-m3":
                        from .bge import BgeIndex as adapter_type
                    elif self.settings.embedding == "qwen":
                        from .semantic import SemanticAdapter as adapter_type
                    else:
                        adapter_type = HippoRAG2Adapter
                    adapter = adapter_type(
                        self.settings, self.settings.data_dir / "indexes" / index.index_id, index.manifest
                    )
                self.adapter, self.loaded_index = adapter, release["index_id"]
            return self.adapter

    def search(self, query, limit, offset, correlation_id):
        release = self.repository.release()
        lexical = self.repository.lexical(query, release["dataset_id"], limit + offset + 1)
        # Cache only exact dictionary queries; natural language never enters cache keys/values.
        # The query itself, not just the matched entry: several written forms now exact-match
        # one entry ('อนุรักษ-' and 'อนุรักษ์'), and their prefix tails differ, so keying on
        # word_id alone served one query's results to another.
        cache_key = (
            (
                release["revision"],
                release["dataset_id"],
                release["index_id"],
                query,
                lexical[0]["word_id"],
                limit,
                offset,
                self.settings.semantic_enabled,
            )
            if lexical and lexical[0]["match_type"] == "exact"
            else None
        )
        try:
            cached = self.cache.get(cache_key) if cache_key else None
            if cached:
                cached["cache_hit"] = True
                return cached
        except Exception:
            self.telemetry.emit("cache_failure", correlation_id, {"status": "degraded"})
        candidates = {r["word_id"]: r for r in lexical}
        degraded, mode, degraded_reason = False, "lexical", None
        # Exact lookup has no embedding dependency. Optional related discovery is reached by a new query.
        if not (lexical and lexical[0]["match_type"] == "exact"):
            # A description is rewritten into definition-shaped probes before retrieval;
            # if that rewrite fails the search simply runs unexpanded, never degraded.
            extras = {}
            if self.expander.wanted(query, exact=False):
                try:
                    expansion = self.expander.expand(query)
                    extras = {
                        "probes": expansion["terms"] + expansion["words"],
                        "boost": expansion["words"],
                    }
                except Exception:
                    self.telemetry.emit(
                        "dependency", correlation_id, {"dependency": "expansion", "status": "failed"}
                    )
            try:
                semantic = self.load_adapter(release).retrieve(
                    query, min(200, (limit + offset) * 4), **extras
                )
                mode = semantic["mode"]
                for hit in semantic["candidates"]:
                    previous = candidates.get(hit["word_id"], {"match_type": "semantic", "lexical": 0.0})
                    # Compare against -inf, not 0: cross-encoder scores are unbounded logits
                    # and a correct-but-weaker answer legitimately scores below zero. A zero
                    # default silently discarded those, truncating result lists to 1-3 rows.
                    if hit.get("retrieval_score", 0) >= previous.get("retrieval_score", -math.inf):
                        candidates[hit["word_id"]] = {**previous, **hit}
            except Exception as error:
                degraded = True
                degraded_reason = (
                    error.code if isinstance(error, DomainError) else "SEMANTIC_INDEX_UNAVAILABLE"
                )
                self.telemetry.emit(
                    "dependency", correlation_id, {"dependency": "semantic", "status": "failed"}
                )
        ranked = []
        for wid, hit in candidates.items():
            try:
                word = self.repository.lookup(wid, release["dataset_id"])
            except DomainError as error:
                if error.code == "VERSION_CHANGED":
                    raise
                continue
            sense = next(
                (d for d in word["definitions"] if d["definition_id"] == hit.get("definition_id")),
                word["definitions"][0],
            )
            if hit.get("definition_id") and sense["definition_id"] != hit["definition_id"]:
                continue
            metadata = float(bool(sense["part_of_speech"] and sense["part_of_speech"] in query))
            contextual = len(
                set(query[i : i + 3] for i in range(max(0, len(query) - 2)))
                & set(sense["text"][i : i + 3] for i in range(max(0, len(sense["text"]) - 2)))
            ) / max(1, len(query) - 2)
            if self.settings.embedding == "bge-m3":
                # The adapter has already combined rerank and frequency; re-weighting that
                # against a char-overlap signal only dilutes it. Typed prefixes still win,
                # because someone who types a word wants that word, not a description of it.
                score = hit.get("retrieval_score", 0.0)
                if hit["match_type"] == "exact":
                    score = EXACT_MATCH_SCORE
                elif hit["match_type"] == "partial":
                    # Every prefix match used to land on exactly PARTIAL_MATCH_SCORE, so
                    # ordering fell through to a hash and typing 'ความรู' ranked ความรู้
                    # fifth. Order them the way a reader expects: commonest first, and
                    # the shortest completion ahead of longer compounds.
                    score = (
                        PARTIAL_MATCH_SCORE
                        + max(score, 0.0)
                        + frequency_bonus(word["word"], self.settings.frequency_weight)
                        - 0.01 * len(word["word"])
                    )
            else:
                score = (
                    self.settings.lexical_weight * max(hit.get("lexical", 0), hit.get("text_lexical", 0))
                    + self.settings.dense_weight * hit.get("dense", 0)
                    + self.settings.graph_weight * hit.get("graph", 0)
                    + self.settings.metadata_weight * metadata
                    + self.settings.context_weight * contextual
                )
                if hit["match_type"] == "exact":
                    score = 10.0
                elif hit["match_type"] == "partial":
                    score += 1.0
            ranked.append(
                {
                    "word_id": wid,
                    "word": word["word"],
                    "definition_id": sense["definition_id"],
                    "description": sense["text"][:240],
                    "match_type": hit["match_type"],
                    "score": round(score, 6),
                    "signals": {
                        "lexical": hit.get("lexical", 0),
                        "text_lexical": hit.get("text_lexical", 0),
                        "dense": hit.get("dense", 0),
                        "graph": hit.get("graph", 0),
                        "metadata": metadata,
                        "context": contextual,
                    },
                    "provenance": "SOURCE_DATA",
                    "source": word["source"],
                    "sense_count": len(word["definitions"]),
                    "evidence_ids": [sense["definition_id"]],
                }
            )
        ranked.sort(key=lambda r: (-r["score"], r["word_id"], r["definition_id"]))
        result = {
            "candidates": ranked[offset : offset + limit],
            "state": "results" if ranked else ("degraded_empty" if degraded else "no_reliable_result"),
            "degraded": degraded,
            "degraded_reason": degraded_reason,
            "embedding_model": self.settings.embedding_model if self.settings.embedding == "qwen" else None,
            "semantic_state": "not_needed_exact"
            if lexical and lexical[0]["match_type"] == "exact"
            else "failed"
            if degraded
            else "available",
            "retrieval_mode": mode,
            "limit": limit,
            "offset": offset,
            "has_more": len(ranked) > offset + limit,
            "release": release,
            "cache_hit": False,
        }
        if cache_key and not degraded:
            try:
                self.cache.put(cache_key, result)
            except Exception:
                self.telemetry.emit("cache_failure", correlation_id, {"status": "degraded"})
        self.telemetry.emit(
            "search",
            correlation_id,
            {
                "status": result["state"],
                "mode": mode,
                "degraded": degraded,
                "count": len(result["candidates"]),
            },
        )
        return result
