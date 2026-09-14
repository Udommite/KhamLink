"""Vendor-neutral offline CI entry point; never uses live model credentials.

Install locked dependencies first. --plan shows commands without running tests.
Real-corpus browser/load benchmarks and opted-in provider tests are separate.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check_environment():
    environment = {key: value for key, value in os.environ.items() if not key.upper().startswith(("KHAMLINK_", "LLM_", "EMBEDDING_", "OPENROUTER_"))}
    environment.update(
        {
            "KHAMLINK_PROJECT_ROOT": str(ROOT),
            "KHAMLINK_ENVIRONMENT": "test",
            "KHAMLINK_PROVIDER": "extractive",
            "KHAMLINK_PROVIDER_KEY": "",
            "KHAMLINK_PROVIDER_URL": "",
            "KHAMLINK_PROVIDER_MODEL": "",
            "KHAMLINK_EMBEDDING": "lsa",
            "KHAMLINK_LIVE_TESTS": "0",
            "KHAMLINK_ANALYTICS_ENABLED": "false",
            "LLM_PROVIDER": "extractive", "LLM_API_KEY": "", "LLM_BASE_URL": "", "LLM_MODEL": "",
            "EMBEDDING_PROVIDER": "lsa", "EMBEDDING_API_KEY": "", "EMBEDDING_BASE_URL": "",
            "PYTHONIOENCODING": "utf-8",
            "PYTEST_ADDOPTS": "",
            "PYTEST_PLUGINS": "",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "npm_config_offline": "true",
        }
    )
    return environment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", action="store_true", help="Print the check plan without executing it")
    args = parser.parse_args()
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        parser.error("npm is required; install the documented Node.js prerequisite")
    commands = [
        [sys.executable, "-m", "ruff", "check", "backend", "tests", "scripts", "migrations"],
        [sys.executable, "-m", "pytest", "-q", "-m", "not live"],
        [npm, "--prefix", "frontend", "test"],
        # Keep checks from replacing assets used by a concurrently running local site.
        [npm, "--prefix", "frontend", "run", "build", "--", "--outDir", "../artifacts/ci-web"],
    ]
    if args.plan:
        print(json.dumps({"offline": True, "live_tests": False, "commands": commands}, indent=2))
        return
    environment = check_environment()
    for command in commands:
        subprocess.run(command, cwd=ROOT, env=environment, check=True)
    print("Offline checks passed. Production/user-study acceptance is a separate gate.")


if __name__ == "__main__":
    main()
