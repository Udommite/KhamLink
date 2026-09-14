from test_api import data


def test_multi_word_comparison_and_grounding(system):
    """Three-word evidence covers every column, while duplicate and oversized input stay rejected."""
    client = system["client"]
    terms = ["ประสิทธิภาพ", "ประสิทธิผล", "ความสุข"]
    result = data(client.post("/api/compare", json={"word_ids": terms}))
    assert [word["word"] for word in result["words"]] == terms
    ids = [word["word_id"] for word in result["words"]]
    explanation = data(client.post("/api/compare/explanations", json={"word_ids": ids}))
    assert explanation["state"] == "grounded"
    assert {claim["word_id"] for claim in explanation["claims"]} == set(ids)
    assert client.post("/api/compare", json={"word_ids": terms + [terms[0]]}).status_code == 400
    assert client.post("/api/compare", json={"word_ids": ["a" * 4096, "b"]}).status_code == 400
    partial = data(client.post("/api/compare", json={"word_ids": terms + ["w_missing"]}))
    assert len(partial["words"]) == 3 and partial["state"] == "partial_failure"


def test_large_comparison_keeps_definitions_when_ai_evidence_exceeds_budget(system):
    """The workspace accepts many words without loosening the model's evidence safety budget."""
    terms = ["อนุรักษ์", "สงวน", "รักษา", "ความสุข", "ทุกข์", "ประสิทธิภาพ", "ประสิทธิผล"]
    client = system["client"]
    assert len(data(client.post("/api/compare", json={"word_ids": terms}))["words"]) == 7
    explanation = data(client.post("/api/compare/explanations", json={"word_ids": terms}))
    assert explanation["state"] == "insufficient_evidence" and not explanation["claims"]


def test_comparison_validates_each_canonical_term(system):
    """Comparison trims terms before enforcing per-term, control-character, and duplicate limits."""
    client = system["client"]
    assert client.post("/api/compare", json={"word_ids": [" ประสิทธิภาพ ", "ประสิทธิผล"]}).status_code == 200
    assert client.post("/api/compare", json={"word_ids": ["a" * 513, "b"]}).status_code == 400
    assert client.post("/api/compare", json={"word_ids": ["ประสิทธิภาพ\u0000", "ประสิทธิผล"]}).status_code == 400
    assert client.post("/api/compare", json={"word_ids": [" ประสิทธิภาพ ", "ประสิทธิภาพ"]}).status_code == 400
    assert client.post("/api/compare", json={"word_ids": [f"{letter}" * 512 for letter in "abcdefghi"]}).status_code == 400
