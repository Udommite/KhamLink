# Software Requirements Specification: KhamLink UI/UX Redesign — Round 2

*Second addendum to [`khamlink_srs.md`](khamlink_srs.md) and [`khamlink_brd.md`](khamlink_brd.md), and successor to [`khamlink_srs_redesign.md`](khamlink_srs_redesign.md) — graph legibility, spatial identity, comparison, and retrieval responsiveness.*

## Navigation

1. [Document Control](#1-document-control)
2. [Purpose and Scope](#2-purpose-and-scope)
3. [Current-State Baseline](#3-current-state-baseline)
4. [Requirement Index](#4-requirement-index)
5. [Functional Requirements](#5-functional-requirements)
6. [Non-Functional Requirements](#6-non-functional-requirements)
7. [Technology Selection](#7-technology-selection)
8. [Data and API Impact](#8-data-and-api-impact)
9. [Acceptance Criteria and Validation Plan](#9-acceptance-criteria-and-validation-plan)
10. [Traceability Matrix](#10-traceability-matrix)
11. [Supersession Register](#11-supersession-register)
12. [Risks and Open Questions](#12-risks-and-open-questions)
13. [Suggested Rollout Phasing](#13-suggested-rollout-phasing)

---

## 1. Document Control

### 1.1 Metadata

| Field | Value |
|---|---|
| Document | KhamLink UI/UX Redesign SRS — Round 2 |
| Baseline documents | `khamlink_srs.md`, `khamlink_brd.md`, `khamlink_srs_redesign.md` |
| Baseline code | `real-pipeline` @ `fb5513e` + the uncommitted round-1 completion recorded in [`khamlink_srs_redesign.md` §13](khamlink_srs_redesign.md) |
| Status | Draft — for engineering review |
| Author input | Product owner, 13-point review of the round-1 build (verbatim source, 2026-09-15) |
| Scope class | Front-end, **plus** one retrieval change ([REQ-UX-034](#req-ux-034)) and one latency change ([REQ-UX-030](#req-ux-030)) — see [§8](#8-data-and-api-impact) |

### 1.2 Why a second document rather than an edit

Round 1 was specified against a build that read as generic. It succeeded at that: the tokens, the permanent panel, the force layout, the editor and the steering slider all shipped and are verified in that document's §13. This round is different in kind — it is a **critique of a working product by someone using it**, and several points directly contradict decisions round 1 recorded as resolved. Editing those decisions in place would erase the reasoning that produced them and make the two rounds indistinguishable in the history.

Contradictions are therefore handled explicitly in the [Supersession Register](#11-supersession-register) (§11). **Where this document and `khamlink_srs_redesign.md` disagree, this document wins**, but only for the requirements §11 names.

### 1.3 Identifier conventions

- `REQ-UX-022` … `REQ-UX-034` — one per point in the 13-point review, continuing the round-1 numbering rather than opening a second namespace, so a single traceability chain covers both rounds.
- Priority: **P0** blocks release of this round; **P1** expected in the same release; **P2** stretch.
- `path:line` references are pointers against the state read while drafting, not contracts.

### 1.4 The one that matters most

Point 7 is marked *สำคัญ* by the product owner and is the only **P0-critical** item here. [§3.2](#32-why-the-graph-reads-as-a-tangle-the-diagnosis-behind-req-ux-028) diagnoses it before specifying it, because the fix follows from the cause and the cause is not where it appears to be.

---

## 2. Purpose and Scope

Round 1 made KhamLink look designed. This round is about making it **legible, spatial and responsive**: the graph must explain the relationships it draws, the product must have one search surface rather than two, comparison must actually compare, and the opening must earn the attention it asks for.

**In scope:** the graph's layout semantics, interaction model and backdrop; the opening sequence; the search/compare surface; suggestion and result presentation; breadcrumb density; writing-page reduction; meaning-search responsiveness; and the steering slider's range and diversity.

**Out of scope:** dictionary content, the review/suggestion pipeline's substance, authentication, sync, and any change to source attribution or provenance labelling. The blue/amber/green token system and the offline fallback posture are preserved exactly as in round 1.

---

## 3. Current-State Baseline

Measured against the running build, not assumed.

### 3.1 General

| Aspect | Current state |
|---|---|
| Graph layout | `graph-physics.ts` — springs, inverse-square charge, rectangular collision, 6-pass positional projection. `GRAPH_CAP = 16`, adaptive downward by viewport area. Idle drift ±2px, centre exempt. |
| Frame rate | 121–144 fps headless at the 16-node cap, 1280×800 (`redesign.spec.ts` prints it each run). **There is substantial headroom for richer visuals.** |
| Graph canvas | `.discover-stage` is `position:fixed; inset:0` — full viewport — but `.graph-viewport` inside it is inset by `top: header+64px`, `right: --panel-width + 16px`, `bottom: 252px`. **The stage is full-bleed; the drawable area is not.** |
| Graph backdrop | `background:none`. The `.language-lab` mesh gradient shows through. No grid, no ambient motion, no depth cue. |
| Node interaction | Click to explore. Whole-camera pan/zoom via pointer drag on `.graph-viewport`. **Individual nodes cannot be dragged.** |
| Breadcrumb | `.graph-path` — `gap: var(--space-2)`, buttons at `padding: var(--space-2)`, `min-height: 32px`, separator `" / "` rendered inside each button. |
| Search prompt | `.search-prompt` label renders `เริ่มจากคำหนึ่งคำ หรือความหมายที่คุณนึกถึง` above the input (`Discover.tsx`, `redesign.css:94`). |
| Brand mark | `.lab-brand small` renders `คำเชื่อมความคิด` under "KhamLink" (`main.tsx`). The real slogan `ผู้ช่วยด้านภาษาไทยที่ช่วยให้ทุกความคิดเจอคำที่ใช่` appears **only** in the intro, per round 1's [REQ-UX-003](khamlink_srs_redesign.md). |
| Compare mode | `ComparisonWorkspace` renders `.comparison-column` per word, forced to **one column** by `redesign.css` (`grid-template-columns:1fr!important`) because it sits in the ⅓ panel. Each column is a Word Card. **Words are stacked, never aligned field-to-field.** Compare has its own inputs; the bottom dock's search box is hidden in compare mode. |
| Result chips | `.result-index` is `position:absolute; left:10px; top:28px` — geometry tuned for the **old** two-column 22px-padded list. `redesign.css` re-declared `.result-words>button` as a short flex chip, so the absolutely-positioned number now lands outside its chip. **This is the misplaced number in the screenshot.** |
| Result panel | `.search-results` is `position:absolute; bottom:calc(100% + 8px)` — it expands **upward over the graph**, covering the area the user is reading. |
| Writing page | Tone `<select>`, "Review writing ↗" button, and `.sheet:focus-within{box-shadow:-3px 0 0 -1px var(--lab-blue)}` (the left blue bar) are all present. |
| Steering | `centre + weight·steer`, re-normalised, weight clamped to `[0,1]`. At weight 1 the target is the **bisector** of centre and steer — the furthest point that still describes the centre. |
| Intro | ~1.4s of animation inside a 1.8s window: viewport scrim, centre bloom, per-edge beam, staggered node resolve. Once per session. |

### 3.2 Why the graph reads as a tangle (the diagnosis behind REQ-UX-028)

This is the round's most important finding, and the cause is in the **data layer**, not the renderer.

`expandNetwork` (`discovery-data.ts`) builds every link as `{ source: word.word_id, target: node.id }` — always from the word being opened, to each of its neighbours. One call therefore produces a **pure star**. Exploration calls it with `append = true`, which *merges into the previous network*, so after visiting three words the canvas holds **three overlapping stars sharing one force simulation**.

Three consequences, all visible in the screenshot the product owner supplied:

1. **Every node looks equally related to everything.** A node's parent is encoded only in an edge, and edges are near-invisible hairlines; nothing in a node's own appearance says which word it came from.
2. **The force simulation actively destroys the grouping.** Charge repulsion is global and uniform, so it pushes a word *away* from its own siblings exactly as hard as from unrelated nodes. Whatever cluster structure exists in the data is flattened by the layout.
3. **Relation kind is carried only by a dot glyph**, at 8px, in a palette where `semantic` (amber diamond) dominates because most corpus entries declare no cross-references — round 1's own baseline notes 5,367 declared edges across 44,287 entries.

So the tangle is not "the physics needs tuning". **The graph is drawing a multi-rooted forest with a layout and a visual language that can only express a single star.** [REQ-UX-028](#req-ux-028) addresses this at the level of the data model, the layout, and the encoding together; tuning any one alone will not fix it.

### 3.3 Meaning-search latency, measured

Point 9 reports meaning search as slow or answerless. Measured against a warm local server on the Royal Society corpus (65,569 senses):

| Query | Server time | Result quality |
|---|---|---|
| `คำที่หมายถึงสัตว์สองขา` | 1.68 s | ทวิบท, ทวิบาท, สัตว์สองเท้า — correct |
| `คำที่หมายถึงสัตว์ที่บินได้` | 1.97 s | บิน, สัตว์ปีก, ไก่, เหิน — correct |
| `คำที่แปลว่าความรู้สึกเศร้า` | 1.42 s | เศร้า, เศร้าใจ, สลดใจ — correct |
| `คำที่หมายถึงบ้านหลังใหญ่` | 1.51 s | ใหญ่, **คฤหาสน์**, ภวนะ, บ้าน — correct |
| `ราชา` (exact) | 0.10 s | — |

**The retrieval is neither broken nor badly wrong.** `torch`, `transformers`, `sentence_transformers` and `pythainlp` are all installed and the neural path runs. The gap between 1.5 s of real work and the product owner's experience of "a long time, or no answer at all" is made of four things:

1. **A cold model.** `encoder` and `reranker` are `@property`-lazy — the first meaning query after a server start pays the BGE-M3 and cross-encoder load. No warm-up runs at startup.
2. **A 450 ms client debounce** before the suggestion request even leaves (`DiscoverSearch`).
3. **Three sequential round trips** before the graph changes: `POST /search` → `GET /words/{id}` → `GET /words/{id}/related`. The user waits for all three.
4. **No progress signal that distinguishes "thinking" from "stuck".** `busy` only swaps the submit button's label. A 2-second wait with no staged feedback reads as a hang, and a degraded result reads as "no answer".

[REQ-UX-030](#req-ux-030) is therefore specified as a **perceived-latency and honesty** requirement with a bounded real-latency component — not as "make the model faster", which would mean changing the retrieval quality the corpus work exists to provide.

---

## 4. Requirement Index

| ID | Title | Module | Priority |
|---|---|---|---|
| [REQ-UX-022](#req-ux-022) | Remove the search prompt label | MOD-UX-13 | P1 |
| [REQ-UX-023](#req-ux-023) | Real slogan in the brand lockup | MOD-UX-13 | P1 |
| [REQ-UX-024](#req-ux-024) | One search surface; comparison that actually compares | MOD-UX-14 | P0 |
| [REQ-UX-025](#req-ux-025) | A longer, richer opening sequence | MOD-UX-15 | P1 |
| [REQ-UX-026](#req-ux-026) | Genuinely full-screen graph with overlaid chrome and glass | MOD-UX-16 | P0 |
| [REQ-UX-027](#req-ux-027) | A living graph backdrop | MOD-UX-16 | P1 |
| [REQ-UX-028](#req-ux-028) | **Legible relationship structure** | MOD-UX-17 | **P0 — critical** |
| [REQ-UX-029](#req-ux-029) | Draggable, dimensional, physical graph | MOD-UX-17 | P1 |
| [REQ-UX-030](#req-ux-030) | Responsive and honest meaning search | MOD-UX-18 | P0 |
| [REQ-UX-031](#req-ux-031) | Reduce the writing page | MOD-UX-19 | P1 |
| [REQ-UX-032](#req-ux-032) | Compact breadcrumb | MOD-UX-20 | P2 |
| [REQ-UX-033](#req-ux-033) | Suggestion and result presentation | MOD-UX-20 | P1 |
| [REQ-UX-034](#req-ux-034) | Steering reaches the destination, with variety | MOD-UX-21 | P1 |

---

## 5. Functional Requirements

### 5.1 MOD-UX-13 — Copy and Identity

<a id="req-ux-022"></a>
#### REQ-UX-022: Remove the search prompt label

- **Source:** Point 1.
- **Priority:** P1.
- **Current state:** `.search-prompt` renders `เริ่มจากคำหนึ่งคำ หรือความหมายที่คุณนึกถึง` above the input; the input's own placeholder already says `พิมพ์คำ หรือเล่าความหมายที่กำลังหา…`, and `#search-help` below it says `ค้นจากคำ · ความหมาย · บริบท`. **Three pieces of copy explain one text field.**
- **Required behavior:** The visible label shall be removed. Because it is the input's `<label htmlFor>`, it shall be replaced by an accessible name carried some other way — `aria-label` on the input, or the label retained and visually hidden with the existing `.sr-only` utility. The placeholder is **not** an accessible name and shall not be relied on as one.
- **Acceptance criteria:** The string does not appear in rendered output; the search input still exposes a non-empty accessible name; axe reports no new violation.

<a id="req-ux-023"></a>
#### REQ-UX-023: Real slogan in the brand lockup

- **Source:** Point 2.
- **Priority:** P1.
- **Current state:** The brand shows `คำเชื่อมความคิด` — a descriptor, not the slogan. The actual slogan `ผู้ช่วยด้านภาษาไทยที่ช่วยให้ทุกความคิดเจอคำที่ใช่` appears only during the intro.
- **Required behavior:** The brand lockup shall carry the real slogan. Because the slogan is long and the header is a fixed 80px band, it shall be set at a size and truncation behaviour that does not crowd the mark or the nav — a shortened lockup form with the full string available to assistive technology (`title`/`aria-label`) is acceptable, and it may be hidden below the existing 640px breakpoint as `.lab-brand small` already is.
- **⚠ This supersedes round-1 [REQ-UX-003](khamlink_srs_redesign.md)**, whose acceptance criterion was that the slogan appear *exactly once* and only during the intro. See [§11](#11-supersession-register). The intro slogan ([REQ-UX-025](#req-ux-025)) and the brand slogan may now both exist; if the duplication reads badly once built, the **intro** instance is the one to drop, since the brand is persistent and the intro is once-per-session.
- **Acceptance criteria:** The slogan is present in the persistent header; `คำเชื่อมความคิด` no longer appears as brand copy; the header does not wrap, overflow or collide with the nav at 1280px, 940px or 640px.

### 5.2 MOD-UX-14 — Search and Comparison

<a id="req-ux-024"></a>
#### REQ-UX-024: One search surface; comparison that actually compares

- **Source:** Point 3.
- **Priority:** P0.
- **Current state:** Two separate input surfaces. In search mode the bottom dock holds the query box; in compare mode that box is hidden (`hidden={mode !== 'search'}`) and `ComparisonWorkspace` renders its own `.comparison-input` fields inside the right panel. The comparison result is a vertical stack of Word Cards in a single column — **the same card the search mode shows, repeated**, with no alignment between the two words' fields.
- **Required behavior, two parts:**

  **(a) One input.** The bottom dock's search box shall be the *only* place a word is entered, in both modes. Selecting **Compare** shall not swap the input for a different one; it shall change what happens to what you type — each submitted word is added to a comparison set, shown as a removable chip row on the dock itself. The right panel shall hold **no text inputs** in either mode.

  **(b) Comparison shall be a comparison.** The panel shall align the two (or more) words **field by field**, so the reader's eye travels across a row and sees a difference. At minimum: headword, part of speech, register, primary sense, and related-word set shall each occupy one aligned row across all compared words, with cells that differ visually distinguished from cells that agree. Stacking complete Word Cards is explicitly **not** sufficient and is the thing being replaced.

- **Layout note:** an aligned comparison of two words does not fit a ⅓-width column at desktop widths. When compare mode is active the panel shall be permitted to widen (or the comparison shall present as an overlay sheet across the graph), overriding the ⅓ geometry from round-1 [REQ-UX-010](khamlink_srs_redesign.md) for that mode only. This is a deliberate, scoped exception — the single-word panel keeps its ⅓ width.
- **Acceptance criteria:** No `<input>` exists in the right panel in either mode; typing a word in compare mode adds it to the comparison set without the field moving or changing identity; for two compared words, each of the named fields is rendered in one row with both words' values horizontally adjacent and vertically aligned; a reader can name one difference between two words from a screenshot alone, without scrolling.

### 5.3 MOD-UX-15 — Opening

<a id="req-ux-025"></a>
#### REQ-UX-025: A longer, richer opening sequence

- **Source:** Point 4.
- **Priority:** P1.
- **Current state:** ~1.4s: scrim, centre bloom, per-edge beam with a 35ms stagger, staggered node resolve. Correct, but brief and structurally simple — one gesture, played once.
- **⚠ This supersedes round-1 [REQ-UX-004](khamlink_srs_redesign.md)'s pacing criterion**, which required "under ~2s" and explicitly warned against a cinematic that overstays. The product owner has now seen that version and judged it too short. See [§11](#11-supersession-register).
- **Required behavior:** The sequence shall be extended to a target of **3.5–5s** and gain compositional structure — distinct movements rather than one simultaneous reveal. The reference shape:
  1. a held dark stage with the slogan resolving, before anything else moves;
  2. the centre node arriving with weight (scale, glow bloom, a settling overshoot rather than a linear fade);
  3. beams propagating outward in **depth order**, nearer neighbours first, with visible travel rather than a dash sweep that completes instantly at short edge lengths;
  4. neighbours materialising where beams land, each with its own micro-entrance;
  5. the backdrop ([REQ-UX-027](#req-ux-027)) resolving in — grid and ambient detail arriving last, as the stage lifts;
  6. a settle in which the simulation visibly relaxes into its resting layout.
- **Constraints that do not move.** Longer does not mean blocking: the graph shall accept input from the moment nodes exist, and every skip path from round 1 is retained — one play per session via `sessionStorage`, and `prefers-reduced-motion: reduce` collapses the whole thing to the static end state. A **skip affordance** shall be added, since a 5s sequence a returning user cannot dismiss is worse than a 1.4s one.
- **Acceptance criteria:** Total duration between 3.5s and 5s; at least four distinguishable movements; interaction accepted before the sequence completes; a visible, keyboard-reachable skip control; reduced-motion shows the end state with no motion; still exactly once per session.

### 5.4 MOD-UX-16 — Canvas

<a id="req-ux-026"></a>
#### REQ-UX-026: Genuinely full-screen graph with overlaid chrome and glass

- **Source:** Point 5.
- **Priority:** P0.
- **Current state:** The *stage* is full-viewport, but the *drawable area* is inset on all four sides by the header, the panel width, and 252px of bottom dock reserve. Nodes are laid out only within that rectangle, which is why the graph reads as a boxed widget inside a full-screen page. Round 1's [REQ-UX-008](khamlink_srs_redesign.md) asked for full-bleed and got it at the wrong layer.
- **Required behavior:** The graph's **simulation and drawing area shall be the full viewport**. Header, breadcrumb, dictionary panel, search dock and footer become true overlays: the graph draws beneath them, and nodes may occupy the space behind them. To keep the content readable, layout shall use a **soft margin** rather than a hard boundary — the force simulation is biased away from occupied regions so nodes tend not to settle under the panel, but the canvas itself is not clipped to avoid them.
- **Glassmorphism.** Round 1 deferred this under [Q-UX-003](khamlink_srs_redesign.md) ("clarity first"), and the current surfaces are near-opaque (`--paper` at 94%). The product owner now asks for it to be tested. Overlay surfaces shall be rebuilt with genuine translucency plus `backdrop-filter`, **subject to the contrast rule in [NFR-UX-008](#nfr-ux-008)** — which is now harder to satisfy than in round 1, because the backdrop is a moving graph with an animated grid rather than a flat ground. Where a surface cannot hold AA contrast over its worst-case backdrop, it keeps a more opaque treatment; the requirement is that glass is *tried and measured*, not that it ships everywhere.
- **Acceptance criteria:** Node positions are observed outside the previous inset rectangle, including behind the panel's horizontal band; no node is clipped at a viewport edge; the centre node still settles in visible space per round-1 [REQ-UX-008](khamlink_srs_redesign.md); every overlay surface passes [NFR-UX-008](#nfr-ux-008) against the graph's densest state; a measured contrast report exists for each glass surface.

<a id="req-ux-027"></a>
#### REQ-UX-027: A living graph backdrop

- **Source:** Point 6.
- **Priority:** P1.
- **Current state:** `background:none` on the graph viewport; a static two-stop mesh gradient on `.language-lab` behind it. Nothing indicates depth, scale or motion.
- **Required behavior:** The graph shall sit on a backdrop with structure and slow life:
  - a **grid or field** giving the canvas a sense of extent and making pan/zoom legible — it shall translate and scale **with the camera**, since a grid that stays fixed while nodes move destroys the sense of space rather than creating it;
  - **ambient detail** — slow drifting motes, faint distant points, or a parallax layer — moving at a different rate from the nodes so the canvas reads as having depth;
  - both shall sit clearly **behind** the nodes in contrast and weight, and shall never compete with node labels for attention.
- **Acceptance criteria:** Grid transforms consistently with camera pan and zoom; ambient layer moves at a visibly different rate from the node layer; node labels retain their contrast ratio over the busiest backdrop region; the whole backdrop is static under `prefers-reduced-motion`; frame rate stays within [NFR-UX-007](#nfr-ux-007).

### 5.5 MOD-UX-17 — Graph Legibility and Physicality

<a id="req-ux-028"></a>
#### REQ-UX-028: Legible relationship structure

- **Source:** Point 7 — marked *สำคัญ*. **The critical requirement of this round.**
- **Priority:** P0.
- **Current state:** See the diagnosis in [§3.2](#32-why-the-graph-reads-as-a-tangle-the-diagnosis-behind-req-ux-028). The graph accumulates overlapping stars, the layout flattens their grouping, and a node's appearance says nothing about where it came from.
- **Required behavior.** The user shall be able to answer, **without clicking anything**: *which word is this node related to, and how?* Three changes, and all three are required — each alone is insufficient:

  **(a) Preserve provenance in the data model.** Every node shall carry the word it was revealed from and the relation kind that produced it. `expandNetwork` currently discards this: a node merged in from a second expansion is indistinguishable from one belonging to the original centre. This is a change to `Network`/`GraphNode`, not a styling change.

  **(b) Lay out by group, not by uniform repulsion.** Nodes belonging to the same parent shall be spatially cohesive — a clustering force pulling siblings toward a shared local centroid, with repulsion applying more strongly *between* groups than within them. The current single global charge does the opposite. The active word's own neighbourhood shall be the visually dominant group.

  **(c) Encode group and relation visually.** A node shall show, in its own appearance, which group it belongs to and what kind of relation produced it — through a consistent, accessible channel. **Colour alone is insufficient** ([NFR-UX-009](#nfr-ux-009)); pair it with a second channel such as edge style, node shape, or a grouping halo. Edges shall be weighted so that a path edge, a dictionary relation and an AI-derived neighbour are distinguishable at a glance rather than by inspecting a legend.

- **Behaviour on opening a new word.** When a previously-visible node becomes the new centre, the transition shall make the re-rooting **visible**: the new centre's group takes visual and spatial primacy, the previous centre demotes to an ordinary member of the path, and existing nodes move to their new group positions rather than being destroyed and rebuilt. The user must be able to see that the same words are being re-arranged, not replaced.
- **A cap is not a fix.** Reducing `GRAPH_CAP` would reduce the symptom by drawing less. That is explicitly rejected: it trades away the exploration the product exists for.
- **Acceptance criteria:** Given a graph built by exploring three words in sequence, a test can assert that every node reports a parent and a relation kind; nodes sharing a parent are measurably closer to each other than to nodes of other parents (mean intra-group distance < mean inter-group distance by a stated margin); relation kind is distinguishable by at least two visual channels; opening a new word animates existing nodes to new positions without unmounting them; and — the human bar — **a reader shown a screenshot of a three-word exploration can correctly state which words are related to which**, tested with someone who has not seen the build.

<a id="req-ux-029"></a>
#### REQ-UX-029: Draggable, dimensional, physical graph

- **Source:** Point 8.
- **Priority:** P1.
- **Current state:** The camera pans and zooms; individual nodes are inert. A node has no response to the pointer beyond hover and click. The simulation runs 180 ticks and then only paints idle drift — it does not re-converge in response to anything the user does.
- **Required behavior:**
  - **Nodes shall be draggable.** Dragging a node pins it under the pointer and the simulation **re-converges live** around it, so the graph visibly responds as a connected structure rather than a picture. Release either restores it to simulation control or leaves it pinned — product's choice, but it shall be consistent and discoverable.
  - **The graph shall feel physical**: inertia on release, neighbours trailing a dragged node through their links, and a settle rather than a snap.
  - **Depth.** Nodes shall read as occupying space — scale, blur, opacity or shadow varying with distance from the focus — so the network has a foreground and a background rather than being uniformly flat.
  - Pointer drag on empty canvas continues to pan the camera; the two gestures shall not conflict.
- **Accessibility.** Dragging is a pointer affordance and shall not become the only way to do anything. Every node remains reachable and activatable by keyboard ([NFR-UX-009](#nfr-ux-009)), and no information is available only to users who can drag.
- **Acceptance criteria:** A node can be dragged with mouse and touch; during a drag its linked neighbours measurably change position; the simulation re-converges after release; frame rate during a drag at the node cap stays within [NFR-UX-007](#nfr-ux-007); depth cue is measurable as a rendered difference between a focused and a distant node; keyboard operation of the graph is unchanged.

### 5.6 MOD-UX-18 — Retrieval Responsiveness

<a id="req-ux-030"></a>
#### REQ-UX-030: Responsive and honest meaning search

- **Source:** Point 9.
- **Priority:** P0.
- **Current state:** Measured in [§3.3](#33-meaning-search-latency-measured) — 1.4–2.0s warm, correct results, but a cold model on first use, a 450ms debounce, three sequential round trips, and a `busy` flag that only changes a button's label.
- **Required behavior:**
  - **(a) Remove the cold-start cliff.** The encoder and reranker shall be warmed at service startup (or on first page load, off the user's critical path) so the first meaning query is not the one that pays for model loading.
  - **(b) Collapse the round trips.** The graph currently waits for `/search` → `/words/{id}` → `/related` in sequence. The first result's word payload and its neighbourhood shall be obtainable without three serial waits — either by the client issuing them concurrently once the first candidate id is known, or by `/search` optionally returning the top candidate's word payload. **The card shall render as soon as the word is known, without waiting for the neighbourhood** — the existing `reveal()` already commits the card before the map for exactly this reason, and that ordering must survive.
  - **(c) Tell the truth while waiting.** A meaning query shall show staged progress that distinguishes *understanding the description* from *searching* from *building the graph*, so a 2-second wait reads as work rather than a hang. Where retrieval degrades (expansion failed, reranker unavailable, no candidate cleared the floor), the UI shall say which, in place of a silent empty state. `SearchResults.degraded` and `degraded_reason` already carry this and are currently surfaced as one generic line.
  - **(d) Never present "slow" as "nothing".** An empty result shall be distinguishable from an in-flight one at all times.
- **Explicit non-goal:** reducing retrieval *quality* to gain speed. The cross-encoder rerank and query expansion are what make `คำที่หมายถึงบ้านหลังใหญ่` return `คฤหาสน์`; they are not to be disabled for latency.
- **Acceptance criteria:** First meaning query after a cold service start completes within 150% of the warm time; total wall-clock from submit to a rendered card is measured and recorded before and after; the three requests are no longer strictly serial; at least three distinct progress states are observable during a meaning query; every `degraded_reason` the backend can emit has a distinct user-facing message; a query returning zero candidates is visually distinct from one still running.

### 5.7 MOD-UX-19 — Writing Page

<a id="req-ux-031"></a>
#### REQ-UX-031: Reduce the writing page

- **Source:** Point 10.
- **Priority:** P1.
- **Required behavior:** Three removals:
  1. the **Tone** `<select>` and its label;
  2. the **"Review writing ↗"** button;
  3. the **left blue focus bar** — `.write-page .sheet:focus-within{box-shadow:-3px 0 0 -1px var(--lab-blue)}`.
- **Consequences that must be handled, not left dangling.** Removing the Tone control orphans `doc.formality`, and removing the review button orphans the entire review pipeline in the UI — `analyze()`, `review` state, the suggestion underlines in the mirror, `.write-note` rendering, and `Doc.formality` in storage. The implementation shall decide explicitly between:
  - **(i) remove the control, keep the capability** — `formality` defaults silently, review triggers automatically or from elsewhere; or
  - **(ii) remove the feature** — delete the review UI path and its dead state with it.

  Leaving the buttons deleted while their machinery remains wired is the outcome to avoid. **This SRS does not choose; it requires that the choice be made and recorded**, because it determines whether the review pipeline still has a user-facing entry point at all. `Doc.formality` must in either case keep loading from existing saved documents without error.
- **Acceptance criteria:** None of the three elements renders; focusing the writing surface produces no left bar; saved documents created before the change still open; no unreachable state or handler is left behind; the chosen option is recorded in the implementation notes.

### 5.8 MOD-UX-20 — Density and Presentation

<a id="req-ux-032"></a>
#### REQ-UX-032: Compact breadcrumb

- **Source:** Point 11.
- **Priority:** P2.
- **Current state:** `.graph-path` — `gap: var(--space-2)` between buttons, each with `padding: var(--space-2)` and `min-height: 32px`, separator rendered inside the button. The trail occupies far more width than its text.
- **Required behavior:** The trail shall hug its words: reduced padding and gap so entries sit close to one another, with the separator visually subordinate to the words. It shall remain a horizontal chain reading left to right, oldest first.
- **Constraint:** touch-target minimums still apply. Where a compact hit area would fall below the accessible minimum, the *visual* density is achieved with the touch target preserved via padding that does not contribute to visual weight.
- **Acceptance criteria:** Total rendered width of a four-entry trail is measurably reduced against the current build; each entry remains keyboard-focusable with a visible focus ring; interactive targets meet the project's existing minimum.

<a id="req-ux-033"></a>
#### REQ-UX-033: Suggestion and result presentation

- **Source:** Point 12.
- **Priority:** P1.
- **Current state:** `.search-results` expands **upward over the graph** from the dock, covering what the user is looking at. `.result-index` is absolutely positioned at `left:10px; top:28px` — geometry inherited from the superseded two-column list — so inside the redesigned short flex chip the number lands outside its own chip. This is the misplacement visible in the product owner's screenshot.
- **Required behavior:**
  - **Placement.** Suggestions and results shall occupy a position that does not obscure the graph's active region. Options include the dictionary panel, a dedicated band, or expansion downward into dock space — the requirement is that **the graph's centre and its immediate neighbourhood remain visible while results are open**.
  - **Numbering.** The ordinal shall be laid out *in flow with* its chip rather than absolutely positioned against stale geometry, so it cannot separate from the word it numbers at any chip size or viewport.
  - **Design.** Result and suggestion entries shall be deliberately designed rather than inheriting a stripped-down list: a clear reading order between word, sense and match kind, and a visible distinction between an exact match, a near word and an AI-derived semantic match — a distinction the data already carries in `match_type` and which the current chip hides entirely (`.result-kind{display:none}`).
- **Acceptance criteria:** With results open, the centre node and its first-ring neighbours are unobscured; each ordinal's bounding box is contained within its chip's bounding box at 1280px, 940px and 360px; `match_type` is visually distinguishable across all three values; keyboard navigation of the suggestion list is unchanged.

### 5.9 MOD-UX-21 — Steering

<a id="req-ux-034"></a>
#### REQ-UX-034: Steering reaches the destination, with variety

- **Source:** Point 13.
- **Priority:** P1.
- **Current state:** `target = normalise(centre + weight·steer)`, `weight ∈ [0,1]`. **At weight 1 the target is the bisector** of centre and steer — the midpoint, not the destination. This is precisely the product owner's "ไปไม่สุด": the slider's maximum is, by construction, halfway. Round 1's §13.3 recorded this as intentional ("the furthest the result still describes ราชา"); the product owner has now stated the opposite intent.
- **⚠ This refines round-1 [REQ-UX-021](khamlink_srs_redesign.md)'s parameterisation.** The continuity property that round 1's review fought for — weight 0 reproducing the unsteered ranking exactly, with no aggregation change — **is not negotiable and must survive this change.** See [§11](#11-supersession-register).
- **Required behavior, two parts:**

  **(a) 100% shall mean the destination.** The weight shall be reparameterised so that `t = 0` is the centre word's own neighbourhood and `t = 1` is the **steering word's actual meaning** — i.e. at maximum, the results are the neighbours of the steering word itself. Spherical interpolation along the arc between the two unit vectors is the natural formulation: it is unit-norm at every `t`, reduces to each endpoint exactly, and moves at constant angular rate so the slider's travel corresponds to perceived travel — which additive blending does not, and which is the second half of why the control currently feels dead below 60%.

  **(b) Results shall be varied.** Raising the weight currently returns tightly clustered near-synonyms — many spellings of one idea rather than a range. Selection shall trade relevance against variety, so the returned set spans the region around the target instead of crowding its single nearest point. A relevance-minus-redundancy selection over the candidate pool is sufficient and is a re-ranking of candidates already retrieved, not a second retrieval.

- **Acceptance criteria:** At `t = 0` the neighbour list is byte-identical to an unsteered request (the round-1 property, re-asserted); at `t = 1` the list is the steering word's own neighbourhood; intermediate values move monotonically between the two with no threshold flip; for a fixed centre, steer and `t`, the returned set is measurably more diverse than the current build by a stated pairwise-similarity measure; the steering word itself is still excluded from results while steering is active; unknown and unusable steering words degrade exactly as they do now.

---

## 6. Non-Functional Requirements

<a id="nfr-ux-007"></a>
**NFR-UX-007 — Motion budget, restated for a heavier canvas.** This round adds an animated backdrop ([REQ-UX-027](#req-ux-027)), live drag re-convergence ([REQ-UX-029](#req-ux-029)) and a longer opening ([REQ-UX-025](#req-ux-025)). The current build measures 121–144 fps headless at the 16-node cap, so there is headroom — but it must be **spent deliberately and re-measured**, not assumed. Sustained frame rate shall not drop below 60 fps on mid-range hardware in the worst case (full node cap, backdrop active, node being dragged). The existing `redesign.spec.ts` frame-rate probe shall be extended to measure during a drag, not only at rest. Every new animation is covered by the app-wide `prefers-reduced-motion` rule.

<a id="nfr-ux-008"></a>
**NFR-UX-008 — Contrast on glass over a live backdrop.** Supersedes the conditions of round-1 NFR-UX-002 without relaxing its bar. Text on any overlay shall meet WCAG AA (4.5:1 body, 3:1 large) against its **worst-case backdrop** — now a moving graph over an animated grid, which is a harder target than round 1's near-flat ground. Contrast shall be measured against the densest realistic state, not a quiet one. A surface that cannot hold AA with blur shall use a more opaque treatment; shipping blur that fails contrast is not an acceptable outcome of "test glassmorphism".

<a id="nfr-ux-009"></a>
**NFR-UX-009 — Accessibility parity, with two new obligations.** No requirement here may reduce existing affordances. Two are specific to this round: (1) **information encoded by colour shall always have a second channel** — [REQ-UX-028](#req-ux-028)'s group and relation encoding is the main case, and colour-only grouping would make the graph's new structure invisible to colour-blind users, defeating the requirement's own purpose; (2) **drag is additive, never exclusive** — everything reachable by dragging ([REQ-UX-029](#req-ux-029)) remains reachable by keyboard.

<a id="nfr-ux-010"></a>
**NFR-UX-010 — Dependency budget.** The front end still ships zero UI/animation/graph dependencies. This round's heaviest temptations are a graph/physics library for [REQ-UX-028](#req-ux-028)/[REQ-UX-029](#req-ux-029) and a WebGL renderer for [REQ-UX-027](#req-ux-027). Neither is pre-approved. Any addition must be justified against the measured baseline and its bundle cost recorded — see [§7](#7-technology-selection).

<a id="nfr-ux-011"></a>
**NFR-UX-011 — Offline and local-first posture.** Unchanged and binding. No new hard runtime network dependency. Documents stay in the browser. [REQ-UX-030](#req-ux-030)'s warm-up must not introduce a network fetch at startup that the offline demo path cannot satisfy.

<a id="nfr-ux-012"></a>
**NFR-UX-012 — Responsive integrity.** The established breakpoints (1180 / 940 / 640) continue to be extended rather than replaced. Two of this round's requirements are specifically at risk on small screens and must be specified there too: the widened comparison panel ([REQ-UX-024](#req-ux-024)) and results placement ([REQ-UX-033](#req-ux-033)). The round-1 open item — the graph band collapsing below ~560px of viewport *height* — is inherited by this round and should be closed by [REQ-UX-026](#req-ux-026)'s full-screen layout rather than tracked separately.

---

## 7. Technology Selection

Ladder unchanged: native platform features, then the smallest single-purpose library, before anything heavier.

### 7.1 Grouped graph layout ([REQ-UX-028](#req-ux-028))

The existing hand-rolled simulation is ~60 lines and already does springs, charge and collision with positional projection. **Extending it is the recommendation**: grouped layout needs one additional force — attraction toward a per-group centroid — plus making charge group-aware. That is a small, well-understood change to code the team owns.

`d3-force` remains the fallback if hand-tuning the group forces proves unstable; it was declined in round 1 and the reasoning holds. **Do not reach for a general graph-drawing library** (cytoscape, vis-network, react-force-graph): they bring layout engines, renderers and interaction models that would replace the parts of this graph that already work and are already accessible.

### 7.2 Node dragging ([REQ-UX-029](#req-ux-029))

No dependency. Pointer events on the node element, a pinned flag on the particle, and the existing tick loop re-converging while pinned. The pan handler already distinguishes node from canvas targets (`closest('button')`), which is the conflict-avoidance this needs.

### 7.3 Backdrop ([REQ-UX-027](#req-ux-027))

**Recommendation: CSS and SVG first.** A repeating-linear-gradient or SVG `<pattern>` grid on the camera-transformed layer inherits pan/zoom for free, which is the requirement's hard part. Ambient motes are a small number of absolutely-positioned elements on a slow keyframe at a different parallax rate.

Escalate to `<canvas>` **only if measurement shows** the DOM approach missing [NFR-UX-007](#nfr-ux-007). WebGL/three.js is not justified: this is a 2D backdrop behind ~16 nodes, and the bundle and complexity cost would be the largest single addition in the project's history for a decorative layer.

### 7.4 Comparison layout ([REQ-UX-024](#req-ux-024))

No dependency. An aligned comparison is a CSS grid with one row per field and one column per word — `grid-template-columns: auto repeat(N, 1fr)` with the field label in the first column. The current forced single column (`grid-template-columns:1fr!important`) is the thing being removed.

### 7.5 Steering reparameterisation ([REQ-UX-034](#req-ux-034))

No dependency; NumPy is already in the retrieval path. Slerp between two unit vectors is a few lines, with a guard for near-parallel vectors where the angle underflows — fall back to linear blend there, since the two points are nearly identical anyway and the arc is meaningless. Diversity selection is a greedy relevance-minus-redundancy pass over the existing candidate pool.

### 7.6 Search warm-up and concurrency ([REQ-UX-030](#req-ux-030))

No dependency. Warm-up is an eager touch of the lazy `encoder`/`reranker` properties during service startup, off the request path. Request concurrency is a client-side change to the existing `reveal()`/`search()` flow; the card-before-map ordering already present must be preserved.

---

## 8. Data and API Impact

Most of this round is front-end. Three exceptions:

- **[REQ-UX-034](#req-ux-034) — steering reparameterisation.** Changes the meaning of the existing `steer_weight` parameter on `GET /api/words/{key}/related`: it becomes an interpolation position where `1` is the destination, rather than an additive coefficient where `1` is the midpoint. **This is a semantic change to a shipped parameter**, not an additive one. Since the only consumer is this application's own panel, the parameter shall keep its name and range and change meaning in step with the client. The response shape is unchanged. The unsteered path and all degradation states are unchanged.
- **[REQ-UX-030](#req-ux-030) — warm-up and possible payload merge.** Warm-up is a startup-lifecycle change with no contract impact. If option (b) is implemented server-side, `/api/search` would optionally embed the top candidate's word payload — an **additive** field, following the same discipline round 1 used for `steer_state`: present only when requested, so existing consumers are unaffected.
- **[REQ-UX-028](#req-ux-028) — provenance in the graph model.** Per §5.5(a), nodes must carry their source word and relation kind. This is satisfiable **entirely client-side** — `expandNetwork` already knows the word it is expanding from and the kind of each edge; it currently discards both. No endpoint change is required. The optional relation-strength enrichment noted in round 1 §8 remains open and would improve grouping quality, but is not a prerequisite.

---

## 9. Acceptance Criteria and Validation Plan

Extends the existing infrastructure (`vitest`, `playwright`, `@axe-core/playwright`, `pytest`, `ruff`) rather than adding a QA stack.

1. **Graph structure (REQ-UX-028)** — unit tests that every node carries parent and relation kind through multi-step expansion; a simulation test asserting mean intra-group distance is below mean inter-group distance by a stated margin at the node cap. This is the round's primary regression guard.
2. **Human legibility check (REQ-UX-028)** — the acceptance bar that cannot be automated: a person who has not seen the build is shown a three-word exploration and asked which words relate to which. Failure here fails the requirement regardless of the automated metrics, because the metrics are proxies for exactly this.
3. **Drag and motion (REQ-UX-029, NFR-UX-007)** — Playwright drag asserting neighbour displacement and post-release re-convergence; the existing frame-rate probe extended to sample *during* a drag with the backdrop active.
4. **Contrast on glass (NFR-UX-008)** — axe over every Discover and Write state, plus explicit measurement of each glass surface against the graph's densest region. A measured report is the deliverable, not a pass/fail flag.
5. **Comparison (REQ-UX-024)** — assert no input exists in the panel in either mode, and that each compared field renders in one row with values horizontally adjacent.
6. **Steering (REQ-UX-034)** — extend `tests/test_steered_neighbours.py`: `t=0` identical to unsteered (existing property, must not regress), `t=1` equals the steering word's own neighbourhood, monotonic movement between, and a pairwise-similarity diversity measure improving against the current build.
7. **Search latency (REQ-UX-030)** — record cold and warm timings before and after; assert staged progress states are observable; assert an empty result renders differently from an in-flight one.
8. **Reduced motion** — every new animation collapses to its end state, including the backdrop and the longer intro.
9. **Regression** — the round-1 suites stay green: 121 backend, 29 frontend unit, 6 redesign e2e. Several requirements here deliberately change behaviour those tests assert (intro duration, panel width in compare, steering at weight 1); **those assertions shall be updated with the requirement, never deleted to make a suite pass.**
10. **Known-stale suite** — `frontend/e2e/journeys.spec.ts` is failing 16/16 against UI removed at `74a5fc2`, independently of this round. It should be repaired before it can serve as a regression signal for any of this work.

---

## 10. Traceability Matrix

| Point | Summary | Requirement |
|---|---|---|
| 1 | Remove `เริ่มจากคำหนึ่งคำ…` | [REQ-UX-022](#req-ux-022) |
| 2 | Real slogan in place of `คำเชื่อมความคิด` | [REQ-UX-023](#req-ux-023) |
| 3 | Shared search box; real comparison | [REQ-UX-024](#req-ux-024) |
| 4 | Longer, more impressive intro | [REQ-UX-025](#req-ux-025) |
| 5 | Truly full-screen graph, overlays, glassmorphism | [REQ-UX-026](#req-ux-026) |
| 6 | Grid and floating detail in the backdrop | [REQ-UX-027](#req-ux-027) |
| 7 | **Orderly, legible relationships** *(สำคัญ)* | [REQ-UX-028](#req-ux-028) |
| 8 | Floating, draggable, dimensional graph | [REQ-UX-029](#req-ux-029) |
| 9 | Meaning search slow or answerless | [REQ-UX-030](#req-ux-030) |
| 10 | Remove Tone, Review writing, left blue bar | [REQ-UX-031](#req-ux-031) |
| 11 | Compact breadcrumb | [REQ-UX-032](#req-ux-032) |
| 12 | Better-placed, better-designed recommendations | [REQ-UX-033](#req-ux-033) |
| 13 | Slider reaches 100%; more varied results | [REQ-UX-034](#req-ux-034) |

---

## 11. Supersession Register

The decisions this round reverses, and why. Each was correct on the information available at the time; each is changed by the product owner having now used the result.

| Round-1 requirement | What it said | What changes | Why |
|---|---|---|---|
| [REQ-UX-003](khamlink_srs_redesign.md) — slogan landing-only | Slogan appears **exactly once**, only during the intro; never in persistent chrome | [REQ-UX-023](#req-ux-023) puts it in the brand lockup | The product owner wants the slogan visible as identity, not as a one-time flourish. If both instances read as duplication once built, the **intro** one is dropped. |
| [REQ-UX-004](khamlink_srs_redesign.md) — intro pacing | "Short — target under ~2s", explicitly warning a longer cinematic would overstay | [REQ-UX-025](#req-ux-025) targets 3.5–5s with more structure, plus a skip control | Round 1 was guarding against an unskippable repeated animation. With once-per-session gating and a skip affordance in place, that risk is managed, and the 1.4s result was judged to under-deliver. |
| [REQ-UX-008](khamlink_srs_redesign.md) — full-bleed canvas | Graph canvas equals the viewport | [REQ-UX-026](#req-ux-026) requires the **drawable and simulated area** to be the viewport | Satisfied at the wrong layer: the stage is full-bleed, the graph inside it is inset on four sides, so it still reads as a boxed widget. |
| [Q-UX-003](khamlink_srs_redesign.md) — glassmorphism deferred | "Clarity first"; glass may be skipped entirely | [REQ-UX-026](#req-ux-026) requires it to be attempted and measured | The product owner now asks for it explicitly. [NFR-UX-008](#nfr-ux-008) keeps the contrast bar unchanged — glass is tried, not assumed. |
| [REQ-UX-010](khamlink_srs_redesign.md) — ⅓ panel | Right panel is ~⅓ viewport in both modes | [REQ-UX-024](#req-ux-024) allows compare mode to widen or overlay | An aligned field-by-field comparison does not fit ⅓ width. Scoped to compare mode only; single-word panel unchanged. |
| [REQ-UX-013](khamlink_srs_redesign.md)/[REQ-UX-014](khamlink_srs_redesign.md) — mode selector and shared input styling | Both modes render from the same container; compare gets its own boxes | [REQ-UX-024](#req-ux-024) requires **one** input serving both modes | Round 1 achieved shared *styling* but kept two separate input surfaces. The intent was one surface. |
| [REQ-UX-021](khamlink_srs_redesign.md) §13.3 — steering ceiling | Weight 1 = bisector, documented as "the furthest the result still describes the centre" | [REQ-UX-034](#req-ux-034) makes `t=1` the destination word's own meaning | Explicitly contradicted by the product owner. **The continuity property at `t=0` — hard-won in round-1 review — is carried forward unchanged and is not up for renegotiation.** |

---

## 12. Risks and Open Questions

<a id="q-ux-008"></a>
- **Q-UX-008 — Grouping versus the node cap.** [REQ-UX-028](#req-ux-028) wants visible grouping; the 16-node cap may be too few to show more than two groups meaningfully, while raising it worsens the crowding that prompted the complaint. **Open:** settle empirically once grouping exists — the cap may be re-derivable *per group* rather than globally.
- **Q-UX-009 — Does the review pipeline keep a user entry point?** [REQ-UX-031](#req-ux-031) removes its only trigger. Option (i) or (ii) is a product decision with real consequences for whether the review service is still reachable. **Open, and blocking that requirement's implementation.**
- **Q-UX-010 — Node drag and layout stability.** Live re-convergence during a drag ([REQ-UX-029](#req-ux-029)) may fight the grouping forces from [REQ-UX-028](#req-ux-028), producing motion that undoes the legibility this round's critical requirement is buying. These two must be built and tuned **together**, not in separate phases.
- **Q-UX-011 — Slogan duplication.** [REQ-UX-023](#req-ux-023) and [REQ-UX-025](#req-ux-025) may both display the slogan. Resolution deferred until both are visible in one build; the intro instance is the one to drop.
- **Q-UX-012 — Glass over a moving backdrop.** [REQ-UX-026](#req-ux-026) and [REQ-UX-027](#req-ux-027) together make [NFR-UX-008](#nfr-ux-008) materially harder than in round 1. There is a real possibility the honest answer is again "more opaque than true glass". **This should be treated as a legitimate outcome, not a failure**, and measured rather than argued.
- **Q-UX-013 — Meaning-search floor.** [§3.3](#33-meaning-search-latency-measured) shows ~1.5 s of genuine compute. If cold-start, concurrency and progress feedback still leave it feeling slow, the remaining lever is retrieval quality, which [REQ-UX-030](#req-ux-030) rules out. **Open:** whether a cheaper first-pass result shown immediately and refined in place is acceptable, or whether 1.5 s is simply the honest cost.
- **Inherited:** the short-viewport graph collapse below ~560px height, and the stale `journeys.spec.ts` suite — both from round 1, both unresolved.

---

## 13. Suggested Rollout Phasing

Ordered so the critical requirement is de-risked first and the decorative work lands on a structure that is already correct.

1. **Graph legibility** — [REQ-UX-028](#req-ux-028). The critical item, the largest unknown, and the thing every other graph requirement builds on. Nothing decorative should be layered on a graph whose structure is still being changed.
2. **Graph physicality** — [REQ-UX-029](#req-ux-029), built and tuned **with** phase 1 per [Q-UX-010](#q-ux-010) rather than after it.
3. **Canvas** — [REQ-UX-026](#req-ux-026), [REQ-UX-027](#req-ux-027). Full-screen layout and backdrop, once node positions and grouping are settled.
4. **Retrieval responsiveness** — [REQ-UX-030](#req-ux-030) and [REQ-UX-034](#req-ux-034). Independent of the graph work and parallelisable with phases 1–3; both touch the backend and share a test surface.
5. **Search and comparison surface** — [REQ-UX-024](#req-ux-024). Depends on phase 3's overlay geometry for its widened layout.
6. **Presentation and reduction** — [REQ-UX-022](#req-ux-022), [REQ-UX-023](#req-ux-023), [REQ-UX-031](#req-ux-031), [REQ-UX-032](#req-ux-032), [REQ-UX-033](#req-ux-033). Small, independent, low-risk; can fill gaps throughout.
7. **Opening sequence** — [REQ-UX-025](#req-ux-025). Last, for the same reason round 1 sequenced it late: choreography written against a graph that is still changing shape has to be rewritten.
