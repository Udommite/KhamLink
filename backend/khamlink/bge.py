"""BGE-M3 retrieval: precomputed dense index, cross-encoder rerank, frequency prior.

Replaces the char-ngram LSA + PPR path for the RID corpus. Three signals, in order:

1. **Dense.** BGE-M3 vectors are computed offline by ``encode.py`` and shipped in
   ``embeddings.parquet``; the index build only gathers the rows that correspond to
   published definitions, so no model runs at build time.
2. **Rerank.** A cross-encoder reads query and entry together, which is what separates
   an agent from a patient — 'คนที่รักษาคนป่วย' is หมอ, not คนไข้ — a distinction a single
   vector per side cannot make.
3. **Frequency.** The dictionary carries no commonness signal, so embeddings rank ตะกละ,
   เติบ, กินสั่ง and จุ as near-equally good answers for "eats too much". A Thai National
   Corpus prior, ``weight * log10(1 + count)``, separates the word people actually use.

Every stage degrades rather than fails: no reranker leaves dense order, no PyThaiNLP
leaves no prior, and ``SearchService`` already treats an unavailable index as degraded.
"""

import json
import math
import threading

import numpy as np

from .domain import DomainError

FREQUENCY_SOURCE = "pythainlp-tnc-ttc"
# Large enough to lift a model-proposed word past the rerank spread, small enough that
# an entry the index never retrieved still cannot appear.
PROPOSED_WORD_BONUS = 5.0
_FREQUENCIES: dict[str, int] | None = None


def frequency_table() -> dict[str, int]:
    """Thai National Corpus + Thai Textbook Corpus unigram counts. Loaded once, optional."""
    global _FREQUENCIES
    if _FREQUENCIES is None:
        try:
            from pythainlp.corpus.tnc import word_freqs as tnc
            from pythainlp.corpus.ttc import word_freqs as ttc

            table = dict(tnc())
            for word, count in ttc():
                table[word] = max(table.get(word, 0), count)
            _FREQUENCIES = table
        except Exception:
            _FREQUENCIES = {}
    return _FREQUENCIES


def frequency_bonus(headword: str, weight: float) -> float:
    """Counts are raw unigrams, so short words absorb counts from unrelated senses;
    log scaling plus a modest weight keeps that distortion small."""
    table = frequency_table()
    if not weight or not table:
        return 0.0
    best = max((table.get(form.strip(), 0) for form in (headword or "").split(",")), default=0)
    return weight * math.log10(1 + best)


def entry_text(headword: str, english: str, definition: str) -> str:
    """The text an entry is represented by. Must stay identical to ``encode.py``'s
    ``embed_text``, or the cross-encoder would read a different entry than the one the
    vector was built from. The headword carries signal the definition often omits, and a
    term list with no definition falls back to the term itself."""
    head = headword or english or ""
    if english and headword and english != headword:
        head = f"{headword} ({english})"
    return f"{head}: {definition}" if definition else head


def slerp(start, destination, weight):
    """Follow a unit-sphere arc, choosing a deterministic plane for antipodal vectors."""
    start = np.asarray(start, dtype=np.float64)
    destination = np.asarray(destination, dtype=np.float64)
    start = start / np.linalg.norm(start)
    destination = destination / np.linalg.norm(destination)
    cosine = np.clip(start @ destination, -1.0, 1.0)
    if cosine > 1 - 1e-8:
        target = (1 - weight) * start + weight * destination
    else:
        tangent = destination - cosine * start
        length = np.linalg.norm(tangent)
        if length < 1e-12:
            # /** The antipode has no unique arc; use the least-aligned coordinate axis. */
            tangent = np.eye(len(start))[np.argmin(np.abs(start))]
            tangent -= (tangent @ start) * start
            length = np.linalg.norm(tangent)
        angle = np.arccos(cosine) * weight
        target = np.cos(angle) * start + np.sin(angle) * tangent / length
    return target / np.linalg.norm(target)


class BgeIndex:
    """Dense index materialised from the shipped embeddings, plus lazily loaded models."""

    def __init__(self, settings, folder, expected_manifest):
        from .retrieval import verify_index_files

        self.settings, self.manifest = settings, expected_manifest
        on_disk = verify_index_files(settings, folder, expected_manifest)
        rows = json.loads((folder / "rows.json").read_text(encoding="utf-8"))
        self.definition_ids = rows["definition_ids"]
        self.word_ids = rows["word_ids"]
        self.headwords = rows["headwords"]
        self.texts = rows["texts"]
        self.entries = rows["entries"]
        # Memory-mapped: the matmul touches every row anyway, but this lets the OS page
        # cache share one 268 MB copy across worker processes instead of one each.
        self.vectors = np.load(folder / "vectors.npy", allow_pickle=False, mmap_mode="r")
        if self.vectors.shape[0] != len(self.definition_ids):
            raise ValueError("invalid_vector_shape")
        self.identity = index_embedding_identity(settings)
        if self.identity != on_disk["embedding_identity"]:
            raise ValueError("embedding_identity_mismatch")
        self.row_of_definition = {definition: row for row, definition in enumerate(self.definition_ids)}
        self.row_of_form: dict[str, int] = {}
        for row, headword in enumerate(self.headwords):
            for form in (headword or "").split(","):
                self.row_of_form.setdefault(form.strip(), row)
        self._encoder = None
        self._reranker = None
        self._model_lock = threading.RLock()

    @property
    def embedding(self):
        """This adapter is its own encoder; callers that only want vectors ask for this."""
        return self

    # ---------------- models (lazy: nothing loads until a query needs it) ----------------
    @property
    def device(self):
        try:
            import torch

            return "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            return "cpu"

    @property
    def encoder(self):
        """Load the cached encoder once, including when startup and callers overlap."""
        with self._model_lock:
            return self._load_encoder()

    def _load_encoder(self):
        """Publish only a fully initialized encoder; never fetch model files at runtime."""
        if self._encoder is None:
            from sentence_transformers import SentenceTransformer

            model = SentenceTransformer(self.settings.bge_model, device=self.device, local_files_only=True)
            model.max_seq_length = 512
            self._encoder = model.half() if self.device == "cuda" else model
        return self._encoder

    @property
    def reranker(self):
        """Plain transformers rather than sentence_transformers.CrossEncoder: that wrapper
        breaks on transformers>=5, and one less layer keeps this adapter portable."""
        with self._model_lock:
            return self._load_reranker()

    def _load_reranker(self):
        """Load the cached reranker atomically without a startup network dependency."""
        if self._reranker is None:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer

            tokenizer = AutoTokenizer.from_pretrained(self.settings.rerank_model, local_files_only=True)
            model = AutoModelForSequenceClassification.from_pretrained(
                self.settings.rerank_model, local_files_only=True
            )
            model = model.to(self.device).eval()
            self._reranker = (tokenizer, model.half() if self.device == "cuda" else model, torch)
        return self._reranker

    def warmup(self):
        """Exercise both local models independently so one missing cache cannot skip the other."""
        for operation in (self.encode_query, self._rerank) if self.settings.rerank_enabled else (self.encode_query,):
            try:
                if operation == self._rerank:
                    operation("ความหมาย", ["ความหมาย"])
                else:
                    operation("ความหมาย")
            except Exception:
                # /** Requests retain their existing dense or lexical fallback when a model is absent. */
                continue

    # ---------------- encoding (ContextService scores senses through this) ----------------
    def encode(self, texts):
        return self.encoder.encode(
            list(texts), normalize_embeddings=True, convert_to_numpy=True, show_progress_bar=False
        ).astype(np.float32)

    def encode_query(self, text):
        return self.encode([text])[0]

    def _rerank(self, query, texts, batch_size=16):
        tokenizer, model, torch = self.reranker
        scores = []
        with torch.no_grad():
            for start in range(0, len(texts), batch_size):
                batch = texts[start : start + batch_size]
                encoded = tokenizer(
                    [query] * len(batch),
                    batch,
                    padding=True,
                    truncation=True,
                    max_length=512,
                    return_tensors="pt",
                ).to(self.device)
                scores.extend(model(**encoded).logits.view(-1).float().cpu().tolist())
        return scores

    def score_senses(self, context, texts):
        """Cross-encoder scores for one context against several senses of one word.

        The bi-encoder cannot do this job: BGE-M3 compresses every Thai string pair into a
        narrow band, so the gap between two senses of the same word is ~0.01 and no
        absolute margin can separate them. The cross-encoder reads context and sense
        together and produces well-separated logits, which is the same reason it is used
        for reranking. Returns None when no reranker is available, so the caller can fall
        back rather than fail."""
        if not self.settings.rerank_enabled or not texts:
            return None
        try:
            return self._rerank(context, list(texts))
        except Exception:
            return None

    # ---------------- retrieval ----------------
    def retrieve(self, query, limit, probes=None, boost=None):
        """Rank published definitions for `query`.

        `probes` are extra definition-shaped phrasings of the same need (see
        ``expansion.py``): an entry near ANY probe counts, which is what lets a user's
        description reach an index that stores dictionary definitions. `boost` are words
        the model believes are the answer; they are looked up in this corpus and ranked
        higher if found, so the model can surface a word the dense pass ranked too low,
        but a word it invented still retrieves nothing.
        """
        queries = [query] + [p for p in (probes or []) if p and p != query]
        vectors = self.encode(queries)
        dense = (self.vectors @ vectors.T).max(axis=1) if len(queries) > 1 else self.vectors @ vectors[0]
        if not np.isfinite(dense).all():
            raise ValueError("nonfinite_embedding")

        pool = max(self.settings.rerank_candidates, limit)
        window = min(pool * 4, len(dense))
        order = np.argpartition(-dense, window - 1)[:window]
        order = order[np.argsort(-dense[order])]

        # One candidate per entry: RID repeats a headword across editions, and duplicates
        # would otherwise fill the result slots that should hold distinct answers.
        hits, seen = [], set()
        for row in order:
            word_id = self.word_ids[row]
            if word_id in seen:
                continue
            seen.add(word_id)
            hits.append({"row": int(row), "dense": float(dense[row])})
            if len(hits) >= pool:
                break

        # A word the model proposed joins the pool even when it ranks below it on dense
        # similarity alone — otherwise the boost can never fire for the answer the model
        # actually named. Bounded by the number of proposed words, and the entry still has
        # to exist in this corpus, so nothing invented can enter here.
        proposed = {word.strip() for word in (boost or []) if word and word.strip()}
        for word in proposed:
            row = self.row_of_form.get(word)
            if row is not None and self.word_ids[row] not in seen:
                seen.add(self.word_ids[row])
                hits.append({"row": row, "dense": float(dense[row])})

        mode = "bge_m3_dense"
        scores = [hit["dense"] for hit in hits]
        if self.settings.rerank_enabled and hits:
            texts = [self.entries[h["row"]] for h in hits]
            try:
                if len(queries) == 1:
                    scores = self._rerank(query, texts)
                else:
                    columns = [self._rerank(q, texts) for q in queries[:4]]
                    scores = [max(column[i] for column in columns) for i in range(len(hits))]
                mode = "bge_m3_rerank"
            except Exception:
                mode = "bge_m3_dense_rerank_unavailable"

        # A query with no genuine answer in the corpus must produce none, not the least bad
        # row: the cross-encoder scores those negative where dense cosine is merely low. The
        # floor is applied to the BEST score only — it decides whether the corpus has an
        # answer at all. Applying it per candidate instead silently truncated good result
        # lists, because a correct answer ranked fourth can still score below zero.
        floor = (
            self.settings.rerank_floor
            if mode.startswith("bge_m3_rerank")
            else self.settings.semantic_threshold
        )
        weight = self.settings.frequency_weight
        kept = [] if (scores and max(scores) < floor) else hits
        for hit, score in zip(hits, scores, strict=True):
            hit["retrieval_score"] = float(score) + frequency_bonus(self.headwords[hit["row"]], weight)
        # The model knows which synonym is the common one; the dictionary carries no such
        # signal. So its words reorder what the index found — they never inject a candidate.
        for hit in kept:
            forms = {form.strip() for form in (self.headwords[hit["row"]] or "").split(",")}
            if proposed & forms:
                hit["retrieval_score"] += PROPOSED_WORD_BONUS
                hit["proposed_by_model"] = True
        hits = sorted(kept, key=lambda hit: -hit["retrieval_score"])

        candidates = [
            {
                "word_id": self.word_ids[hit["row"]],
                "definition_id": self.definition_ids[hit["row"]],
                "evidence_id": self.definition_ids[hit["row"]],
                "dense": hit["dense"],
                "retrieval_score": hit["retrieval_score"],
                "proposed_by_model": hit.get("proposed_by_model", False),
            }
            for hit in hits[:limit]
        ]
        if probes:
            mode += "_expanded"
        return {
            "candidates": candidates,
            "mode": mode,
            "degraded_reason": "RERANKER_UNAVAILABLE" if "rerank_unavailable" in mode
            else "NO_RELIABLE_CANDIDATE" if scores and not kept else None,
        }


    def knows_definitions(self, definition_ids) -> bool:
        """Whether any of these definitions is actually in the index.

        A word can be in the dictionary but absent from the embedding index, in which case
        it cannot steer anything. Callers need to be able to say so rather than report a
        steer that silently did nothing (REQ-UX-021).
        """
        return any(definition_id in self.row_of_definition for definition_id in definition_ids)

    def neighbours(self, definition_ids, limit, steer_definition_ids=(), steer_weight=0.0):
        """Entries whose meaning sits near this one in the embedding space.

        Deliberately NOT the word map: these are model-derived and carry no source
        authority, so they are reported separately and labelled as such. They exist
        because most entries declare no cross-references at all — 5,367 edges across
        44,287 entries — and "words near this in meaning" is still worth offering.

        With a steering word (REQ-UX-034) each sense follows a spherical arc to each
        destination sense, preserving max-over-senses at both endpoints. The
        steering vector is the steering word's OWN shipped vector, so this is arithmetic
        over the existing index — no model runs here, and the offline posture holds.
        """
        rows = [self.row_of_definition[d] for d in definition_ids if d in self.row_of_definition]
        if not rows:
            return []
        origin = {self.word_ids[row] for row in rows}
        steer_rows = [
            self.row_of_definition[d] for d in steer_definition_ids if d in self.row_of_definition
        ]
        steer_weight = min(max(steer_weight, 0.0), 1.0) if math.isfinite(steer_weight) else 0.0
        if steer_rows and steer_weight == 1:
            # /** Delegate so destination scores, exclusions and ordering are byte-identical. */
            return self.neighbours(steer_definition_ids, limit)
        if steer_rows and steer_weight > 0:
            # /** All sense pairs converge to the destination's own max-over-senses scores. */
            targets = np.asarray([
                slerp(self.vectors[row], self.vectors[steer_row], steer_weight)
                for row in rows for steer_row in steer_rows
            ])
            similarity = (self.vectors @ targets.T).max(axis=1)
            # While steering, that word names a direction, not a result; echoing it is
            # noise. At weight zero nothing is steered, so it stays an ordinary neighbour.
            origin = origin | {self.word_ids[row] for row in steer_rows}
        else:
            similarity = (self.vectors @ self.vectors[rows].T).max(axis=1)
        neighbours, seen = [], set(origin)
        order = []
        for row in np.argsort(-similarity):
            word_id = self.word_ids[row]
            if word_id in seen:
                continue
            seen.add(word_id)
            order.append(int(row))
            if len(order) >= max(limit * 4, limit):
                break
        if steer_rows and 0 < steer_weight < 1 and order:
            # /** Relevance minus maximum selected cosine; taper preserves exact endpoints. */
            penalty = 0.5 * math.sin(math.pi * steer_weight)
            selected = [order.pop(0)]
            while order and len(selected) < limit:
                redundancy = (self.vectors[order] @ self.vectors[selected].T).max(axis=1)
                best = int(np.argmax(similarity[order] - penalty * redundancy))
                selected.append(order.pop(best))
            order = selected
        for row in order[:limit]:
            word_id = self.word_ids[row]
            neighbours.append(
                {
                    "word_id": word_id,
                    "definition_id": self.definition_ids[row],
                    "word": self.headwords[row],
                    "description": self.texts[row][:240],
                    "similarity": float(similarity[row]),
                    "provenance": "AI_GENERATED_METADATA",
                }
            )
            if len(neighbours) >= limit:
                break
        return neighbours


def index_embedding_identity(settings) -> str:
    rerank = settings.rerank_model if settings.rerank_enabled else "none"
    return f"{settings.bge_model}+rerank:{rerank}+freq:{FREQUENCY_SOURCE}"


def build_bge_index(settings, repository, sessions, security, dataset_id, principal, correlation_id):
    """Gather the shipped vectors for every published definition. No model runs here."""
    import os
    import uuid

    import pyarrow.parquet as pq
    from sqlalchemy import select

    from .db import Dataset, Definition, IndexBuild, now
    from .domain import NORMALIZATION_VERSION
    from .ingestion import sha256_file
    from .retrieval import index_identity
    from .rid import sense_id_of

    security.authorize(principal, "import", correlation_id, dataset_id)
    passages = repository.passages(dataset_id)
    if len(passages) < 2:
        raise DomainError("INDEX_TOO_SMALL", "ต้องมีอย่างน้อยสองความหมายเพื่อสร้างดัชนี", 409)

    source = settings.corpus_dir / "embeddings.parquet"
    if not source.exists():
        raise DomainError(
            "CORPUS_EMBEDDINGS_MISSING", f"ไม่พบไฟล์เวกเตอร์ที่ {source} กรุณาตั้งค่า KHAMLINK_CORPUS_DIR", 409
        )
    table = pq.read_table(source).to_pydict()
    row_of_sense = {sense: row for row, sense in enumerate(table["sense_id"])}

    with sessions() as session:
        metadata = {
            definition_id: fields
            for definition_id, fields in session.execute(
                select(Definition.definition_id, Definition.metadata_fields).where(
                    Definition.dataset_id == dataset_id
                )
            ).all()
        }

    selected, kept, entries = [], [], []
    for passage in passages:
        row = row_of_sense.get(sense_id_of(passage["definition_id"]))
        if row is None:
            continue
        fields = metadata.get(passage["definition_id"]) or {}
        # A term-list record stores its English equivalent as the definition text, but was
        # embedded with an empty definition, so reconstruct the encoder's exact input.
        written = "" if fields.get("record_kind") == "term_equivalent" else passage["text"]
        selected.append(row)
        kept.append(passage)
        entries.append(entry_text(passage["word"], fields.get("headword_en", ""), written))
    if len(kept) < 2:
        raise DomainError("INDEX_TOO_SMALL", "ไม่พบเวกเตอร์ที่ตรงกับความหมายที่เผยแพร่", 409)

    vectors = np.asarray(table["vector"], dtype="float32")[selected]
    if not np.isfinite(vectors).all():
        raise DomainError("INVALID_INDEX", "ดัชนีไม่ผ่านการตรวจสอบ", 409)

    config, config_hash = index_identity(settings)
    index_id = "idx_" + uuid.uuid4().hex
    root = settings.data_dir / "indexes"
    root.mkdir(parents=True, exist_ok=True)
    folder = root / ("staging-" + uuid.uuid4().hex)
    folder.mkdir(mode=0o750)
    np.save(folder / "vectors.npy", vectors, allow_pickle=False)
    (folder / "rows.json").write_text(
        json.dumps(
            {
                "definition_ids": [p["definition_id"] for p in kept],
                "word_ids": [p["word_id"] for p in kept],
                "headwords": [p["word"] for p in kept],
                "texts": [p["text"] for p in kept],
                "entries": entries,
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    (folder / "embedding.json").write_text(
        json.dumps(
            {
                "identity": index_embedding_identity(settings),
                "model": settings.bge_model,
                "rerank_model": settings.rerank_model if settings.rerank_enabled else None,
                "dimensions": int(vectors.shape[1]),
                "source_checksum": sha256_file(source),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    with sessions() as session:
        dataset = session.get(Dataset, dataset_id)
        manifest = {
            "index_id": index_id,
            "dataset_id": dataset_id,
            "corpus": dataset.manifest["corpus"],
            "corpus_version": dataset.version,
            "source_id": dataset.source_id,
            "source_version": dataset.version,
            "source_checksum": dataset.checksum,
            "normalization_version": NORMALIZATION_VERSION,
            "embedding_identity": index_embedding_identity(settings),
            "config": config,
            "configuration_hash": config_hash,
            "built_at": now(),
            "method": config["method"],
            "provenance": "AI_GENERATED_METADATA",
            "passages": len(kept),
            "skipped_without_vector": len(passages) - len(kept),
            "files": {path.name: sha256_file(path) for path in folder.iterdir()},
        }
    (folder / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    os.replace(folder, root / index_id)
    with sessions.begin() as session:
        session.add(IndexBuild(index_id=index_id, dataset_id=dataset_id, manifest=manifest, validated=True))
    return manifest
