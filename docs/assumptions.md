# Reversible assumptions and release gates

These are implementation choices under the user's MVP instruction, **not resolutions or approvals of the SRS questions**. No REQ, VAL, ARCH, DOM, DEC or Q identifier is changed. REQ-058 remains P2; REQ-038 is included only because the Word Map requires the related-words API. No P1 deferral has been approved.

| Q ID | Local choice / evidence | Required owner decision |
|---|---|---|
| Q-001 | Scope follows existing SRS; complete P0/P1 engineering target | Product baseline/release scope ratification |
| Q-002 | No approver identity invented | Name product, linguistic, engineering and security/privacy approvers |
| Q-003 | User selected `thai_dict@1.0`; artifact-specific CC BY-SA 4.0 attribution, nonofficial labels | Production processing/distribution/API approval; no assumed Royal Society source |
| Q-004 | CSV meaning dictionaries, staged validation, explicit valid-subset approval and separate publish permission | Import approver and quality acceptance policy; review 10 omitted optional POS fields in real snapshot |
| Q-005 | Local LSA / extractive adapters; no external model traffic by default | Approved Thai neural/model provider, quality/cost/residency/terms if enabled |
| Q-006 | Trim-only versioned normalization; source POS allowlist; leftmost-longest dictionary-span context segmentation; six relation types | Linguistic validation of segmentation, POS/register vocabulary and sense identity migration |
| Q-007 | Environment-configured bounds and Thai error text | Product/linguistic approval of limits and wording |
| Q-008 | No AI-created usage examples; source/curated examples only when present and provenanced | Whether reviewed AI examples may be enabled later |
| Q-009 | Anonymous, no cookies/raw text/IP/UA persistence; analytics off; feedback reason enums; provisional seven-day retention | Privacy notice, lawful basis, processors, moderation, deletion and audit-log retention policy |
| Q-010 | Anonymous first-party APIs and scoped admin APIs, single-worker cost buckets | Deployment audience and per-route abuse policy; external developer program is P2 |
| Q-011 | Strict source-clause grounding and reversible scoring thresholds; versioned development benchmark | Held-out linguistic evaluation, confidence/contradiction policy, independent comparison accuracy |
| Q-012 | Local loopback, expiring digest-based RBAC, production TLS/PostgreSQL/policy gate | Identity provider/MFA, privileged approvers, secret storage, hosting, incident owner and monitoring delivery |
| Q-013 | Provisional p95 targets evaluated locally with 500 warm requests / operation | Ratified workload, hardware/network/concurrency and SLA thresholds |
| Q-014 | Chromium desktop 1280×720 and emulated mobile 360×800 | Approved physical-device / browser / OS matrix; emulation is not a real mobile browser test |
| Q-015 | Automated axe WCAG 2.2 AA tags plus keyboard automation | Accessibility target/exceptions, manual screen-reader smoke and sign-off |
| Q-016 | Predeclared study protocol supplied; no participant results invented | Representative participant recruitment, approved tasks/sample and actual ≥80% / ≥4/5 evidence |
| Q-017 | Actual 19,480-word / 33,515-sense snapshot indexed, immutable version switching | Pilot/production volume, concurrency, resource ceilings and scale acceptance |

## Dataset and model limitations

`ประสิทธิภาพ`, `ประสิทธิผล`, and `ความสุข` are absent from the selected release. They remain real-data coverage gaps, not passing demo cases. The user explicitly allowed demo queries when records are present. API/UI mechanics are tested with isolated, explicitly synthetic fixtures; these are never loaded by the application bootstrap. Adding another dataset requires a directly relevant requirement, its own license/version/source manifest and review. Seeded or model-created definitions are not a substitute.

The corpus has no per-entry revision identifiers. Frozen text is evidenced by the artifact checksum and source version; current Wiktionary article/history links provide attribution but cannot prove the historical text. Generated index edges are excluded from public Word Map relationships. Sparse real Word Maps are expected, not filled with invented relations.

The local retrieval/explanation adapters are functional offline baselines, not a claim of reproducing the paper's neural/LLM quality. Five development semantic queries hitting top ten is not broad search-quality acceptance. A model change requires identity/license capture, rebuild, benchmark comparison and approval before activation.

## What cannot be signed off by automated engineering

VAL-056 requires real representative people and measured satisfaction. VAL-055 includes manual assistive-technology use. VAL-054 calls for approved real browsers/devices. VAL-057 needs an approved scale. Production legal/organizational decisions cannot be inferred from a local working application. These remain explicit gates; they are not approved P1 deferrals and do not imply unfinished engineering should stop while safe implementation remains.
