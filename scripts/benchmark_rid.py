"""Retrieval benchmark for the RID / BGE-M3 pipeline, graded through the HTTP API.

Same cases as the standalone `test_suite.py` that the pipeline was tuned on, but every
case goes through `/api/search`, `/api/words/...` and `/api/words/.../related`, so what is
measured is the integrated application rather than the retrieval module in isolation.

Needs the licensed corpus (KHAMLINK_CORPUS_DIR), a published dataset and index, and the
BGE-M3 / reranker weights, so it is opt-in and never part of `pytest`.

    python scripts/benchmark_rid.py                 # dense + rerank + frequency prior
    python scripts/benchmark_rid.py --expansion     # adds LLM query expansion
"""

import argparse
import json
import statistics
import time

from fastapi.testclient import TestClient
from khamlink.api import create_app
from khamlink.config import ROOT, Settings

K = 5

# (id, query, expected written forms | None, priority). None cannot be auto-graded.
SEMANTIC = [
    ("CORE-001", "คำที่หมายความว่ากินเยอะเกินไป", ["ตะกละ", "ตะกลาม"], "P0"),
    ("SEM-002", "คำที่หมายถึงการพูดโดยไม่คิดให้รอบคอบ", ["พลั้งปาก", "พลั้ง"], "P0"),
    ("SEM-003", "คำที่หมายถึงการช่วยเหลือคนอื่นโดยไม่หวังผลตอบแทน", ["เอื้อเฟื้อ"], "P0"),
    ("SEM-004", "คำที่หมายถึงรักษาของเดิมไว้ไม่ให้สูญหาย", ["อนุรักษ์", "อนุรักษ-"], "P0"),
    ("SEM-005", "คำที่หมายถึงการคิดถึงอดีตด้วยความรู้สึกอบอุ่นใจ", None, "P1"),
    ("SEM-006", "อยากได้คำที่แปลว่าเร็ว แต่เป็นทางการกว่า", None, "P0"),
    ("SEM-007", "คำที่หมายถึงทำให้เรื่องแย่ลง", ["ซ้ำเติม"], "P1"),
    ("SEM-008", "คำเรียกคนที่ชอบช่วยเหลือผู้อื่น", None, "P1"),
    ("REG-001", 'คำที่เป็นทางการกว่าคำว่า "ช่วย"', None, "P0"),
    ("REG-002", 'คำที่เป็นทางการกว่าคำว่า "เยอะ"', None, "P0"),
    ("REG-003", 'คำที่สุภาพกว่าคำว่า "ตาย"', ["ถึงแก่กรรม", "สิ้นใจ", "ถึงมรณกรรม", "มรณะ"], "P1"),
    ("NLQ-002", "คำไหนใช้กับการทำงานให้ได้ผลดี", ["ประสิทธิภาพ", "ประสิทธิผล"], "P0"),
    ("NLQ-003", "มีคำที่สุภาพกว่าคำว่าโกหกไหม", None, "P0"),
    ("NLQ-004", "ถ้าจะเขียนรายงานควรใช้คำว่าอะไรแทนคำว่าเยอะ", None, "P0"),
    ("NLQ-005", "คำว่าอนุรักษ์หมายถึงอะไร", ["อนุรักษ์", "อนุรักษ-"], "P0"),
]
EXACT = [
    ("EXA-001", "ตะกละ", True),
    ("EXA-002", "ประสิทธิภาพ", True),
    ("EXA-003", "อนุรักษ์", True),
    ("EXA-004", "XYZABC", False),
    ("EXA-005", "ประสิทธิภพ", False),  # typo: an exact miss is the expected result
]
NO_RESULT = [("ERR-001", "asdfghjkl"), ("ERR-002", "zxcvbnmqwerty")]
RELATED = [("REL-001", "ความสุข"), ("REL-002", "ตะกละ"), ("CON-001", "ประสิทธิภาพ")]


def matched(words, expected):
    """A hit counts if any expected form appears in a result's comma-joined headword."""
    for word in words:
        forms = {part.strip() for part in (word or "").split(",")} | {(word or "").strip()}
        if forms & set(expected):
            return word
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expansion", action="store_true", help="enable LLM query expansion")
    parser.add_argument("--json", help="write the full result table to this path")
    args = parser.parse_args()

    overrides = {"lookup_rate": 100000, "costly_rate": 100000, "feedback_rate": 100000}
    if args.expansion:
        overrides["query_expansion"] = True
    settings = Settings(**overrides)
    print(f"embedding={settings.embedding} rerank={settings.rerank_enabled} expansion={args.expansion}")

    latencies, results, rows = [], [], []
    with TestClient(create_app(settings), raise_server_exceptions=False) as client:
        client.post("/api/search", json={"query": "อุ่นเครื่อง", "limit": 1})  # load models once

        print("\n=== SEMANTIC ===")
        for case_id, query, expected, priority in SEMANTIC:
            start = time.perf_counter()
            response = client.post("/api/search", json={"query": query, "limit": K})
            elapsed = time.perf_counter() - start
            latencies.append(elapsed)
            payload = response.json().get("data") or {}
            words = [c["word"] for c in payload.get("candidates", [])]
            verdict = "REVIEW" if expected is None else ("PASS" if matched(words, expected) else "FAIL")
            results.append((case_id, priority, verdict))
            rows.append({"id": case_id, "query": query, "verdict": verdict, "found": words})
            print(f"  [{case_id} {priority}] {verdict} ({elapsed:.1f}s) {query}")
            for rank, candidate in enumerate(payload.get("candidates", []), 1):
                print(f"      {rank}. {candidate['word']} — {candidate['description'][:50]}")

        print("\n=== EXACT LOOKUP ===")
        for case_id, word, should_exist in EXACT:
            found = client.get(f"/api/words/{word}").status_code == 200
            verdict = "PASS" if found == should_exist else "FAIL"
            results.append((case_id, "P0", verdict))
            rows.append({"id": case_id, "query": word, "verdict": verdict, "found": found})
            print(f"  [{case_id}] {verdict} {word!r} exists={found} (expected {should_exist})")

        print("\n=== NO RESULT ===")
        for case_id, query, in [(c[0], c[1]) for c in NO_RESULT]:
            payload = client.post("/api/search", json={"query": query, "limit": 3}).json().get("data") or {}
            rejected = not payload.get("candidates")
            verdict = "PASS" if rejected else "FAIL"
            results.append((case_id, "P0", verdict))
            rows.append({"id": case_id, "query": query, "verdict": verdict, "state": payload.get("state")})
            print(f"  [{case_id}] {verdict} {query!r} state={payload.get('state')}")

        print("\n=== RELATED (source map + semantic neighbours) ===")
        for case_id, word in RELATED:
            payload = client.get(f"/api/words/{word}/related").json().get("data") or {}
            edges = [e["word"] for e in payload.get("relationships") or []]
            near = [n["word"] for n in payload.get("semantic_neighbours") or []]
            verdict = "PASS" if edges or near else "FAIL"
            results.append((case_id, "P0", verdict))
            rows.append({"id": case_id, "query": word, "verdict": verdict, "map": edges, "near": near})
            print(f"  [{case_id}] {verdict} {word} map={edges[:4] or '-'} near={near[:4] or '-'}")

    graded = [r for r in results if r[2] in {"PASS", "FAIL"}]
    p0 = [r for r in graded if r[1] == "P0"]
    passed = sum(1 for r in graded if r[2] == "PASS")
    print("\n=== SUMMARY ===")
    print(f"  auto-graded : {passed}/{len(graded)}")
    print(f"  P0 only     : {sum(1 for r in p0 if r[2] == 'PASS')}/{len(p0)}")
    print(f"  review      : {sum(1 for r in results if r[2] == 'REVIEW')}")
    failing = [r[0] for r in graded if r[2] == "FAIL"]
    if failing:
        print(f"  FAILING     : {', '.join(failing)}")
    if latencies:
        print(
            f"  latency     : mean={statistics.mean(latencies):.2f}s "
            f"median={statistics.median(latencies):.2f}s max={max(latencies):.2f}s"
        )
    if args.json:
        path = ROOT / args.json
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"passed": passed, "graded": len(graded), "cases": rows}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"  written     : {path}")
    return 0 if not failing else 1


if __name__ == "__main__":
    raise SystemExit(main())
