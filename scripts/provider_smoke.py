"""Explicitly opted-in live checks using public dictionary text, never private context."""

import argparse
import json

import numpy as np
from fastapi.testclient import TestClient
from khamlink.api import create_app
from khamlink.config import Settings
from khamlink.qwen import QwenEmbedding


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    args = parser.parse_args()
    if not args.live:
        parser.error("External model calls require --live and configured server-side credentials")
    settings = Settings()
    if settings.embedding != "qwen" or settings.provider != "glm":
        parser.error("This check requires the explicitly selected qwen/glm providers")
    embedding = QwenEmbedding(settings)
    try:
        vectors = embedding.encode(["อนุรักษ์ รักษาให้คงเดิม", "สงวน ถนอมรักษาไว้"])
        query = embedding.encode_query("คำที่หมายถึงรักษาของเดิมไว้ไม่ให้สูญหาย")
        assert vectors.shape == (2, settings.embedding_dimensions)
        assert query.shape == (settings.embedding_dimensions,) and np.isfinite(query).all()
        print(json.dumps({"embedding": "passed", "model": settings.embedding_model, "dimensions": settings.embedding_dimensions}), flush=True)
    finally:
        embedding.close()
    with TestClient(create_app(settings)) as client:
        word = client.get("/api/words/อนุรักษ์").json()["data"]
        response = client.post("/api/explanations", json={"word_id": word["word_id"]})
        generated = response.json()["data"]
        assert generated["state"] == "grounded", generated.get("reason", "generation_not_grounded")
        assert generated["provider_identity"] == "glm:" + settings.provider_model
        assert generated["mode"] == "glm_grounded" and generated["provenance"] == "AI_GENERATED_METADATA"
        assert all(claim["evidence_ids"] for claim in generated["claims"])
        assert client.get("/api/words/อนุรักษ์").json()["data"]["definitions"] == word["definitions"]
        print(json.dumps({"generation": "passed", "model": settings.provider_model, "claims": len(generated["claims"]), "grounded": True}), flush=True)


if __name__ == "__main__":
    main()
