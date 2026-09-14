# KhamLink

A Thai writing assistant. You write in a document; the right-hand rail tells you which words are not in the dictionary, which have a commoner synonym, which you have repeated, and which clash with the formality you asked for. Select any word to open its Royal Society entry. Everything runs anonymously, with no account and no external API key.

The source is the **Office of the Royal Society dictionary corpus** — พจนานุกรมฉบับราชบัณฑิตยสภา ฉบับ ๒๕๔๒ / ๒๕๕๔ / ๒๕๖๙, plus the Society's coined-term (ศัพท์บัญญัติ: แพทยศาสตร์, จิตวิทยา, ปรัชญา), transliteration and regional-dialect lists — normalised to one row per sense. Retrieval is **BGE-M3 dense vectors → bge-reranker-v2-m3 cross-encoder → a Thai National Corpus frequency prior**, with optional LLM query expansion.

> **Licensing.** This corpus is copyright the Office of the Royal Society. It is **not** redistributable and is deliberately not committed to this repository or downloaded by the setup script: the operator supplies it. Earlier versions of this README described a CC BY-SA Thai Wiktionary corpus and claimed the data was *not* an official Royal Society dictionary. With this corpus that claim would be false, so the manifest now declares `official_royal_society: true` and the interface says so. Decide the redistribution question before deploying anywhere public.

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

Open **http://127.0.0.1:8000**. The script installs locked dependencies and the retrieval models, builds React, SHA-256-verifies the corpus you supplied, migrates the database, stages/validates source records, gathers the shipped vectors into a fresh index, atomically publishes it, and starts the server.

**Before the first run, place the corpus.** Copy `senses.parquet`, `relations.parquet` and `embeddings.parquet` into `data/corpus/`, or point `KHAMLINK_CORPUS_DIR` at the folder holding them:

```powershell
$env:KHAMLINK_CORPUS_DIR = 'C:\path	o\out'
```

Setup fails early with a clear message if any of the three is missing. First run also downloads BGE-M3 and the reranker (~2.2 GB each) from Hugging Face; they are cached afterwards. A CUDA GPU is optional — install a CUDA torch build before `start.ps1 -Setup` for it — and queries run about `0.5 s` with one, several seconds on CPU. Subsequent starts use `powershell -NoProfile -ExecutionPolicy Bypass -File .\start.ps1`. `-PrepareOnly` verifies setup without starting a server; `-Port 8001` selects another local port. No administrator credential is exposed by the demo web server.

The first index build needs more time and memory than subsequent starts. Cache, database, model/index files and local test artifacts live under ignored `data/` and `artifacts/`; they are never source-controlled. Do not delete the data directory to restart the app.

## Demonstrate real records

1. **Write.** Open a new document and paste `อาหารร้านนี้แจ๋วมาก แต่เดือนหน้าร้านจะเจ๊งแล้ว น่าเสียดาย ฟลุ๊คคค`, then press **ตรวจข้อความ**. `ฟลุ๊ค` is underlined red — it is in no entry of the dictionary. Ordinary compounds like `อาหารร้าน` are not flagged, because the review checks whether a token is *made of* dictionary words before calling it an error.
2. **Change the goal.** The header chip opens the writing goal. Switch to **ทางการ** and the review re-runs: `แจ๋ว` and `เจ๊ง` now carry a purple ระดับภาษา underline, because RID itself marks those senses `(ปาก)`. Switch to **ไม่เป็นทางการ** and they go away. The score moves with them.
3. **Select a word.** Select `อนุรักษ์` in the text. The rail opens its entry: senses numbered ๑ ๒ ๓ in Thai numerals with the RID part-of-speech tab, pronunciation, edition, and a source-verification control. Semantic neighbours appear in their own group labelled `AI ประมวลผล`; they are never mixed into the dictionary's own cross-references.
4. **Find a word you cannot recall.** In **หาคำ**, describe the meaning: `คำที่หมายถึงรักษาของเดิมไว้ไม่ให้สูญหาย`. `อนุรักษ์` comes back first. Insert it at the cursor or open the full entry.
5. **Compare.** In **เทียบคำ**, put `อนุรักษ์` against `สงวน` and read the senses side by side, then request a grounded explanation of the difference.
6. **Breakdown.** **สรุปข้อความ** reports characters, Thai-tokenised words, sentences, reading and speaking time, dictionary coverage, register mix and edition mix. There is deliberately no English readability score — that formula does not apply to Thai.

Documents are stored in your browser only. They are never uploaded, and there is no account to attach them to.

## How the review decides

| Category | Fires when | Source of truth |
|---|---|---|
| ความถูกต้อง (red) | a PyThaiNLP token is in no entry, and is not made of entries | the alias table |
| ความชัดเจน (blue) | a near-synonym is ≥5× commoner and shares a part of speech | Thai National Corpus counts |
| ความน่าอ่าน (green) | an unambiguous content word is used 3+ times | BGE-M3 neighbours |
| ระดับภาษา (purple) | most senses carry a register mark that clashes with your goal | RID's own `(ปาก)`, `(โบ)`, `ถิ่น-` marks |

Two guards keep the rail trustworthy rather than noisy. A word is only flagged for register when **most** of its senses carry the mark — `ช่วย` has one archaic sense among many and is not flagged. And a word commoner than log₁₀ 3.0 in the Thai National Corpus is treated as ordinary vocabulary whatever one sense says, which is what stops `เพื่อน`, `บ้าน` and `ว่า` from being flagged as colloquial.

Review runs no model inference: neighbours come from the stored index vectors and lookups from the alias table, so it answers in milliseconds on a server that has never loaded BGE-M3.

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
.venv\Scripts\python.exe scripts/benchmark_rid.py            # retrieval quality, needs the corpus
```

`benchmark_rid.py` runs the 18 auto-graded cases the retrieval pipeline was tuned on, through the HTTP API rather than against the retrieval module directly. Current score: **15/18, P0 14/16, median 0.53 s/query** — identical to the standalone pipeline's score, so nothing is lost in integration. The three failures are corpus and method limits, not integration bugs: `SEM-003` and `SEM-007` are description queries the cross-encoder gets wrong, and `REL-001` asks for `ความสุข`, which RID does not file. `--expansion` adds LLM query rewriting.

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
