"""VAL-032/046/047/060: no live network; exercise the real wire adapter."""

import json

import httpx
import pytest
from khamlink.config import Settings
from khamlink.providers import CompatibleGenerator
from pydantic import ValidationError


def fixture_settings(**overrides):
    defaults = {
        name: field.get_default(call_default_factory=True) for name, field in Settings.model_fields.items()
    }
    defaults.update(overrides)
    return Settings(_env_file=None, **defaults)


@pytest.mark.parametrize(
    "url",
    [
        "postgresql+psycopg://user:sslmode=verify-full@localhost/test?sslmode=disable",
        "postgresql+psycopg://localhost/test?application_name=sslmode=verify-full",
        "postgresql+psycopg://localhost/test?sslmode=verify-full&sslmode=disable",
        "postgresql+psycopg://localhost/test?sslmode=require",
        "postgresql+psycopg://localhost/test",
        "sqlite:///sslmode=verify-full",
    ],
)
def test_VAL_046_rejects_tls_option_spoofing(url):
    with pytest.raises(ValidationError) as error:
        fixture_settings(
            environment="production",
            production_policy_ack=True,
            database_url=url,
            identities_json='{"fixture-only": {}}',
            provider_key="SENSITIVE-TEST-KEY",
        )
    assert "SENSITIVE-TEST-KEY" not in str(error.value)
    assert url not in str(error.value)


def test_VAL_046_accepts_exact_parsed_tls_mode():
    settings = fixture_settings(
        environment="production",
        production_policy_ack=True,
        database_url="postgresql+psycopg://localhost/test?sslmode=verify%2Dfull",
        identities_json='{"fixture-only": {}}',
    )
    assert settings.environment == "production"


class ProbeStream(httpx.SyncByteStream):
    def __init__(self, chunks):
        self.chunks, self.reads, self.closed = chunks, 0, False

    def __iter__(self):
        for chunk in self.chunks:
            self.reads += 1
            yield chunk

    def close(self):
        self.closed = True


def call_provider(stream, headers=None):
    settings = fixture_settings(
        provider="compatible", provider_url="https://provider.invalid/v1", provider_model="fake-model"
    )
    provider = CompatibleGenerator(settings)
    provider.client.close()

    def respond(request):
        assert request.headers["accept-encoding"] == "identity"
        messages = json.loads(request.content)["messages"]
        assert [message["role"] for message in messages] == ["system", "user", "user"]
        assert "retrieved_evidence_untrusted_data" in json.loads(messages[2]["content"])
        return httpx.Response(200, headers=headers, stream=stream)

    provider.client = httpx.Client(transport=httpx.MockTransport(respond))
    try:
        return provider.generate(
            {"system": "fixture-policy", "user_content": "", "task": "explain", "evidence": []}
        )
    finally:
        provider.client.close()


def test_VAL_060_wire_adapter_success():
    output = {"claims": [{"evidence_id": "fixture-definition", "quote": "รักษาให้คงเดิม"}]}
    envelope = {"choices": [{"message": {"content": json.dumps(output, ensure_ascii=False)}}]}
    stream = ProbeStream([json.dumps(envelope, ensure_ascii=False).encode("utf-8")])
    assert call_provider(stream) == output
    assert stream.closed


def test_VAL_032_047_wire_adapter_stops_oversized_stream():
    stream = ProbeStream([b"x" * 8192] * 100)
    with pytest.raises(ValueError, match="oversized_output"):
        call_provider(stream)
    assert stream.closed and stream.reads == 9


@pytest.mark.parametrize("headers", [{"content-encoding": "gzip"}, {"content-length": "1000000"}])
def test_VAL_032_047_wire_adapter_rejects_unsafe_headers_before_body(headers):
    stream = ProbeStream([b"untrusted-body"])
    with pytest.raises(ValueError):
        call_provider(stream, headers)
    assert stream.closed and stream.reads == 0
