# Architecture and data flow

This is the reversible implementation of ARCH-012, not a change to the SRS. Python 3.12 / FastAPI / Pydantic serve the API and built React/TypeScript client on one origin. SQLAlchemy and Alembic own the lexical database. Local development/tests use SQLite; production configuration requires PostgreSQL with `sslmode=verify-full`. The supported MVP runtime is one API worker. No paid model is required.

## Boundaries

| Boundary | Implementation / contract |
|---|---|
| UI → API | `frontend/src/api.ts`, typed contracts, anonymous JSON; no server secrets in frontend |
| API → services | `api.py`, `services.py`, strict requests and safe error envelope |
| Lexical access | `LexicalRepository` protocol / `SQLLexicalRepository`, current published release only |
| Retrieval | `SearchService`, replaceable `RetrievalAdapter`, lexical independent of semantic channel |
| Dense indexing/retrieval | `IndexBuilder`, `BgeIndex` (default) or `HippoRAG2Adapter`, immutable manifest-bound index directories |
| Query rewriting | `QueryExpander`, opt-in, degrades to plain retrieval on any failure |
| Models | `EmbeddingProvider`, `ExtractionProvider`, `RecognitionProvider`, `GenerationProvider` protocols |
| Grounding | `GroundingService`: approved evidence first, bounded provider calls, structural and claim checks |
| Mutations | `IngestionService`, `Security`, authenticated roles/explicit permissions, durable administrative audit |
| Feedback / operations | `FeedbackService`, `Telemetry`, separate user-data tables and minimized events |

See the concrete class names in code; no service can promote generated data into source data. React renders source definitions first, curated metadata separately, and generated explanation in a separately labeled panel. What the interface claims about the corpus comes from the source manifest (`notice`, `official_royal_society`), never from hardcoded copy, so the claim cannot drift from the data actually served.

## Storage and lifecycle

`source_versions`, `source_words`, `source_definitions`, and source-qualified `published_relationships` contain SOURCE_DATA. `curated_metadata` and explicitly curated relationships contain CURATED_METADATA with producing process/evidence. `derived_ai_indexes` and files contain AI_GENERATED_METADATA. `user_feedback` contains USER_GENERATED_DATA. Generated response text is transient, not persisted as dictionary content.

The import path is: pinned artifact → checksum → Staged → validation report → Validated → immutable fresh index → atomic publication. Bad rows are quarantined; a partially valid batch needs explicit valid-subset approval. Optional unmapped POS is omitted with a quality issue. Mandatory defects are checked again at publication and cannot be waived. `active_release` uses a revision compare-and-swap; the previous valid release remains intact on error. Old releases/indexes are retained for rollback, not overwritten. Source-qualified IDs and version references are carried to every passage and explanation citation.

Thai search normalization is **trim only**, `thai-display-preserving-trim-v1`. No compatibility decomposition, mark stripping, transliteration, case folding, or spelling correction changes display forms. Word IDs are deterministic hashes of source identity and normalized headword; sense IDs are deterministic within source ordering, with version always supplied as part of their reference. New source snapshots must preserve or explicitly migrate sense identity rather than reuse an ID to refer to an unrelated sense.

## Retrieval: BGE-M3 dense + cross-encoder rerank + frequency prior

Default method identity `khamlink-bge-m3-rerank-frequency-v1` (`backend/khamlink/bge.py`). Three
signals, applied in order:

1. **Dense.** [BGE-M3](https://huggingface.co/BAAI/bge-m3) vectors, 1024-dim and L2-normalised,
   computed offline by the corpus pipeline's `encode.py` and shipped in `embeddings.parquet`.
   The index build only *gathers* the rows matching published definitions — no model runs at
   build time, and a 66k-sense index publishes in about a minute. The entry text the adapter
   reranks is reconstructed to be byte-identical to what the encoder embedded; if the two
   diverge, the cross-encoder is judging a different entry than the vector represents.
2. **Rerank.** [bge-reranker-v2-m3](https://huggingface.co/BAAI/bge-reranker-v2-m3) reads query
   and entry together over the top `RERANK_CANDIDATES` distinct entries. This is what separates
   an agent from a patient: `คนที่รักษาคนป่วย` retrieves แพทย์, not คนไข้, a distinction one vector
   per side cannot express. Loaded through plain `transformers`, not
   `sentence_transformers.CrossEncoder`, whose wrapper breaks on transformers ≥ 5.
3. **Frequency.** The dictionary carries no commonness signal, so embeddings rank ตะกละ, เติบ,
   กินสั่ง and จุ as near-equally good answers for "eats too much" — all correct, only one the word
   people use. `score += FREQUENCY_WEIGHT * log10(1 + count)` from the Thai National and Thai
   Textbook corpora via PyThaiNLP. Counts are raw unigrams, so short words absorb counts from
   unrelated senses; log scaling plus a modest weight bounds that distortion.

Online: exact/prefix lexical lookup over every written form of an entry → optional LLM query
expansion → dense scoring → per-entry deduplication → cross-encoder rerank → frequency prior →
ranking. Exact published matches dominate. Because rerank scores are unbounded logits that go
negative for weak matches, the rejection floor is applied to the *best* score only — it decides
whether the corpus has an answer at all. Applied per candidate it silently truncates correct
result lists, since a right answer ranked fourth can still score below zero.

Semantic failure still yields useful lexical output with `degraded=true`. Manifest, configuration
and checksum mismatches refuse index loading and publication. Exact-result caches include active
revision and index identity, never raw natural-language queries.

### Query expansion (HyDE), opt-in

The index holds *definitions*; readers type *descriptions*. Those are different shapes of text and
do not embed near each other. With `QUERY_EXPANSION=true`, the configured provider rewrites a
description into several definition-shaped phrasings, each of which becomes a probe; an entry near
any probe counts. The model never answers the query: candidates come only from the corpus, and
words it proposes merely reorder entries the index already returned, so an invented word retrieves
nothing. That is also what keeps rare, archaic and dialect entries reachable, which a model
guessing headwords could not do. Off by default — it sends the reader's words to the provider,
costs money per search, and is roughly ten times slower.

### Semantic neighbours are not the Word Map

`/api/words/{key}/related` returns two separate things. `relationships` are cross-references the
dictionary itself declares, `SOURCE_DATA`, and are the only thing the Word Map renders.
`semantic_neighbours` are nearest entries in embedding space, labelled `AI_GENERATED_METADATA`,
and never merged into the map. They exist because most entries declare no cross-reference at all —
5,367 edges across 44,287 entries — while "words near this in meaning" is still worth offering.

### The previous method, retained

`HippoRAG2Adapter` (`khamlink-hipporag2-method-v2`) and the `lsa`/`qwen` embedding providers remain
selectable via `KHAMLINK_EMBEDDING` and are still covered by tests. Reference implementation:
[HippoRAG commit 1438aba3…](https://github.com/OSU-NLP-Group/HippoRAG/tree/1438aba3fc44ff10573e5a5e1e7cc3c7f9794aff),
package metadata 2.0.0a5; [HippoRAG 2 method](https://arxiv.org/html/2502.14802v2). The official
package is not installed; MIT attribution is retained. Its character TF-IDF + 128-dim SVD default
(`thai-char-lsa-v1-d128`) needs no model download, which is its only advantage over BGE-M3.

Deliberate model choices and limitations:

- BGE-M3 and the reranker are ~2.2 GB each, downloaded on first use and loaded lazily, so a cold
  first query costs about a minute; subsequent queries are ~0.5 s on a consumer GPU.
- The vectors are trusted as shipped. If `embeddings.parquet` were encoded with a different model
  than `BGE_MODEL`, results would silently degrade; the index records the model identity and the
  source file checksum so the mismatch is at least auditable.
- Default generation remains local, extractive and deterministic (`local-extractive-summary-v1`).
  Remote compatible-provider output is held to the same conservative evidence contract. Free
  paraphrasing is not treated as verified merely because it cites an ID.

The versioned development benchmark covers exact, partial, Thai descriptions/questions/sentences, homographs, sparse graph, no result, grounding, comparison evidence, and graceful degradation. It is not a held-out evaluation or human comparison-accuracy study. Real-corpus gaps are explicitly reported rather than replaced by synthetic production definitions.

## Security and privacy

Queries and evidence are inert data in separate prompt fields; models receive no tools or database access. Responses must be strict JSON claims with eligible evidence IDs and exact supported source clauses. Invalid schemas, missing evidence, unsupported/official-label claims and timeouts return uncertainty. Source lookup remains available. Generation concurrency and runtime are bounded; a circuit breaker limits repeated remote failures.

Bearer tokens are validated server-side using stored SHA-256 digests, expiration and scoped roles. Core read/feedback journeys are anonymous. Audit failure closes privileged paths. Input/body bounds, per-cost rate limits, parameterized SQL, CSP, no-store responses, safe UUID correlation IDs and minimized structured logging are enforced. Raw user queries/contexts, free-text reports, IP, user-agent, provider payloads and credentials are not persisted by default. Rate-limit IP-derived keys exist only as salted in-memory HMAC values. Feedback uses short-lived signed target references and a per-tab random interaction ID; no cookie or login is created.

Limits: local single-process rate limits and feedback signatures are not a distributed gateway. Horizontal scaling requires a shared bounded limiter/key service and deployment-specific evaluation; simply adding workers is unsupported. PostgreSQL backup, transport certificates, OS isolation, secret management and alert delivery remain deployment responsibilities, not properties proven by unit tests.
