import os

import pytest
from khamlink.config import Settings
from khamlink.grounding import SYSTEM_POLICY
from khamlink.providers import CompatibleGenerator, ModelOutput


@pytest.mark.live
@pytest.mark.skipif(
    os.getenv("KHAMLINK_LIVE_TESTS") != "1", reason="Live external calls require explicit opt-in"
)
def test_VAL_060_live_provider_structured_extraction():
    settings = Settings()
    assert settings.provider == "compatible" and settings.provider_url and settings.provider_model
    provider = CompatibleGenerator(settings)
    try:
        output = ModelOutput.model_validate(
            provider.generate(
                {
                    "system": SYSTEM_POLICY,
                    "task": "explain",
                    "user_content": "",
                    "evidence": [{"definition_id": "test_1", "text": "รักษาให้คงเดิม"}],
                }
            )
        )
        assert output.claims[0].evidence_id == "test_1" and output.claims[0].quote == "รักษาให้คงเดิม"
    finally:
        provider.client.close()
