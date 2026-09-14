# Architecture and data flow

This is the reversible implementation of ARCH-012, not a change to the SRS. Python 3.12 / FastAPI / Pydantic serve the API and built React/TypeScript client on one origin. SQLAlchemy and Alembic own the lexical database. Local development/tests use SQLite; production configuration requires PostgreSQL with `sslmode=verify-full`. The supported MVP runtime is one API worker. No paid model is required.

## Boundaries

| Boundary | Implementation / contract |
|---|---|
| UI → API | `frontend/src/api.ts`, typed contracts, anonymous JSON; no server secrets in frontend |
| API → services | `api.py`, `services.py`, strict requests and safe error envelope |
| Lexical access | `LexicalRepository` protocol / `SQLLexicalRepository`, current published release only |
| Retrieval | `SearchService`, replaceable `RetrievalAdapter`, lexical independent of semantic channel |
| Graph indexing/retrieval | `IndexBuilder`, `HippoRAG2Adapter`, immutable manifest-bound index directories |
| Models | `EmbeddingProvider`, `ExtractionProvider`, `RecognitionProvider`, `GenerationProvider` protocols |
| Grounding | `GroundingService`: approved evidence first, bounded provider calls, structural and claim checks |
| Mutations | `IngestionService`, `Security`, authenticated roles/explicit permissions, durable administrative audit |
| Feedback / operations | `FeedbackService`, `Telemetry`, separate user-data tables and minimized events |

See the concrete class names in code; no service can promote generated data into source data. React renders source definitions first, curated metadata separately, and generated explanation in a separately labeled panel. PyThaiNLP/Thai Wiktionary content is never called an official Royal Society definition.

## Storage and lifecycle

`source_versions`, `source_words`, `source_definitions`, and source-qualified `published_relationships` contain SOURCE_DATA. `curated_metadata` and explicitly curated relationships contain CURATED_METADATA with producing process/evidence. `derived_ai_indexes` and files contain AI_GENERATED_METADATA. `user_feedback` contains USER_GENERATED_DATA. Generated response text is transient, not persisted as dictionary content.

The import path is: pinned artifact → checksum → Staged → validation report → Validated → immutable fresh index → atomic publication. Bad rows are quarantined; a partially valid batch needs explicit valid-subset approval. Optional unmapped POS is omitted with a quality issue. Mandatory defects are checked again at publication and cannot be waived. `active_release` uses a revision compare-and-swap; the previous valid release remains intact on error. Old releases/indexes are retained for rollback, not overwritten. Source-qualified IDs and version references are carried to every passage and explanation citation.

Thai search normalization is **trim only**, `thai-display-preserving-trim-v1`. No compatibility decomposition, mark stripping, transliteration, case folding, or spelling correction changes display forms. Word IDs are deterministic hashes of source identity and normalized headword; sense IDs are deterministic within source ordering, with version always supplied as part of their reference. New source snapshots must preserve or explicitly migrate sense identity rather than reuse an ID to refer to an unrelated sense.

## HippoRAG 2 adapter

Reference implementation: [HippoRAG commit 1438aba3…](https://github.com/OSU-NLP-Group/HippoRAG/tree/1438aba3fc44ff10573e5a5e1e7cc3c7f9794aff), package metadata 2.0.0a5; [HippoRAG 2 method](https://arxiv.org/html/2502.14802v2). The official package pins an incompatible dependency set (including Pydantic 2.10.4, while this app requires ≥2.11), plus a large Torch stack. It is **not installed**. The replaceable necessary-method implementation is `khamlink-hipporag2-method-v2`, with MIT attribution retained.

Each published dictionary sense becomes a passage with word/sense/source/version/publication/provenance references. The extraction adapter creates phrase/triple representations, phrase–phrase edges, and passage–phrase contains edges. The default extractive dictionary adapter uses the headword, `หมายถึง`, and source clauses. Its output is derived index data, not a linguistic relationship asserted by the dictionary. Optional cosine synonym edges are threshold-configured, bounded to nearest neighbors, disabled by default, and must be benchmarked before enabling.

Online: exact/prefix lexical lookup → passage and triple scoring → recognition-memory filter → phrase and passage seed selection → Personalized PageRank → passage ranking → weighted fusion with lexical, dense, graph, POS and context signals → stable-word deduplication with the strongest sense. Exact published matches dominate. No reliable recognized triple means dense fallback; semantic failure means useful lexical output with `degraded=true`. Manifest/configuration/checksum mismatches refuse index loading and publication, never mix indexes. Exact-result caches include active revision and index identity, not raw natural-language queries.

Deliberate model choices and limitations:

- Offline default: character TF-IDF plus seeded SVD (`thai-char-lsa-v1-d128`), trained on the selected Thai corpus. It supports Thai strings without a downloaded neural model; it is not claimed equivalent to a Thai neural encoder.
- Recognition uses configurable embedding/overlap filtering (`recognition-local-v1`), not the paper's LLM recognition prompt. `RecognitionProvider` allows replacement after benchmark approval.
- `DictionaryExtraction` is compatible extractive OpenIE, not unrestricted model-based OpenIE. Replace the extraction adapter and version its identity when changing it.
- Optional sentence-transformers requires a full 40-hex model revision, `trust_remote_code=False`, explicit license review and an opt-in installation. No neural model revision is approved or downloaded by default.
- Default generation is local, extractive, deterministic (`local-extractive-summary-v1`). It quotes supported clauses; curated summaries may provide simpler wording. Remote compatible-provider output is held to the same conservative evidence contract. Free paraphrasing is intentionally not treated as verified merely because it cites an ID.

The versioned development benchmark covers exact, partial, Thai descriptions/questions/sentences, homographs, sparse graph, no result, grounding, comparison evidence, and graceful degradation. It is not a held-out evaluation or human comparison-accuracy study. Real-corpus gaps are explicitly reported rather than replaced by synthetic production definitions.

## Security and privacy

Queries and evidence are inert data in separate prompt fields; models receive no tools or database access. Responses must be strict JSON claims with eligible evidence IDs and exact supported source clauses. Invalid schemas, missing evidence, unsupported/official-label claims and timeouts return uncertainty. Source lookup remains available. Generation concurrency and runtime are bounded; a circuit breaker limits repeated remote failures.

Bearer tokens are validated server-side using stored SHA-256 digests, expiration and scoped roles. Core read/feedback journeys are anonymous. Audit failure closes privileged paths. Input/body bounds, per-cost rate limits, parameterized SQL, CSP, no-store responses, safe UUID correlation IDs and minimized structured logging are enforced. Raw user queries/contexts, free-text reports, IP, user-agent, provider payloads and credentials are not persisted by default. Rate-limit IP-derived keys exist only as salted in-memory HMAC values. Feedback uses short-lived signed target references and a per-tab random interaction ID; no cookie or login is created.

Limits: local single-process rate limits and feedback signatures are not a distributed gateway. Horizontal scaling requires a shared bounded limiter/key service and deployment-specific evaluation; simply adding workers is unsupported. PostgreSQL backup, transport certificates, OS isolation, secret management and alert delivery remain deployment responsibilities, not properties proven by unit tests.
