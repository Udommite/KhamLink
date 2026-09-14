# Environment reference

All application names below have prefix `KHAMLINK_`. Settings load the process environment and optional root `.env`; never commit real `.env` files. `ROOT` resolves to the workspace root. `.env.example` contains no credential. Restart after configuration changes. Retrieval-affecting changes require a fresh index and atomic publication.

| Suffix | Default | Meaning |
|---|---|---|
| `PROJECT_ROOT` | resolved editable-install root | Process environment only, before import; set to deployed project root for a non-editable package installation (Docker: `/app`) |
| `ENVIRONMENT` | `local` | `local`, `test`, `production`; demo bootstrap only local |
| `DATABASE_URL` | `sqlite:///data/khamlink.db` | Production: PostgreSQL+psycopg URI, percent-escaped credentials, verified TLS |
| `DATA_DIR` | root `data/` | Private writable cache/database/index directory; do not expose as static content |
| `SOURCE_MANIFEST` | `sources/thai_dict-1.0.json` | Reviewed source/version/license/checksum manifest |
| `IDENTITIES_JSON` | `{}` | Digest → subject, roles, expiry, optional extra permissions; server-side only |
| `PRODUCTION_POLICY_ACK` | `false` | Explicit owner acknowledgement of production policies; not an automatic approval mechanism |
| `PROVIDER` | `extractive` | `disabled`, `extractive`, `compatible` |
| `PROVIDER_URL`, `PROVIDER_MODEL`, `PROVIDER_KEY` | empty | Compatible API base URL/model/secret; URL must use HTTPS in production |
| `PROVIDER_TIMEOUT` | `8` | Seconds; >0 and ≤12; generation outer deadline also enforced |
| `EMBEDDING` | `lsa` | `lsa` or optional `sentence-transformers` |
| `EMBEDDING_MODEL` | `sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2` | Optional selection, not an approved/downloaded neural model |
| `EMBEDDING_REVISION` | empty | Required 40-hex model commit for neural mode |
| `SEMANTIC_ENABLED` | `true` | Disable for lexical-only operation without deleting an index |
| `DENSE_DIMENSIONS` | `128` | 8–1024; effective SVD dimensions bounded by corpus size |
| `LEXICAL_WEIGHT`, `DENSE_WEIGHT`, `GRAPH_WEIGHT` | `.35`, `.30`, `.20` | Fusion weights, individually 0–1 |
| `METADATA_WEIGHT`, `CONTEXT_WEIGHT` | `.05`, `.10` | Additional fusion weights, individually 0–1 |
| `SEMANTIC_THRESHOLD`, `RECOGNITION_THRESHOLD` | `.18`, `.26` | Provisional thresholds, benchmark before changing |
| `SYNONYM_ENABLED`, `SYNONYM_THRESHOLD` | `false`, `.92` | Optional AI-index edges only, never public Word Map |
| `PPR_DAMPING`, `PASSAGE_SEED_WEIGHT` | `.5`, `.05` | PageRank propagation and passage personalization |
| `SENSE_MARGIN` | `.12` | Minimum context sense-score separation; otherwise ambiguity |
| `QUERY_LIMIT`, `CONTEXT_LIMIT`, `REPORT_LIMIT` | `300`, `3000`, `1000` | Unicode code-point limits; report free text remains disabled |
| `PAGE_LIMIT`, `MAP_LIMIT`, `BODY_LIMIT` | `20`, `16`, `65536` | Result limit, one-hop neighbor limit, HTTP bytes |
| `LOOKUP_RATE`, `COSTLY_RATE`, `FEEDBACK_RATE` | `240`, `40`, `20` | Requests per peer/cost bucket per minute, one worker |
| `CACHE_TTL`, `CACHE_SIZE` | `120`, `512` | Exact-result cache seconds / maximum entries |
| `ANALYTICS_ENABLED` | `false` | Opt-in minimized product events; no raw-query persistence |
| `RETENTION_DAYS` | `7` | 1–365; event/feedback cleanup cutoff, schedule admin retention command |
| `ADMIN_TOKEN` | absent | CLI bootstrap only, supplied through process environment/secret manager |
| `LIVE_TESTS` | absent | Set `1` only for explicitly authorized remote provider tests |

`--host`, `--port`, `--ssl-certfile`, `--ssl-keyfile` are CLI arguments, not Settings fields. Production serving fails without TLS certificate and key. Proxy headers are deliberately not trusted; use TLS directly to the API or a TLS-preserving proxy with verified upstream certificates.

Identity value schema (placeholders only; never deploy a sample digest/token):

```json
{
  "<sha256-of-high-entropy-bearer-token>": {
    "subject": "named-ingestion-service",
    "roles": ["ingestion_service"],
    "expires_at": "<future-time-with-UTC-offset>",
    "permissions": []
  }
}
```

Permitted roles: `curator` (import, validate, quality, curate), `operator` (metrics, logs, runtime), `evaluator` (analytics), `ingestion_service` (import, validate), `search_service` (telemetry), `admin` (all administrative capabilities). Explicit `publish`, `reports`, or `analytics` grants can be added after separate authorization. Unknown roles grant nothing. Production owner must set short expiry, rotation/MFA/secret-store policy and separation of duties; no in-app self-service role escalation exists.
