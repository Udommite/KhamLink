"""Opt-in clean-install smoke: isolated copy, fresh venv/npm install and real corpus.

Needs internet for approved dependency/corpus downloads. Never copies .env, existing
data, node_modules or .venv, and never changes the running application's database.
Artifacts are retained for inspection, not automatically deleted.
"""

import json
import os
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SMOKE = """
import json
from fastapi.testclient import TestClient
from khamlink.api import create_app

app = create_app()
with TestClient(app) as client:
    assert client.get('/').status_code == 200
    assert client.get('/ready').json()['data']['status'] == 'ready'
    assert '<script' not in client.get('/api/docs').text
    assert client.get('/assets/THIRD_PARTY_NOTICES.txt').status_code == 200
    word = client.get('/api/words/อนุรักษ์').json()['data']
    other = client.get('/api/words/สงวน').json()['data']
    assert word['definitions'][0]['text'] == 'รักษาให้คงเดิม'
    assert word['source']['official_royal_society'] is False
    found = client.post('/api/search', json={'query': 'คำที่หมายถึงรักษาของเดิมไว้ไม่ให้สูญหาย'}).json()['data']
    assert not found['degraded'] and found['candidates'][0]['word'] == 'อนุรักษ์'
    compared = client.post('/api/compare', json={'word_ids': [word['word_id'], other['word_id']]}).json()['data']
    assert len(compared['words']) == 2
    context = client.post('/api/context', json={'text': 'เราช่วยกันอนุรักษ์ภาษาไทย'}).json()['data']
    assert any(span['word_id'] == word['word_id'] for span in context['spans'])
    explained = client.post('/api/explanations', json={'word_id': word['word_id']}).json()['data']
    assert explained['state'] == 'grounded'
    assert explained['provenance'] == 'AI_GENERATED_METADATA'
    assert client.get('/api/sources/' + word['dataset_id']).status_code == 200
    print(json.dumps({'state':'passed','release':found['release'],'search_mode':found['retrieval_mode'],'journeys':['homepage','ready','offline_docs','license_notices','lookup','semantic_search','compare','context','grounding','sources']}, ensure_ascii=False))
"""


def main():
    target = (ROOT / "artifacts" / "fresh-start" / uuid.uuid4().hex).resolve()
    if not target.is_relative_to(ROOT / "artifacts" / "fresh-start"):
        raise RuntimeError("fresh workspace must stay inside the project's artifacts directory")
    target.mkdir(parents=True, mode=0o750)
    print(f"Isolated setup: {target}", flush=True)
    for name in ["backend", "migrations", "sources"]:
        shutil.copytree(
            ROOT / name, target / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.egg-info")
        )
    for name in ["pyproject.toml", "requirements.lock", "alembic.ini", "THIRD_PARTY_NOTICES.md"]:
        shutil.copyfile(ROOT / name, target / name)
    (target / "frontend").mkdir()
    for name in ["package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "index.html"]:
        shutil.copyfile(ROOT / "frontend" / name, target / "frontend" / name)
    shutil.copytree(ROOT / "frontend/src", target / "frontend/src")
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.upper().startswith("KHAMLINK_")
        and key.upper() not in {"PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV"}
    }
    environment.update({"KHAMLINK_PROJECT_ROOT": str(target), "PYTHONIOENCODING": "utf-8"})
    python = target / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("Node.js/npm prerequisite is missing")
    steps = [
        ("Create a new Python environment", [sys.executable, "-m", "venv", str(target / ".venv")]),
        (
            "Install exact Python dependencies",
            [str(python), "-m", "pip", "--isolated", "install", "-r", "requirements.lock"],
        ),
        (
            "Install the application",
            [str(python), "-m", "pip", "--isolated", "install", "--no-deps", "-e", "."],
        ),
        ("Install exact frontend dependencies", [npm, "--prefix", "frontend", "ci"]),
        ("Build the complete website", [npm, "--prefix", "frontend", "run", "build"]),
        (
            "Acquire, validate, index and publish the real corpus",
            [str(python), "-m", "khamlink.cli", "demo", "--no-serve"],
        ),
        ("Smoke-check the new application", [str(python), "-c", SMOKE]),
    ]
    completed = []
    for index, (label, command) in enumerate(steps, 1):
        print(f"[{index}/{len(steps)}] {label}", flush=True)
        log = target / f"step-{index}.log"
        with log.open("w", encoding="utf-8") as stream:
            result = subprocess.run(
                command, cwd=target, env=environment, stdout=stream, stderr=subprocess.STDOUT
            )
        if result.returncode:
            print(f"Failed: {label}. Inspect {log}. No live files or databases were replaced.", flush=True)
            raise SystemExit(result.returncode)
        completed.append(label)
    evidence = {
        "state": "passed",
        "workspace": str(target),
        "steps": completed,
        "isolation": "new source copy, new venv/npm install, fresh approved artifact acquisition, new database/index; no .env or live data copied",
    }
    (target / "result.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
    print(json.dumps(evidence, indent=2), flush=True)


if __name__ == "__main__":
    main()
