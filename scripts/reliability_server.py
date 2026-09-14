"""Opt-in, loopback-only VAL-053 server with controlled provider failures.

Reads the prepared local corpus, never imports/publishes or uses live credentials.
It is separate from the user's application on port 8000.
"""

import argparse
import threading
import time

import uvicorn
from khamlink.api import create_app
from khamlink.config import ROOT, Settings
from khamlink.providers import ExtractiveGenerator


class ControlledGeneration:
    identity = "local-reliability-controlled-v1"

    def __init__(self, timeout):
        self.timeout = timeout
        self.calls = 0
        self.lock = threading.Lock()

    def generate(self, request):
        with self.lock:
            scenario = self.calls % 10
            self.calls += 1
        if scenario == 8:
            raise RuntimeError("controlled_provider_failure")
        if scenario == 9:
            # Exceed the real configured outer deadline without any external I/O.
            time.sleep(self.timeout + 0.05)
            raise TimeoutError("controlled_provider_timeout")
        return ExtractiveGenerator().generate(request)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8776)
    args = parser.parse_args()
    defaults = {
        name: field.get_default(call_default_factory=True) for name, field in Settings.model_fields.items()
    }
    defaults.update(
        environment="test",
        database_url="sqlite:///" + (ROOT / "data/khamlink.db").as_posix(),
        identities_json="{}",
        lookup_rate=100000,
        costly_rate=100000,
        feedback_rate=100000,
    )
    settings = Settings(_env_file=None, **defaults)
    app = create_app(settings, provider=ControlledGeneration(settings.provider_timeout))
    uvicorn.run(
        app, host="127.0.0.1", port=args.port, access_log=False, proxy_headers=False, log_level="warning"
    )


if __name__ == "__main__":
    main()
