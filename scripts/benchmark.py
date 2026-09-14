"""Real-source retrieval and repeatable local performance benchmark (VAL-052/053).

Default evaluates relevance only. --load records >=500 lookups + hybrid searches
and >=100 generation requests. Results go to ignored artifacts, no private input.
"""

import argparse
import json
import platform
import time

import numpy as np
from fastapi.testclient import TestClient
from khamlink.api import create_app
from khamlink.config import ROOT, Settings


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--load", action="store_true")
    args = parser.parse_args()
    settings = Settings(lookup_rate=100000, costly_rate=100000, feedback_rate=100000, analytics_enabled=False)
    app = create_app(settings)
    spec = json.loads((ROOT / "benchmarks/retrieval-v1.json").read_text(encoding="utf-8"))
    cases = []
    with TestClient(app, raise_server_exceptions=False) as client:
        for case in spec["cases"]:
            start = time.perf_counter()
            response = client.post("/api/search", json={"query": case["query"], "limit": 10})
            result = response.json().get("data") or {}
            found = [r["word"] for r in result.get("candidates", [])]
            cases.append(
                {
                    **case,
                    "found": found,
                    "hit": bool(set(found) & set(case["expected"])) if case["expected"] else not found,
                    "latency_ms": round((time.perf_counter() - start) * 1000, 2),
                    "status": response.status_code,
                    "degraded": result.get("degraded"),
                    "mode": result.get("retrieval_mode"),
                }
            )
        exact = [c for c in cases if c["kind"] == "exact"]
        semantic = [c for c in cases if c["kind"] == "semantic"]
        # Coverage gaps are reported explicitly and never counted as retrieval successes.
        coverage_gaps = [
            c["query"]
            for c in cases
            if c["kind"] == "coverage" and client.get("/api/words/" + c["query"]).status_code == 404
        ]
        words = [client.get("/api/words/" + w).json()["data"] for w in ["อนุรักษ์", "สงวน"]]
        generated = client.post("/api/explanations", json={"word_id": words[0]["word_id"]}).json()["data"]
        contrast = client.post(
            "/api/compare/explanations", json={"word_ids": [w["word_id"] for w in words]}
        ).json()["data"]
        claims = generated["claims"] + contrast["claims"]
        supported = sum(
            all(
                c["text"] in client.get("/api/evidence/" + eid).json()["data"]["text"]
                for eid in c["evidence_ids"]
            )
            for c in claims
        )
        metrics = {
            "exact_top1": sum(c["found"][:1] == c["expected"][:1] for c in exact) / len(exact),
            "semantic_hit_at_10": sum(c["hit"] for c in semantic) / len(semantic),
            "supported_claim_rate": supported / max(1, len(claims)),
            "unsupported_claim_rate": (len(claims) - supported) / max(1, len(claims)),
            "comparison_evidence_coverage": len({c["word_id"] for c in contrast["claims"]}) / 2,
            "comparison_accuracy": "Not independently human-adjudicated; evidence coverage measured separately",
            "grounding_mode": generated.get("mode"),
        }
        app.state.settings.semantic_enabled = False
        degradation = client.post("/api/search", json={"query": "อนุ"}).json()["data"]
        metrics["graceful_degradation"] = bool(
            degradation["degraded"]
            and client.get("/api/words/อนุรักษ์").status_code == 200
            and client.get("/api/sources/" + words[0]["dataset_id"]).status_code == 200
        )
        app.state.settings.semantic_enabled = True
        if args.load:
            timing = {}
            operations = {
                "lookup": (500, lambda i: client.get("/api/words/อนุรักษ์")),
                "hybrid": (
                    500,
                    lambda i: client.post(
                        "/api/search", json={"query": semantic[i % len(semantic)]["query"], "limit": 10}
                    ),
                ),
                "generation": (
                    100,
                    lambda i: client.post("/api/explanations", json={"word_id": words[i % 2]["word_id"]}),
                ),
            }
            for name, (count, operation) in operations.items():
                for i in range(5):
                    operation(i)
                durations, errors = [], 0
                for i in range(count):
                    started = time.perf_counter()
                    response = operation(i)
                    durations.append((time.perf_counter() - started) * 1000)
                    errors += response.status_code != 200
                timing[name] = {
                    "requests": count,
                    "p50_ms": round(float(np.percentile(durations, 50)), 2),
                    "p95_ms": round(float(np.percentile(durations, 95)), 2),
                    "errors": errors,
                }
                print(json.dumps({name: timing[name]}), flush=True)
            metrics["latency"] = timing
        with app.state.sessions() as session:
            from khamlink.db import IndexBuild

            release = app.state.repository.release()
            index = session.get(IndexBuild, release["index_id"])
            manifest = index.manifest
    result = {
        "benchmark": spec["version"],
        "environment": {
            "os": platform.system(),
            "python": platform.python_version(),
            "machine": platform.machine(),
            "load": "single process, one sequential client, local SQLite, 5 warmups per operation; in-process ASGI TestClient; excludes network",
        },
        "index_manifest": manifest,
        "metrics": metrics,
        "coverage_gaps": coverage_gaps,
        "cases": cases,
        "limitations": [
            "Development benchmark, not held-out",
            "No representative participant satisfaction study",
            "No production load or mobile physical-device claim",
        ],
    }
    folder = ROOT / "artifacts"
    folder.mkdir(exist_ok=True)
    (folder / "benchmark-results.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(
        json.dumps(
            {
                "metrics": metrics,
                "coverage_gaps": coverage_gaps,
                "cases": [{"id": c["id"], "hit": c["hit"], "found": c["found"]} for c in cases],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
