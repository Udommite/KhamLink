"""Mechanical release inventory from installed package metadata and license files.

Run with the target runtime's Python; never infer per-corpus rights from a package license.
"""

import importlib.metadata
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts" / "licenses"


def safe_name(value):
    return re.sub(r"[^a-zA-Z0-9._-]", "_", value)


def copy_notices(name, version, files):
    copied = []
    for number, source in enumerate(sorted(set(files))):
        if not source.is_file():
            continue
        folder = OUTPUT / safe_name(name + "-" + version)
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / (str(number) + "-" + safe_name(source.name))
        shutil.copyfile(source, target)
        copied.append(str(target.relative_to(ROOT)).replace("\\", "/"))
    return copied


def is_notice(path):
    return bool(
        re.search(r"(^|/)(licen[sc]e[^/]*|notice[^/]*|copying[^/]*)$", str(path).replace("\\", "/"), re.I)
    )


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    for distribution in importlib.metadata.distributions():
        meta = distribution.metadata
        name, version = meta.get("Name", "unknown"), distribution.version
        if name.lower() == "khamlink":
            continue
        declared = (
            meta.get("License-Expression")
            or meta.get("License")
            or "; ".join(item for item in meta.get_all("Classifier", []) if item.startswith("License ::"))
        )
        files = [Path(distribution.locate_file(p)) for p in distribution.files or [] if is_notice(p)]
        records.append(
            {
                "ecosystem": "python",
                "name": name,
                "version": version,
                "declared_license": declared,
                "notices": copy_notices(name, version, files),
            }
        )
    lock = json.loads((ROOT / "frontend/package-lock.json").read_text(encoding="utf-8"))
    for location, metadata in lock["packages"].items():
        if not location:
            continue
        package = ROOT / "frontend" / location
        files = [p for p in package.iterdir() if is_notice(p)] if package.is_dir() else []
        name = location.rsplit("node_modules/", 1)[-1]
        records.append(
            {
                "ecosystem": "npm",
                "name": name,
                "version": metadata["version"],
                "declared_license": metadata.get("license"),
                "integrity": metadata.get("integrity"),
                "installed": package.is_dir(),
                "notices": copy_notices(name, metadata["version"], files),
            }
        )
    payload = {
        "schema_version": 1,
        "corpus_manifest": "sources/thai_dict-1.0.json",
        "notes": "Metadata and copied installed notices, not legal approval; optional platform packages may not be installed.",
        "dependencies": sorted(records, key=lambda row: (row["ecosystem"], row["name"])),
    }
    path = OUTPUT / "inventory.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Inventoried {len(records)} dependency records: {path}")


if __name__ == "__main__":
    main()
