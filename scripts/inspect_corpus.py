"""Read-only corpus shape and representative-record audit."""

import ast
import collections
import csv
import json
from pathlib import Path

path = Path(__file__).resolve().parents[1] / "data/cache/thai_dict/1.0/thai_dictionary.csv"
counts = collections.Counter()
selected = []
errors = []
seen = collections.Counter()
for i, row in enumerate(csv.DictReader(path.open(encoding="utf-8-sig", newline="")), 2):
    seen[row["word"]] += 1
    try:
        meaning = ast.literal_eval(row["meaning"])
        counts.update(meaning.keys())
        if not meaning or not any(meaning.values()):
            errors.append([i, "empty"])
        if row["word"] in {"อนุรักษ์", "ประสิทธิภาพ", "ประสิทธิผล", "รักษา", "สงวน", "บริบท", "ขัน", "ความสุข"}:
            selected.append(row)
    except (ValueError, SyntaxError, AttributeError):
        errors.append([i, "malformed"])
print(
    json.dumps(
        {
            "rows": sum(seen.values()),
            "unique": len(seen),
            "pos": counts,
            "quality": errors[:15],
            "error_count": len(errors),
            "records": selected,
        },
        ensure_ascii=False,
        indent=2,
    )
)
