# KhamLink implementation checklist

Contract: `khamlink_srs.md`. Each REQ maps to the same-numbered VAL. P2 REQ-038 is included only as the necessary Word Map endpoint; REQ-058 is deferred. No SRS identifier is changed.

| Requirements / validations | Files / checks | Status |
|---|---|---|
| REQ/VAL-001–008 | `retrieval.py`, search UI; `test_api.py`, browser journeys, `benchmark.py` | Implemented; automated regression checks pass; held-out linguistic evaluation pending |
| REQ/VAL-009–014 | `repository.py`, Word Card, `grounding.py`; API/grounding/data tests, browser journeys | Implemented; source-first and evidence checks pass; optional source fields shown only when available |
| REQ/VAL-015–018 | `ComparisonService`, comparison UI; API/browser tests | Implemented and regression-tested; independent linguistic accuracy pending |
| REQ/VAL-019–022 | `ContextService`, Context Lens; API/browser tests | Implemented and regression-tested; segmentation policy remains Q-006 |
| REQ/VAL-023–026, 038 | `Relationship`, one-hop SVG/list; data/API/browser tests | Implemented; six types fixture-tested; real sparse/cross-reference behavior checked |
| REQ/VAL-027–032 | providers/grounding; `test_grounding.py`, failure browser journey | Implemented; deterministic success/failure/injection checks pass; no live-provider approval claimed |
| REQ/VAL-033–035 | feedback, minimized telemetry; API/privacy/browser tests | Implemented and regression-tested; production privacy/retention approval pending |
| REQ/VAL-036–037, 039 | typed API/errors; backend and frontend client tests | Implemented and regression-tested |
| REQ/VAL-040–042 | schema/manifest/ingestion; `test_data_retrieval.py` | Real corpus published; mandatory-field, quarantine, rollback, checksum and index-compatibility checks pass |
| REQ/VAL-043–049 | security/RBAC/transport/privacy; API and privacy tests | Local controls implemented/tested; production TLS/identity deployment validation pending |
| REQ/VAL-050–052 | observability/cache; privacy/API/grounding tests, benchmark | Implemented; 500 lookup + 500 hybrid requests measured; approved workload/environment remains Q-013 |
| REQ/VAL-053 | `reliability_server.py`, `reliability/generation.spec.ts` | 100 browser→API→provider calls: 80 successes, 10 failures, 10 actual 8-second timeouts; both viewports pass provisional timing/source-access criteria; reference approval remains Q-013 |
| REQ/VAL-054–055 | responsive UI; Chromium desktop/mobile browser journeys, axe and keyboard checks | Automated checks pass; approved physical browsers and manual screen-reader test pending |
| REQ/VAL-056 | Thai-first UI, `usability-study.md` | Implemented UI; representative participant study NOT run |
| REQ/VAL-057, 059–060 | versioned indexes, failure handling, explicit adapters; retrieval/grounding/browser tests | Engineering checks pass; approved scale test pending Q-017 |
| REQ/VAL-058 | future external developer API program | Deferred P2 |

Local evidence on 2026-09-14: the final `scripts/check.py` run passed 69 backend tests / 1 explicit live-provider test deselected, 4 frontend unit tests, frontend production build and Python lint. The prior 10 real-corpus desktop/mobile browser journeys also passed. These are not a claim of exhaustive VAL acceptance. `artifacts/benchmark-results.json` records the development benchmark and its coverage gaps. No raw private user text was used.

`scripts/check.py` is the offline CI entry point. It excludes live tests and provider credentials and builds outside the serving directory. Tests use explicit fixture defaults rather than inheriting the deployment's model/provider configuration. Full third-party frontend notices are emitted at build time. Local server start/reuse and stop-target preview have been checked without shutting down the user's live website.

Additional focused evidence: offline API documentation and explicit UTF-8 JSON headers pass a new API check. The 100-call controlled-provider browser benchmark completed on 2026-09-14: desktop p95 8,188 ms / maximum processing indication 3.2 ms; mobile p95 8,134 ms / maximum processing indication 3.4 ms. Source inspection remained operable during timeouts. These are instrumented local Chromium observations, not ratified production SLA, live-provider latency, or real-device acceptance. Raw measurements are in `artifacts/reliability-browser/`; run status is in `artifacts/reliability-report.json`. The running user-facing server was not restarted for these checks.

The user subsequently prioritized a running local website within ten minutes and asked to pause rigorous testing. The isolated fresh-environment run subsequently passed all seven steps: new Python/npm dependencies, frontend build, fresh approved corpus acquisition, database/index publication and real-record application smoke checks. Evidence: `artifacts/fresh-start/7b4db433ce834a178cca96c2efe0320d/result.json`. This verifies the local Windows setup path, not the untested Docker/PostgreSQL production path. The quick launcher is `Open-KhamLink.cmd` / `open-local.ps1`.

Final REQ/VAL-050 hardening moves noncritical log/analytics writes to a bounded asynchronous worker and enables minimized JSON application logs in the CLI. The focused slow-sink/overflow check confirms dictionary lookup remains available and telemetry loss raises an observable alert. Privileged audits retain their durable fail-closed behavior.

Final local handoff: the workspace-owned background server was stopped and reopened with the latest backend code, reusing the published corpus/index without replacement. Live HTTP checks on port 8000 passed for homepage, readiness, offline API reference, license notices, Thai exact lookup, non-degraded HippoRAG/PPR discovery, two-word comparison, Context Lens, separately classified grounded explanation and source access. Minimized structured JSON events were observed in the new server log. The website is left running at `http://127.0.0.1:8000`.

Post-handoff production-boundary review: REQ/VAL-032, 046, 047 and 060 received two focused fixes in `config.py` and `providers.py`: parsed TLS-option validation (including duplicate/spoofed-option rejection) and bounded streamed provider-response reads. `test_provider_transport.py` adds 11 offline checks; the combined transport/grounding/privacy run passed 25 tests, and repository-wide Python lint passed. These optional production/provider paths are disabled in the running local configuration; their new code loads at the next normal restart. No live model call or production database connection was made. Docker/PostgreSQL executables are unavailable in the current environment, so production integration remains unverified, not passed.

Q-001–Q-017 remain governance questions. The user's implementation instruction authorizes reversible local MVP choices; it does not ratify institutional governance or production policies. Concrete assumptions are recorded in `docs/assumptions.md`. No P1 deferral has been approved; REQ-058 is the deliberate P2 exclusion.
