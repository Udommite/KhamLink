# KhamLink

Thai word discovery, source-linked Word Cards, comparisons, Context Lens, and an accessible one-hop Word Map. Anonymous core journeys run without an external model or API key. The selected source is **Thai Wiktionary through PyThaiNLP**, not an official Office of the Royal Society dictionary.

## Start on Windows

**Already prepared on this computer:** double-click `Open-KhamLink.cmd`. It starts the local server in the background (or reuses the running KhamLink server) and opens your browser at **http://127.0.0.1:8000**. No API key is required. This uses the existing built website and data; run the regular `start.ps1` below after changing code to rebuild.

Equivalent quick-open command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\open-local.ps1
```

Use `-NoBrowser` to start without opening a tab, or `-Port 8001` for another local port. Server output is saved under ignored `artifacts/local-server/`. The launcher leaves the local server running after its window closes. For a foreground server you can stop with Ctrl+C, use the regular command below instead.

To stop the background server, double-click `Stop-KhamLink.cmd`. It targets only this workspace's KhamLink process tree, not other Python applications, and does not delete your data. For another port: `powershell -NoProfile -ExecutionPolicy Bypass -File .\stop-local.ps1 -Port 8001`. Add `-WhatIf` to preview the target without stopping anything.

Prerequisites: Python 3.12, Node.js 24, npm, and internet access on first setup. Run in this workspace:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1 -Setup
```

Open **http://127.0.0.1:8000**. The script installs locked dependencies, builds React, downloads and SHA-256-verifies the 4.8 MB corpus, migrates the database, stages/validates source records, builds a fresh graph index if needed, atomically publishes it, and starts the server. Subsequent starts use `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1`. `-PrepareOnly` verifies setup without starting a server; `-Port 8001` selects another local port. No administrator credential is exposed by the demo web server.

The first index build needs more time and memory than subsequent starts. Cache, database, model/index files and local test artifacts live under ignored `data/` and `artifacts/`; they are never source-controlled. Do not delete the data directory to restart the app.

## Demonstrate real records

1. Search `อนุรักษ์`, or describe `คำที่หมายถึงรักษาของเดิมไว้ไม่ให้สูญหาย`.
2. Open a Word Card, inspect its source/version, request an explanation, inspect the cited evidence, and rate/report the result.
3. Compare `อนุรักษ์` with `สงวน`.
4. In Context Lens submit `เราช่วยกันอนุรักษ์ภาษาไทย`, then select `อนุรักษ์`. Submit `ขัน` to inspect multiple senses and uncertainty.
5. Open the Word Map. Sparse words explicitly show no relationship data. Generated retrieval triples never populate this map.

`thai_dict@1.0` contains 19,480 words and 33,515 senses after normalization. `ประสิทธิภาพ`, `ประสิทธิผล`, and `ความสุข` from the SRS examples are absent from this artifact. Lookup reports their absence; synthetic, clearly named test fixtures cover the associated mechanics without shipping invented source definitions.

## Manual setup and tests

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.lock
.venv\Scripts\python.exe -m pip install --no-deps -e .
npm.cmd --prefix frontend ci
npm.cmd --prefix frontend run build
.venv\Scripts\python.exe -m khamlink.cli demo --no-serve
.venv\Scripts\python.exe -m khamlink.cli serve
```

```powershell
.venv\Scripts\python.exe -m pytest -q
.venv\Scripts\python.exe -m ruff check backend tests scripts migrations
npm.cmd --prefix frontend test
npm.cmd --prefix frontend run build
Set-Location frontend
npx.cmd playwright install chromium
npm.cmd run test:e2e
Set-Location ..
.venv\Scripts\python.exe scripts/benchmark.py --load
```

The browser tests start a separate local server on port 8765. Default tests use deterministic providers and isolated synthetic data; browser/benchmark runs use the real acquired corpus. External calls in provider tests require `KHAMLINK_LIVE_TESTS=1` and explicit endpoint/model credentials. To test source-only operation, set `$env:KHAMLINK_PROVIDER='disabled'` before starting the server.

For vendor-neutral CI after dependency installation: `.venv\Scripts\python.exe scripts/check.py` runs lint, isolated backend tests, frontend unit tests and a build under `artifacts/ci-web` without changing a running site's assets. It excludes live-provider tests and removes inherited KhamLink provider credentials/settings from child processes. `--plan` prints the commands without running them. Default backend fixtures also construct explicit settings so a user's real provider environment cannot leak into tests. Browser and load benchmarks remain separate, opt-in checks.

Optional VAL-053 browser reliability benchmark (about two minutes): from `frontend`, run `npx.cmd playwright test -c playwright.reliability.config.ts`. It makes 100 instrumented requests across desktop/mobile, including ten actual eight-second timeouts and ten controlled provider failures. A separate server on port 8776 reads the prepared corpus; it does not restart the website on port 8000 or call a live provider. Measurements are saved under `artifacts/reliability-browser/` and `artifacts/reliability-report.json`.

The isolated fresh-install check passed on 2026-09-14: new Python/npm installations, a fresh corpus download, new database/index, frontend build and core-journey smoke checks. To repeat it, run `.venv\Scripts\python.exe scripts/fresh_setup_smoke.py`. It requires internet access and creates a separate ignored copy under `artifacts/fresh-start/`; it does not replace your running application's data. Each run keeps its step logs and `result.json` there.

For development, run the backend and `npm.cmd --prefix frontend run dev` in separate terminals; Vite proxies `/api` to port 8000. Normal local demonstration uses one origin and the built frontend.

## Contracts and release evidence

- [Architecture and method decisions](docs/architecture.md)
- [Data acquisition, administration, deployment and rollback](docs/operations.md)
- [Environment variables](docs/environment.md)
- [Requirement and validation checklist](docs/coverage.md)
- [Reversible assumptions and unresolved Q items](docs/assumptions.md)
- [Third-party and corpus notices](THIRD_PARTY_NOTICES.md)

The executable API schema is at `/api/openapi.json` and the offline-readable local reference at `/api/docs`. Neither needs an external CDN; both are disabled in production. Application JSON responses have `data`, `meta.correlation_id`, and `error`; errors contain a stable code, Thai message, safe field names, and correlation ID. The schema/reference themselves are not application response envelopes. Public source/generated/curated/user content uses separate fields and provenance classes. Backend code updates take effect after stopping and reopening the local server.

Production rollout requires the deployment, privacy, source policy, linguistic evaluation, accessibility and participant-study gates recorded in the checklist. Passing automated engineering tests is not evidence of participant satisfaction or a production SLA.
