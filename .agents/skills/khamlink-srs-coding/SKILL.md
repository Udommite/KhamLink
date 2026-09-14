---
name: khamlink-srs-coding
description: Implement, test, review, or plan KhamLink code against khamlink_srs.md with requirement-level traceability and minimal context loading. Use for KhamLink development tasks; do not use to redefine business scope or approve unresolved SRS decisions.
metadata:
  short-description: Code KhamLink from selected SRS requirements
---

# KhamLink SRS Coding

Treat workspace-root `khamlink_srs.md` as the software contract. Keep reads and output narrow.

## Minimal-context workflow

1. Read applicable repository instructions and inspect only the files relevant to the request.
2. Identify the requested `REQ-###` IDs. If none are named, read only SRS §4 (Requirement Index) and select the smallest matching set; state the mapping briefly.
3. Load those requirements with:

```powershell
& .agents/skills/khamlink-srs-coding/scripts/get_srs_slice.ps1 -Ids REQ-001,REQ-008
```

Add `-IncludeStates` only when behavior depends on lifecycle/state. Do not read the entire SRS unless the task genuinely spans most modules.
4. Check referenced `Q-###` items. Do not turn an unresolved question or provisional threshold into an approved fact. Ask only if it materially blocks the requested implementation; otherwise keep the choice configurable and document the assumption.
5. Implement the smallest coherent change satisfying the selected `REQ` and `VAL` items. Preserve provenance, authoritative/AI separation, anonymous-core boundaries, and source-first degradation.
6. Add or update focused tests named/mapped to the applicable `VAL-###` scenarios. Run focused verification first; run broader relevant checks only when warranted.
7. Report only: implemented IDs, key files, checks run/results, and unresolved blockers. Do not restate the SRS.

## Contract rules

- Requirement scope and priorities come from the SRS. Do not implement P2 or adjacent features without request or necessary dependency.
- `khamlink_brd.md` is consulted only to resolve a suspected traceability defect; do not routinely load both documents.
- `ARCH-012` leaves technology choices open. Follow the existing repository stack; if none exists, request/record the smallest reversible solution choice rather than presenting it as an SRS mandate.
- Official definitions require eligible `SOURCE_DATA`; AI/user content must never enter the authoritative path. AI failure must preserve available dictionary lookup.
- Core MVP journeys are anonymous. Administrative/data mutations require server-side authentication and authorization.
- Preserve existing requirement IDs. If the requested behavior conflicts with the SRS, stop and identify the exact IDs instead of silently changing scope.

## Token discipline

- Prefer `rg`/targeted ranges and the slicer over broad file dumps.
- Keep one compact working summary of selected IDs; do not repeatedly quote requirement prose.
- Inspect interfaces/callers before implementations, then open only the necessary regions.
- Reuse existing patterns and focused tests. Avoid speculative scaffolding, duplicate docs, and unrelated refactors.
- Keep progress and final messages concise and evidence-based.

