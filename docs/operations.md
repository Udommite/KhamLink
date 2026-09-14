# Operations and reproducible delivery

Start with the [README](../README.md). Run commands from the repository root. Local demonstration is loopback-only, source-approved by the user's instruction, and has no web administrator credential. Production is a separate, owner-approved deployment.

Prepared Windows workspace: `Open-KhamLink.cmd` starts/reuses the background website and opens its URL; `Stop-KhamLink.cmd` stops only the verified interpreter/command from this workspace, preserving data. The stop helper supports `-WhatIf` and rejects a changed process identity. No shutdown command is exposed through the anonymous HTTP API.

## Corpus acquisition and import

```powershell
.venv\Scripts\python.exe -m khamlink.cli acquire
.venv\Scripts\python.exe -m khamlink.cli migrate
.venv\Scripts\python.exe -m khamlink.cli demo --no-serve
```

`acquire` uses only the reviewed manifest's immutable release URL, exact byte count and pinned SHA-256. The live registry's latest version never silently changes the dataset. PyThaiNLP's supported `download(name, version=...)` / `get_corpus_path(name, version=...)` APIs were inspected; its `url` parameter selects a registry, not an artifact. KhamLink directly downloads the pinned artifact to keep approval/checksum/cache location under its own control and avoid a mutable registry or user-global corpus cache. This is intentional, not a parallel auto-update mechanism.

Only `thai_dict@1.0` is selected. Cached data lives at `data/cache/thai_dict/1.0/thai_dictionary.csv`; do not edit it. Missing required rows are quarantined and optional unmapped POS fields are omitted. The real snapshot yields 19,480 words and 33,515 senses, plus 10 optional POS mapping flags. The local demo explicitly accepts this valid subset. It does not publish excluded records or permit mandatory defects. Production curators must inspect their quality report before subset approval.

The demo command creates a random short-lived identity in its own process, runs authenticated staging/validation/build/publication, and discards that identity before serving. It is prohibited outside local mode. Normal `bootstrap` uses `KHAMLINK_ADMIN_TOKEN` and a matching, separately configured server-side identity. Never put a token in command-line arguments, URLs, logs, source control or browser storage.

## Protected publication workflow

Supply an approved manifest and credentials through a server deployment, start `serve`, and call the protected endpoints over TLS in production. In PowerShell below, the token already exists in the process environment and is not printed:

```powershell
$khamlinkBase = 'http://127.0.0.1:8000' # local only; use the verified HTTPS origin in production
$khamlinkAuth = @{ Authorization = 'Bearer ' + $env:KHAMLINK_ADMIN_TOKEN; 'Content-Type' = 'application/json' }
$khamlinkStage = Invoke-RestMethod -Method Post -Uri "$khamlinkBase/api/admin/imports" -Headers $khamlinkAuth
$khamlinkDataset = $khamlinkStage.data.dataset_id
Invoke-RestMethod -Uri "$khamlinkBase/api/admin/quality/$khamlinkDataset" -Headers $khamlinkAuth
Invoke-RestMethod -Method Post -Uri "$khamlinkBase/api/admin/imports/$khamlinkDataset/validate" -Headers $khamlinkAuth
```

If the report contains quarantined/optional fields, a curator explicitly reviews the exclusions and may repeat validation with `?accept_quarantine=true`. This flag does not waive stored mandatory-field defects. Build a fresh index with `POST /api/admin/imports/{dataset_id}/index`; retain `data.index_id` and its manifest. Review/benchmark before publication. Obtain the current revision from a normal successful `/api/search` response's `data.release.revision` (first uninitialized database has revision 0), then:

```text
POST /api/admin/imports/{dataset_id}/publish?expected_revision={current_revision}&index_id={reviewed_index_id}
```

Publication needs its own permission. A stale revision returns 409; inspect the new release and retry only after renewed review. Publication verifies source identity, required stored fields, all index checksums and runtime configuration. Omit `index_id` only for a deliberately reviewed lexical-only release. The index builder creates immutable directories; it never appends incompatible embeddings into a current index. Retrying a source import is idempotent. Retrying an index build intentionally creates a new immutable build.

Administrative UI is not required. Reports, quality and audits are at `/api/admin/reports`, `/api/admin/quality/{dataset_id}` and `/api/admin/audit`; roles and runtime configuration inspection are separate protected endpoints. Deployment-secret updates control role/config mutation, not anonymous API parameters. Curated relationship/metadata insertion is not an automatic AI promotion path; any future editor must require a named curator, valid evidence and producing review process.

## Local PostgreSQL with Docker Compose

Optional Docker/Compose files provide an isolated PostgreSQL-backed local demo. Docker is not installed on the current verification machine, so this path must be exercised on a Docker-enabled host before claiming it verified. Set a high-entropy URI-safe local database password in `KHAMLINK_POSTGRES_PASSWORD` (secret manager or process environment), then:

```powershell
docker compose up --build
```

Open `http://127.0.0.1:8000`. Only the application port is published, on loopback. PostgreSQL is internal to this **local-only** Compose network and uses a named volume; it is not a production TLS configuration. Do not use `docker compose down -v` as a restart command: it deletes persisted data. Use `docker compose down` to stop and `up` to resume. Image base tags must be resolved to approved digests and scanned when cutting a production release.

## Production deployment

1. Ratify the applicable [Q gates](assumptions.md), source processing/citation terms, research results and actual browser/accessibility checks. Choose one API worker for this MVP; approve workload/hardware before extrapolating benchmarks.
2. Build the frontend and install locked Python dependencies in an isolated, non-root service environment. Run unit/contracts/security tests, lint, browser tests, license inventory, dependency scanning and the versioned benchmark. The repository has no user-created Git history yet; choose source revision/signing policy before release packaging.
3. Supply a private data directory, immutable reviewed source/index files and least-privilege database/secret credentials. Ingestion identity may write unpublished builds; serving identity needs read access to source/index files and database permissions required by anonymous feedback. On Windows ensure data-directory ACLs are inherited by new index folders; on Linux use an approved common group/read permission. Do not expose `data/` as a web directory.
4. Configure `KHAMLINK_ENVIRONMENT=production`, `KHAMLINK_PRODUCTION_POLICY_ACK=true`, valid expiring identities and `postgresql+psycopg://...?...sslmode=verify-full` with a trusted CA/hostname. Do not set the acknowledgement to bypass decisions. Run migrations using an authorized migration identity, not the public HTTP interface.
5. Serve HTTPS directly with owner-provisioned certificates; no proxy header is trusted:

```text
python -m khamlink.cli serve --host 0.0.0.0 --port 8443 --ssl-certfile /run/secrets/tls.crt --ssl-keyfile /run/secrets/tls.key
```

6. If using a load balancer, preserve client TLS to the app or use verified HTTPS upstream and a reviewed client-rate-limit policy. Blindly trusting `X-Forwarded-Proto` / `X-Forwarded-For` is unsupported. Keep admin endpoints on an access-controlled management network in addition to bearer/RBAC checks. Use firewall/service supervisor controls, credential rotation and deployment-specific MFA for privileged access. Do not start multiple workers without shared rate-limit/signing infrastructure.
7. Disable proxy/load-balancer access logs containing URL queries, headers, bodies, IP or user-agent. Application Uvicorn access logging is off; its structured application events are minimized. Collect stdout/stderr in a restricted log sink, with approved retention, audit deletion policy and redaction verification. The CLI enables JSON-only application records on stderr without enabling third-party request logging. Never log exception request payloads or provider responses.

## Health, alerts and retention

`GET /health` is liveness. `/ready` verifies the database/current published source; semantic status there is explicitly *configured*, not a model probe. Semantic failure does not remove dictionary readiness. `/api/admin/metrics` separately probes index loading, reports generation mode/circuit state, bounded counters/recent timings and telemetry/semantic alerts. A protected external monitoring job should poll it and `/ready`, establish an incident owner, and alert on source loss, sustained semantic failure, timeouts, 5xx/error spikes or telemetry failure. No alert delivery destination is silently created by this app.

Analytics are off by default. If approved, turn on minimized events and schedule `POST /api/admin/retention` with a dedicated authorized credential. It removes feedback/events older than the configured cutoff; it is deliberately not invoked anonymously. Audit retention must be defined by Q-009/Q-012 and handled by the restricted audit-storage policy; never bulk-delete audits along with product telemetry. Feedback contains enum reasons and ratings, not raw report text; users receive receipt/error states.

Noncritical application logs and approved analytics writes use a single background worker and a bounded 1,024-event queue. A slow or failed sink never waits on the dictionary request path. Overflow drops noncritical events and increments `telemetry_failures` / the `telemetry_unavailable` alert; `telemetry_pending` exposes the backlog. Shutdown waits at most one second for the worker; unflushed noncritical events may be lost. Privileged security audits remain separately durable and fail closed. Q-012 must determine the production sink, retention and alert ownership.

The optional compatible model adapter requests uncompressed JSON and reads at most 64 KiB before parsing; oversized, compressed or failed responses take the normal source-preserving fallback. It closes rejected streams instead of downloading the rest of the body. A provider must honor `Accept-Encoding: identity`. Response streaming follows the [HTTPX streaming interface](https://www.python-httpx.org/quickstart/#streaming-responses). Production database validation inspects the [parsed SQLAlchemy URL query](https://docs.sqlalchemy.org/en/20/core/engines.html#sqlalchemy.engine.URL.query): exactly one `sslmode=verify-full` option is required; text in passwords/other parameters and duplicated modes cannot satisfy the gate. Configuration validation errors suppress input values to avoid disclosing secrets.

## Backup, upgrade and rollback

Before schema, source or index changes: take a consistent database backup and preserve the active source manifest, exact index directory, application build and dependency locks. PostgreSQL: use a restricted backup identity and `pg_dump`/managed consistent backup with verified TLS; perform a restore rehearsal into a separate database. Local SQLite: stop the service and copy its database plus any WAL state consistently, or use SQLite's online backup API; copying only a live `.db` file can be incomplete.

For source/index rollback, restore the previous reviewed manifest/configuration to the deployment and call publication on the retained Superseded dataset/index using the **current** expected revision. The same validation/checksum/RBAC gates apply; no pointer edits by hand. If index configuration changed, restore the matching application/config first or build a compatible new index. Switch only after health, real lookup, evidence and benchmark smoke checks. Concurrent publication is rejected by compare-and-swap.

Schema downgrade is deliberately refused by the initial migration; restore a reviewed backup with its matching application instead of destructive automatic downgrade. No dataset or index garbage collection runs automatically. Plan storage reclamation only after a retention/rollback window and exact-target review. Failed/staging builds may be inspected and removed by an operator only after confirming they are unreferenced and within the private index directory; never delete the workspace/data root to resolve an error.
