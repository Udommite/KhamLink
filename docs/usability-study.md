# VAL-056 participant study protocol (proposed, not run)

Owner: Product Research + Linguistic lead; approve under Q-016 before recruiting. Freeze the application version, dataset/index IDs and this task set before a held-out study. Do not train participants or tune retrieval on their results before scoring that same study.

Proposed pilot: 10 first-time Thai-reading participants, including students, writers and general readers with a mix of mobile/desktop use. This sample is provisional, not representative by assertion; document recruitment, language proficiency, device/access needs, exclusions and consent. Recruit through the owner, never contact people automatically from this repository. Collect no raw personal context in the app.

Tasks, presented in Thai without showing target words:

1. Identify the primary action on the home page without instruction. Describe wanting to keep something in its original state without losing it; find an acceptable word and inspect its definition.
2. Find a word for something children play with; select a relevant sense and its source.
3. Compare `อนุรักษ์` / `สงวน`; explain one source-supported difference and inspect evidence, including the separate generated panel.
4. Submit `เราช่วยกันอนุรักษ์ภาษาไทย`; select a detected word. Then inspect `ขัน` and explain why multiple senses are shown.
5. Inspect a real explicit relationship through map and list (choose from the frozen corpus before study), then report a data problem and confirm receipt.

Before running: a linguistic reviewer independently writes acceptable target/sense sets for tasks 1–2, difference rubric for task 3, and expected evidence IDs. Do not infer linguistic correctness from an ID appearing in a response. Record the time limit (proposed 3 minutes per task), whether assistance occurred, and scoring rules before collecting outcomes.

Score first-time unaided success per participant and task; count uncompleted/assisted attempts as failures under the declared rubric. Report numerator/denominator, ≥80% word-finding threshold, task-specific rates, and Wilson 95% intervals. Ask a five-point satisfaction question after the tasks (1 very dissatisfied to 5 very satisfied); report mean, distribution and uncertainty, with required average ≥4.0. Record whether the main search was found without training and whether normal flow demanded AI terminology. Do not substitute a scripted browser test or agent opinion for these measures.

Store de-identified research records outside the application under the approved research retention policy. Publish only aggregate findings and reproducible scoring in a release report, with Q-016 approval, application/corpus/index versions, sample limitations, failures and resulting fixes. Any rerun after fixes uses a new frozen version and discloses repeated participants.

Separate VAL-055 manual smoke: a tester using an approved screen reader reads Thai labels, navigates search/results/Card/senses/comparison/context/map-list/source dialog/feedback, verifies announcements, focus return, meaningful order and no keyboard trap. Record actual device, OS, browser, screen-reader/version and findings; an axe scan is not a substitute.
