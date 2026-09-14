# Software Requirements Specification: KhamLink UI/UX Redesign

*Addendum to [`khamlink_srs.md`](khamlink_srs.md) and [`khamlink_brd.md`](khamlink_brd.md) — visual design, graph engine, and writing-surface overhaul.*

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
11. [Risks and Open Questions](#11-risks-and-open-questions)
12. [Suggested Rollout Phasing](#12-suggested-rollout-phasing)

---

## 1. Document Control

### 1.1 Metadata

| Field | Value |
|---|---|
| Document | KhamLink UI/UX Redesign SRS |
| Baseline documents | `khamlink_srs.md`, `khamlink_brd.md` |
| Status | Draft — for engineering review |
| Author input | Product owner, 21-point redesign brief (verbatim source, 2026-09-15) |
| Scope class | Front-end only (frontend/) — no backend contract change unless flagged in [§8](#8-data-and-api-impact) |

### 1.2 Identifier conventions

- `REQ-UX-0##` — a redesign requirement. One per source brief point (21 total), grouped into `MOD-UX-0#` modules.
- `NFR-UX-0##` — a non-functional requirement.
- Priority: **P0** (blocks release of this redesign), **P1** (expected in the same release, may slip one iteration), **P2** (stretch / explicitly deferrable per the brief).
- File references use `path:line` against the repository state read while drafting this SRS (`frontend/src/*`). Line numbers will drift as code changes; treat them as pointers, not contracts.

### 1.3 Normative language

"Shall" = mandatory. "Should" = expected default, deviation needs a reason. "May" = optional/stretch.

---

## 2. Purpose and Scope

The current KhamLink front end (React 19 + Vite 8 + TypeScript, zero UI-component dependencies, hand-rolled CSS design tokens) is functionally complete against `khamlink_srs.md` but reads as generic AI-generated UI: flat cards, a boxed graph widget, a fully-labelled information architecture, and demonstrative filler copy. This document specifies the visual and interaction redesign requested to make the product feel intentional, cinematic, and minimal, without regressing existing functional requirements (search, comparison, context lens, writing review) or the accessibility/offline posture already established.

**In scope:** visual design system, the word-graph rendering/interaction engine, layout of the Discover page, the Word Card, the search/compare input, the Write page's document management and editor, and cross-cutting interaction polish (undo, tab transitions, breadcrumb).

**Out of scope:** dictionary content/model changes, ranking/retrieval algorithm changes, authentication or multi-device sync (documents remain browser-local per `khamlink_brd.md`), and any backend endpoint redesign beyond the optional enrichment flagged in [§8](#8-data-and-api-impact).

---

## 3. Current-State Baseline

Established by reading the current implementation, so requirements below are diffs against real code, not assumptions.

| Aspect | Current state |
|---|---|
| Stack | React 19.3, TypeScript 7, Vite 8, Vitest, Playwright + axe-core. **No** CSS framework, no animation library, no graph/canvas library. |
| Fonts | `IBM Plex Sans Thai` (UI), `Maitree` (document/serif), `IBM Plex Mono` (numerals) — `frontend/src/styles.css:8-13`. |
| Color system | Token-based, blue (60% interface) / amber (30% emphasis) / green (10% confirmation), each with a light and `[data-theme='dark']` pair — `styles.css:10-88`. This system is preserved by every requirement below; only its *application* changes. |
| Graph rendering | `SemanticGraph.tsx` + `semantic-graph.ts`: a hand-computed, deterministic **angular layout** (not a physics simulation) capped at 8 adjacent nodes + up to 6 history nodes, rendered as absolutely-positioned `<div>` buttons over an SVG line layer. Manual pointer-based pan/zoom. No floating/drift motion. |
| Graph state model | `Discover.tsx`'s `reveal()`/`openWord()` **already** distinguish "expand in place" (`append=true`, node click) from "replace the network" (`append=false`, new search) — see `Discover.tsx:113-125,141-160,192`. This is the correct state machine for [REQ-UX-006](#req-ux-006); the work is almost entirely in the *rendering/animation* layer, not the data layer. |
| Word Card | `WordCard.tsx` renders an `example` metadata field (`metadataLabels.example`, `WordCard.tsx:15,46-49`) that the brief flags as broken and must be dropped from render. |
| Redundant copy | `Discover.tsx:189` renders the literal string `ความหมาย — คำ — บริบท` as a page subtitle. `Discover.tsx:209` ("FOLLOW YOUR CURIOSITY" / three explainer buttons) is a self-demonstrating section; `Discover.tsx:210` (`discover-footer`, brand + license note) is the legitimate footer and is **not** the one to remove. |
| Mode switch | A search/compare toggle already exists (`Discover.tsx:196`, `.search-mode`/`.mode-slider`) but is a plain pill pair, not a chat-style segmented control, and the compare workspace (`ComparisonWorkspace.tsx`) is not styled to match the Word Card. |
| Breadcrumb | `SemanticGraph.tsx:79`, `.graph-path`, already renders the explored path as a clickable chain, positioned at the bottom of the graph section under `.graph-bottom`. |
| Document management | `Write.tsx:33-38` uses a native `<select>` to switch documents ("YOUR DOCUMENTS" picker) — the "random dropdown" the brief asks to remove. Delete is already a visual inline-confirm panel (`Write.tsx:124`), not a dropdown, and can stay. |
| Unused component budget | `styles.css:137-177` already defines a card-gallery pattern (`.dash`, `.dash-nav`, `.doc-grid`, `.doc-card`, `.doc-menu`) that **no component currently renders** (confirmed: no `.doc-card`/`.doc-grid` usage outside `styles.css`). This is free raw material for [REQ-UX-017](#req-ux-017). |
| Editor | `Editor.tsx` is a textarea-over-mirror decoration system (chosen deliberately over `contenteditable` because Thai combining vowel/tone marks break contenteditable caret behavior — see its file header comment). It already does token-based word-boundary selection and suggestion-span anchoring. It does **not** do markdown rendering, Tab/indent handling, or synonym-on-select highlighting. |
| Undo | None beyond the browser's native `<textarea>` undo stack. No graph-navigation undo. |

---

## 4. Requirement Index

| ID | Title | Module | Priority |
|---|---|---|---|
| [REQ-UX-001](#req-ux-001) | Glassmorphic, whitespace-led visual design system | MOD-UX-01 | P0 |
| [REQ-UX-002](#req-ux-002) | Adopt Niramit as the primary Thai typeface | MOD-UX-01 | P0 |
| [REQ-UX-003](#req-ux-003) | Slogan placement, landing-only | MOD-UX-02 | P1 |
| [REQ-UX-004](#req-ux-004) | Cinematic opening sequence | MOD-UX-02 | P1 |
| [REQ-UX-005](#req-ux-005) | Obsidian-style force-directed graph identity | MOD-UX-03 | P0 |
| [REQ-UX-006](#req-ux-006) | Progressive expand vs. collapse-and-reform | MOD-UX-03 | P0 |
| [REQ-UX-007](#req-ux-007) | Minimal node anatomy (icon + word only) | MOD-UX-03 | P0 |
| [REQ-UX-008](#req-ux-008) | Full-bleed graph canvas, center always visible | MOD-UX-03 | P0 |
| [REQ-UX-009](#req-ux-009) | Breadcrumb repositioning | MOD-UX-03 | P1 |
| [REQ-UX-010](#req-ux-010) | 2/3 graph · 1/3 permanent dictionary panel layout | MOD-UX-04 | P0 |
| [REQ-UX-011](#req-ux-011) | Word Card glassmorphism, hierarchy, drop `example` | MOD-UX-05 | P0 |
| [REQ-UX-012](#req-ux-012) | Remove redundant labels and hover-only duplication | MOD-UX-05 | P1 |
| [REQ-UX-013](#req-ux-013) | Segmented Search/Compare mode selector | MOD-UX-06 | P1 |
| [REQ-UX-014](#req-ux-014) | Shared card styling for search/compare input | MOD-UX-06 | P1 |
| [REQ-UX-015](#req-ux-015) | Remove self-demonstration footer section | MOD-UX-07 | P1 |
| [REQ-UX-016](#req-ux-016) | Ctrl+Z undo, scoped correctly | MOD-UX-08 | P1 |
| [REQ-UX-017](#req-ux-017) | Visual document create/open/delete | MOD-UX-09 | P0 |
| [REQ-UX-018](#req-ux-018) | Minimal-but-complete editor feature set | MOD-UX-10 | P0 |
| [REQ-UX-019](#req-ux-019) | Satisfying typing feel and caret/bar animation | MOD-UX-10 | P1 |
| [REQ-UX-020](#req-ux-020) | Discover ↔ Write transition polish | MOD-UX-11 | P1 |
| [REQ-UX-021](#req-ux-021) | Embedding-steering slider (stretch) | MOD-UX-12 | P2 |

---

## 5. Functional Requirements

### 5.1 MOD-UX-01 — Visual Design System

<a id="req-ux-001"></a>
#### REQ-UX-001: Glassmorphic, whitespace-led visual design system

- **Source:** Brief point 1.
- **Priority:** P0.
- **Current state:** Flat, opaque surfaces (`--paper: #ffffff` / `#102844` dark) with hairline borders; the only existing blur is `.modal::backdrop` (`styles.css:328`). Spacing is ad hoc per component rather than governed by a scale.
- **Required behavior:** The system shall introduce (a) a layered background — a subtle gradient/mesh or the graph canvas itself, never flat single-color — visible behind floating panels; (b) an explicit 4/8px-multiple spacing scale (`--space-1` … `--space-8`) applied consistently to padding/margin/gap in place of today's per-component magic numbers; (c) color used *compositionally* — e.g. amber as a graph accent glow, green as a living "connected" pulse — rather than only as flat fills, per the brief's "use it more creatively" instruction; (d) a deliberate "wow factor" pass — motion, depth, light — on at least the landing/graph experience, so the product reads as designed rather than templated.
- **Glassmorphism is a candidate technique, not a mandate.** Per product-owner direction, the priority order is **clarity first, modern/"wow" feel second**; glassmorphism (translucent `backdrop-filter` surfaces) is explicitly *allowed to ship later or be skipped* on any given surface if a solid/opaque panel with strong shadow, border, and spacing reads more clearly there. Where blur is used, add a small set of glass tokens (`--glass-bg`, `--glass-border`, `--glass-blur`, `--glass-shadow`) built from the *existing* blue/amber/green palette at low alpha, so dark-mode remains a token swap, not a second stylesheet, matching the codebase's own stated design law (`styles.css:1-3`). Where it is not used, the same spacing/shadow/token discipline still applies — "looks AI-generated" is fixed by whitespace, hierarchy, and motion at least as much as by blur, and this requirement should not be read as blocked on getting blur right everywhere.
- **Explicit constraint:** The blue-dominant / amber-emphasis / green-confirmation ratio and every existing token *name* the app depends on (`--blue`, `--correctness`, etc., used across `Modals.tsx`, `Editor.tsx`) shall not be renamed or removed — only extended with new tokens and reused more expressively.
- **Acceptance criteria:** No component uses a hard-coded hex/px value where a token exists; wherever `backdrop-filter` surfaces are used, they remain legible (see NFR-UX-002 for contrast) in both themes; a visual diff shows no flat, unstyled, default-looking card anywhere — every surface uses the spacing scale, an intentional shadow/border/glass treatment, and shows some form of motion or depth on first paint.

<a id="req-ux-002"></a>
#### REQ-UX-002: Adopt Niramit as the primary Thai typeface

- **Source:** Brief point 10.
- **Priority:** P0.
- **Current state:** `--ui: 'IBM Plex Sans Thai', …`; `--doc: 'Maitree', …` (`styles.css:11-12`), loaded via a single Google Fonts `@import` with explicit weights.
- **Required behavior:** Niramit shall replace (or head) the `--ui` font stack; the `--doc` (reading/writing surface) stack shall be evaluated for Niramit too, since the brief names one font for "the website," and a second serif-vs-Niramit split should only survive if a design review prefers it for long-form reading. `--mono` (IBM Plex Mono, used for numerals/scores) is out of scope — Niramit has no monospace cut.
- **Technical note (resolved per product owner):** Load Niramit the same way the app already loads fonts today — via Google Fonts' own generated `<link>`/`@import` embed snippet (`fonts.googleapis.com/css2?family=Niramit:wght@...`), which handles subsetting and `font-display` automatically; do not hand-roll `@font-face` rules. This is a same-pattern swap of the existing `@import` at `styles.css:8`, not a new loading mechanism. If Niramit's Google Fonts embed proves incomplete or visually unacceptable for Thai tone marks/combining vowels during evaluation ([Q-UX-002](#q-ux-002)), fall back to the current `IBM Plex Sans Thai`/`Maitree` pairing rather than shipping a broken primary font.
- **Acceptance criteria:** All Thai body/UI text renders in Niramit in a fonts-loaded state, loaded via the standard Google Fonts embed; the existing offline-fallback chain (`'Leelawadee UI', 'Noto Sans Thai', 'Sarabun', system-ui`) is preserved unchanged after Niramit, since the app is explicitly designed to demo offline (`styles.css:5-7`); tone marks (ไม้เอก, ไม้โท, ไม้ตรี, ไม้จัตวา) render without clipping or collision at both UI and heading sizes — if they do not, the fallback pairing ships instead and this requirement is marked partially met pending a font substitute.

### 5.2 MOD-UX-02 — Landing / Opening Experience

<a id="req-ux-003"></a>
#### REQ-UX-003: Slogan placement, landing-only

- **Source:** Brief point 2 — *"ผู้ช่วยด้านภาษาไทยที่ช่วยให้ทุกความคิดเจอคำที่ใช่"*.
- **Priority:** P1.
- **Required behavior:** The slogan shall appear exactly once, as part of the initial/landing state before or during the cinematic opening ([REQ-UX-004](#req-ux-004)) — e.g. as a line that fades in after the "คำ" node blooms and before it settles into the graph. It shall not reappear in the persistent chrome, footer, or any modal; it is a first-impression statement, not a tagline component.
- **Acceptance criteria:** A text search for the slogan string in the rendered DOM returns exactly one match, present only during/immediately after the intro state (`intro` flag already exists at `Discover.tsx:107,168-171`).

<a id="req-ux-004"></a>
#### REQ-UX-004: Cinematic opening sequence

- **Source:** Brief point 3.
- **Priority:** P1.
- **Current state:** `intro` is a boolean that adds a `graph-intro` class for ~1.8s (`Discover.tsx:168-171`) and staggers node/edge entrance via CSS `animation-delay` (`semantic-graph.css:11,17,56`). There is no black/white stage, no bloom, no beam propagation — nodes/edges just fade-and-translate in on the already-colored canvas.
- **Required behavior:** On first load only (not on every `activeId` change — see [REQ-UX-006](#req-ux-006) for that), the system shall play a sequence: (1) a near-black or desaturated stage; (2) the "คำ" node blooms in at the center (scale + glow, not a hard cut); (3) beams of light travel outward from it along the edges that will become the initial neighbor set; (4) neighbor nodes resolve into existence where each beam terminates; (5) the stage transitions to the normal themed canvas and color palette as the sequence settles. The slogan ([REQ-UX-003](#req-ux-003)) is composited into this sequence, not appended after it.
- **Technical note:** see [§7.3](#73-cinematic-intro--bloom).
- **Acceptance criteria (cadence resolved per product owner):** Sequence plays **once per session** (a `sessionStorage` flag, not `localStorage` — a fresh tab/session sees it again, a reload within the same session does not) and shall be **short** — target under ~2s total, at or below the current `intro` window (`Discover.tsx:168-171` uses ~1.8s today) rather than longer, since a repeated-per-session cinematic that overstays its welcome undermines the "keep it short" direction; total duration is short enough not to gate interaction — the graph shall accept input during the settle phase, not block it; `prefers-reduced-motion: reduce` collapses the whole sequence to an instant, static presentation of the same end state (existing app-wide rule at `styles.css:364-366` already covers this pattern and shall be extended to the intro).

### 5.3 MOD-UX-03 — Graph Engine

<a id="req-ux-005"></a>
#### REQ-UX-005: Obsidian-style force-directed graph identity

- **Source:** Brief point 4.
- **Priority:** P0.
- **Current state:** Deterministic angular placement, not a simulation — see [§3](#3-current-state-baseline). No inter-node "floating" motion exists; entrance animation is the only motion.
- **Required behavior:** The graph shall run a genuine force simulation (link/charge/collision forces) so that: nodes settle into organic, non-overlapping positions rather than a fixed radial ring; unselected/background nodes exhibit a continuous, low-amplitude idle drift ("floating") independent of layout convergence; spacing between nodes is force-derived (collision radius), not hand-tuned angle math, so it stays even as neighbor count varies; the overall impression reads as a living semantic web, matching Obsidian's graph view's core qualities of depth, motion, and organic spacing — without copying its exact visual style, since KhamLink keeps its own blue/amber/green palette.
- **Technical note:** see [§7.1](#71-graph-physics).
- **Neighbor cap (resolved per product owner):** the current bounded-neighborhood cap (~8 adjacent + history) is **not fixed at that number**. The visible/simulated node cap may be raised — the brief suggests a 14-20 range — but the cap is a *performance and usability* budget, not a target: implementation shall measure actual frame rate and node-overlap/legibility at each candidate cap and settle on the highest value that stays smooth (see [NFR-UX-001](#nfr-ux-001)) and keeps node labels legible without crowding, rather than shipping a specific number chosen up front.
- **Acceptance criteria:** No two visible nodes' bounding boxes overlap at rest; idle nodes visibly drift within a bounded radius (measurable via position sampling over time in a Playwright test, or disabled entirely under `prefers-reduced-motion`); simulation reaches a visually stable state within a bounded time (target: <1.5s) at whatever neighbor cap is chosen; the chosen cap is documented alongside the frame-rate measurement that justified it.

<a id="req-ux-006"></a>
#### REQ-UX-006: Progressive expand vs. collapse-and-reform

- **Source:** Brief point 5.
- **Priority:** P0.
- **Current state:** The **data model already implements this distinction** — `openWord(key, append=true)` on node click preserves the network and calls `expandNetwork(previous, …)`; `search(value)` calls `reveal(found, controller, append=false, …)` which passes a fresh `{nodes: [], links: []}` base (`Discover.tsx:113-160,192`, `discovery-data.ts:20`). What's missing is the *animated transition* that makes this distinction visible and satisfying.
- **Required behavior:** On node-click expansion, new nodes shall animate in from their parent's position (the existing `--from-x`/`--from-y` mechanism at `SemanticGraph.tsx:67` is the right primitive to extend) while every existing node's force-simulated position updates smoothly — no full-graph re-layout jump. On a new search/meaning query, the current web shall visibly **collapse** (converge/fade toward the old center, or dissolve) before the new center's web **forms** from nothing, distinct from the quieter in-place expansion. The two motions shall be visually distinguishable so a user always knows, without reading text, whether they extended their exploration or started over.
- **Technical note:** see [§7.2](#72-expandcollapse-transition).
- **Acceptance criteria:** Clicking a neighbor node never triggers the collapse animation and never removes a previously-visible node that is still within the new bounded neighborhood/path; submitting a new search always triggers collapse-then-form and always results in a network whose only initial members are the new center and its immediate neighbors (matching current `expandNetwork` semantics for `append=false`).

<a id="req-ux-007"></a>
#### REQ-UX-007: Minimal node anatomy (icon + word only)

- **Source:** Brief point 7 (node-content half).
- **Priority:** P0.
- **Current state:** Nodes already show only a small dot (`.graph-node-dot`) and the word text (`.graph-node-word`), plus a relation-kind hint label under non-center nodes (`.graph-node-hint`, `SemanticGraph.tsx:73`) and a hover-triggered description tooltip (`.graph-preview`, `SemanticGraph.tsx:75`, `semantic-graph.css:40-42`). This is closer to the brief than the framing suggests, but the hint label and hover-preview are exactly the "definition on hover when a click already gets you there" pattern the brief asks to remove.
- **Required behavior:** A node shall render **only** a node icon/mark (replacing the current plain dot with something that carries relation-type meaning through shape/color rather than text, e.g. a small glyph or colored ring per `kind`) and the word text. The relation-kind hint label and the hover-preview description tooltip shall be removed from the node itself; relation type and description belong in the permanent dictionary panel ([REQ-UX-010](#req-ux-010)) once a node is clicked, not floated over the graph. Decorative elements (glow, orbit ring, breathing halo on the center node) may remain or be extended — they are decoration, not information, which is exactly what the brief asks to keep.
- **Acceptance criteria:** No node renders text other than the word itself; no hover interaction reveals a definition; clicking a node is the only path to seeing its meaning, and it opens instantly in the permanent panel (no modal, no popover latency).

<a id="req-ux-008"></a>
#### REQ-UX-008: Full-bleed graph canvas, center always visible

- **Source:** Brief point 13.
- **Priority:** P0.
- **Current state:** The graph is a bounded-height section (`.semantic-graph`, fixed `height:490px` growing to `520px` at wide viewports, `semantic-graph.css:2,59`) inside normal page flow, not a page-spanning backdrop.
- **Required behavior:** The graph canvas shall occupy the full viewport as the page's background layer; the dictionary panel ([REQ-UX-010](#req-ux-010)), search/compare dock ([REQ-UX-013](#req-ux-013)), and breadcrumb ([REQ-UX-009](#req-ux-009)) shall be positioned on top of it (fixed/absolute, glass surfaces per [REQ-UX-001](#req-ux-001)) rather than sharing normal document flow with it. On every search and on load, the system shall recenter/reframe the camera so the active center node sits in a viewport region not obscured by the permanent panel — i.e. camera framing must account for the 1/3-width panel's footprint, not just the raw viewport center.
- **Acceptance criteria:** The graph canvas element's bounding box equals the viewport (minus safe-area insets); after any search or node click, the center node's screen position is not covered by the dictionary panel and is within a comfortable margin of the visible (non-panel) area's centroid.

<a id="req-ux-009"></a>
#### REQ-UX-009: Breadcrumb repositioning

- **Source:** Brief point 15.
- **Priority:** P1.
- **Current state:** `.graph-path` already exists and works (`SemanticGraph.tsx:79`) but sits at the bottom of the graph, inside `.graph-bottom` alongside zoom/focus controls (`semantic-graph.css:43`) — easy to miss and crowded with unrelated controls once the graph goes full-bleed.
- **Required behavior:** The breadcrumb shall move to a location that stays legible against the full-bleed graph and does not compete with graph controls — e.g. a top-anchored glass strip, consistent with where breadcrumbs conventionally live. It shall remain keyboard-operable and shall continue to reflect the `path` array already maintained in `Discover.tsx`.
- **Acceptance criteria:** Breadcrumb is reachable and visible without opening any panel; it does not overlap the dictionary panel, the search dock, or graph zoom controls at any supported viewport width.

### 5.4 MOD-UX-04 — Layout and Dictionary Panel

<a id="req-ux-010"></a>
#### REQ-UX-010: 2/3 graph · 1/3 permanent dictionary panel layout

- **Source:** Brief point 6.
- **Priority:** P0.
- **Current state:** The Word Card currently appears as a conditional overlay (`discover-inspector`, only when `cardOpen && word && mode==='search'`, `Discover.tsx:193`) — not permanent, and hidden entirely in compare mode.
- **Required behavior:** The right ~1/3 of the viewport shall be a **permanent** panel that always shows the Word Card for the currently-focused/center node — never empty once the app has loaded, since the graph always has a center (`คำ` by default, per `Discover.tsx:97`). On initial load it shall focus "คำ"; on every node click or search that changes the center, it shall re-focus to the new center's meaning without requiring a separate "open card" action (removing the current click-to-open gesture — the panel simply always reflects the center). The left ~2/3 is the graph canvas from [REQ-UX-008](#req-ux-008).
- **Interaction with compare mode:** Compare mode's own card-style panels ([REQ-UX-014](#req-ux-014)) occupy the same right-hand zone when active; the permanent single-word panel and the compare panel are mutually exclusive by mode, matching the existing `mode` state (`Discover.tsx:94`).
- **Acceptance criteria:** The dictionary panel never renders an empty/placeholder state while a center node exists; changing the center (click or search) updates the panel's content within the same interaction that updates the graph, with no separate "open" click required; panel width is ~1/3 of viewport at desktop widths and degrades to the existing responsive pattern (`styles.css:346-349`, currently used for `.side`) below the `940px` breakpoint.

### 5.5 MOD-UX-05 — Word Card and Content Hygiene

<a id="req-ux-011"></a>
#### REQ-UX-011: Word Card glassmorphism, hierarchy, drop `example`

- **Source:** Brief point 9.
- **Priority:** P0.
- **Current state:** `WordCard.tsx` renders senses via `WordSense`, which iterates `metadataLabels` including `example: 'ตัวอย่างการใช้'` (`WordCard.tsx:15,46-49`) — explicitly called out as broken and must not render, at all, regardless of whether the underlying data is later fixed; this is a display-layer removal, not a backend fix request.
- **Required behavior:** The Word Card shall adopt the glass surface tokens from [REQ-UX-001](#req-ux-001) (translucent panel, blurred backdrop against the graph behind it) while remaining fully readable (see NFR-UX-002). Its information hierarchy shall be reordered/weighted so the word and its primary sense read first, with pronunciation/register/part-of-speech as secondary metadata, curated/AI notes and related-word chips as tertiary — using size, weight and spacing (not new dividers/boxes) to establish the hierarchy, consistent with the minimalism principle in [REQ-UX-012](#req-ux-012). The `example` field shall be excluded from `metadataLabels` rendering entirely.
- **Acceptance criteria:** No DOM node renders `metadataLabels.example` content for any word, including words whose data does contain an `example` key; a visual hierarchy pass (heading scale, color weight) makes the headword and first sense the unambiguous first read without needing a design-review sign-off doc — it should be self-evident from a screenshot.

<a id="req-ux-012"></a>
#### REQ-UX-012: Remove redundant labels and hover-only duplication

- **Source:** Brief points 7 (label half) and 8.
- **Priority:** P1.
- **Current state:** `Discover.tsx:189` renders `ความหมาย — คำ — บริบท` as a subtitle line under the page heading.
- **Required behavior:** That literal string shall be removed from the rendered UI (it may remain, if at all, only as an internal code comment/variable name, never as user-facing copy). More generally, no UI surface shall duplicate information the user can get one click away (this generalizes [REQ-UX-007](#req-ux-007)'s node-level rule to the whole page): a definition available by clicking a node must not also live in a hover tooltip; a relation type shown in the panel must not also be spelled out as a node label.
- **Acceptance criteria:** The string `ความหมาย — คำ — บริบท` (in any spacing/dash variant) does not appear in rendered output anywhere in the app.

### 5.6 MOD-UX-06 — Search / Compare Mode

<a id="req-ux-013"></a>
#### REQ-UX-013: Segmented Search/Compare mode selector

- **Source:** Brief point 11.
- **Priority:** P1.
- **Current state:** A working but plain two-button toggle with a sliding indicator already exists (`Discover.tsx:196`, `.search-mode`, `.mode-slider`) — the interaction model (single active mode, shared container) is already correct; the visual treatment is not.
- **Required behavior:** The selector shall be restyled as a segmented control in the visual language of an AI-chat mode switch (referencing shadcn/ui's `Tabs`/segmented-control pattern or Radix `RadioGroup` purely as a **design reference**, not necessarily as an added dependency — see [§7.5](#75-mode-selector)). Selecting **Search** shall present exactly one query input; selecting **Compare** shall present the multi-box comparison input ([REQ-UX-014](#req-ux-014)). Both modes shall render from the same underlying container/box component so switching modes feels like a state change within one control, not a navigation to a different widget.
- **Acceptance criteria:** Mode switch is a single click/tap with an animated indicator (already present, restyle only); Search mode never shows more than one query field; Compare mode allows adding additional comparison boxes beyond the initial two currently seeded (`Discover.tsx:193,209`, `[word.word, '']`).

<a id="req-ux-014"></a>
#### REQ-UX-014: Shared card styling for search/compare input

- **Source:** Brief point 12.
- **Priority:** P1.
- **Required behavior:** The search box and each compare box shall use the same glass-card visual language as the Word Card ([REQ-UX-011](#req-ux-011)) — same corner radius, border treatment, blur, and spacing scale — while their internal information hierarchy is tuned for their own purpose: the search box emphasizes the input affordance and live suggestions; each compare box emphasizes the word identity plus a compact difference-relevant summary, since a compare box's job is scanability across multiple boxes, not depth on one word.
- **Acceptance criteria:** A visual diff of the Word Card, the search box, and a compare box shows a shared surface style (radius/border/blur/shadow tokens identical) with content layout that differs by role, not by inconsistent styling.

### 5.7 MOD-UX-07 — Content Cleanup

<a id="req-ux-015"></a>
#### REQ-UX-015: Remove self-demonstration footer section

- **Source:** Brief point 14.
- **Priority:** P1.
- **Current state:** `Discover.tsx:209` (`discover-below`, "FOLLOW YOUR CURIOSITY" heading + three explainer buttons demonstrating search/compare/write) is the section to remove. `Discover.tsx:210` (`discover-footer` — brand name, tagline, licensing note, "TH / EN") is the legitimate footer and shall be **kept**, and shall read as professional (i.e., it may gain the glass treatment from [REQ-UX-001](#req-ux-001) but keeps its current informational content: brand, data provenance, language indicator).
- **Required behavior:** Delete the `discover-below` section and its `.explore-ways` content entirely. Usage clarity that section provided (search / compare / write) shall instead be evident from the redesigned landing/opening experience itself ([REQ-UX-004](#req-ux-004)) and the always-visible mode selector ([REQ-UX-013](#req-ux-013)) and Write tab ([REQ-UX-020](#req-ux-020)) — not from a dedicated explainer block.
- **Acceptance criteria:** No "FOLLOW YOUR CURIOSITY" / numbered explainer block exists in the DOM; `discover-footer`'s brand/provenance/language content is still present and reachable.

### 5.8 MOD-UX-08 — Global Interaction

<a id="req-ux-016"></a>
#### REQ-UX-016: Ctrl+Z undo, scoped correctly

- **Source:** Brief point 16.
- **Priority:** P1.
- **Current state:** Text editing already gets free, correct undo from the native `<textarea>` (`Editor.tsx`) — this must not be broken. No undo exists for graph navigation (center/path changes) or for document management actions ([REQ-UX-017](#req-ux-017)).
- **Required behavior:** The system shall add a **graph-navigation** undo: Ctrl+Z (Cmd+Z on macOS) while focus is *not* inside the writing `<textarea>` or a text input shall step the graph's center back through the existing `path`/`history` state (`Discover.tsx:99,108`) rather than doing nothing. Where a global keydown listener would otherwise intercept Ctrl+Z while the user is typing in the editor or any input/textarea, the listener shall explicitly no-op and let the native undo behavior proceed — mirroring the existing pattern already used for the `/` search shortcut, which checks `event.target.closest('input, textarea, [contenteditable="true"])` before acting (`Discover.tsx:43`). Document create/delete ([REQ-UX-017](#req-ux-017)) should participate in the same undo stack where feasible (e.g. undoing a delete restores the document), given the brief's "everywhere needed" framing.
- **Priority ordering (resolved per product owner):** undo ships first and is the P1 commitment of this requirement; redo (Ctrl+Shift+Z / Ctrl+Y) is a deliberate P2 follow-on, not a same-release requirement — implement undo's stack shape so redo is a cheap addition later (don't destructively pop history entries; keep a forward pointer), but do not block shipping undo on redo being ready.
- **Acceptance criteria:** Ctrl+Z inside the writing surface performs standard text undo and never triggers a graph-navigation step; Ctrl+Z with focus elsewhere on the Discover page steps the graph center back one entry in `path` with no page reload; redo is out of this requirement's acceptance bar and tracked separately.

### 5.9 MOD-UX-09 — Write: Document Management

<a id="req-ux-017"></a>
#### REQ-UX-017: Visual document create/open/delete

- **Source:** Brief point 17.
- **Priority:** P0.
- **Current state:** Document switching is a native `<select>` (`Write.tsx:33-38`, "YOUR DOCUMENTS"); creation is already a visible `+ New document` button (`Write.tsx:39`) and is fine as-is; deletion is already a visible inline-confirm panel (`Write.tsx:124`) and is fine as-is. The one element that violates the brief is the `<select>` picker. **Reusable material already exists:** `styles.css:137-177` defines a complete, currently-unrendered document-gallery pattern (`.dash`, `.doc-grid`, `.doc-card`, `.doc-menu`, `.menu-pop`) — hover-lift cards with an excerpt, kind badge, meta line, and an overlay menu button, exactly shaped for this use case.
- **Required behavior:** Replace the `<select>` picker with a visual document switcher — a card grid or a compact card-list (reusing/adapting the existing `.doc-card`/`.doc-grid` CSS rather than inventing a new pattern) that shows each document's title and a short excerpt, and opens it on click. Creation and deletion may keep their current visual (non-dropdown) mechanisms, restyled to match [REQ-UX-001](#req-ux-001).
- **Acceptance criteria:** No `<select>`/native dropdown exists anywhere in the document-switching flow; opening, creating, and deleting a document are each a direct visual interaction (click a card, click a button, confirm inline) with no OS-native popup control involved.

### 5.10 MOD-UX-10 — Write: Editor

<a id="req-ux-018"></a>
#### REQ-UX-018: Minimal-but-complete editor feature set

- **Source:** Brief point 18.
- **Priority:** P0.
- **Current state, mapped against the brief's required-feature list:**

| Required feature | Current state |
|---|---|
| Title | ✅ `write-title` input (`Write.tsx:117`). |
| Word count | ✅ `countWords(doc.body)` (`Write.tsx:116`, `docs.ts`). |
| Word parsing → click to inspect/change | ✅ Already implemented: `tokens` prop + `reportSelection()` resolve a caret to its containing word via backend-provided token boundaries (`Editor.tsx:124-137`), driving the existing "Context Lens"-equivalent lookup panel in `Write.tsx:126-134`. This satisfies the brief's "same as บริบท from the original old site" request as-is — no new segmentation logic is required. |
| Visual markdown formatting | ❌ Not implemented. The mirror layer only paints suggestion/selection `<mark>`s, not markdown styling. |
| Indenting / Tab | ❌ Not implemented — `<textarea>` default Tab behavior (focus-escape) is not overridden. |
| Highlight-to-search synonym/related words + meanings | Partially implemented: selecting text already triggers a word lookup and shows related words in the Word Card (`Write.tsx:65-83,132`), but this is a side-panel result, not an in-text highlight of synonym candidates. |

  - **Required behavior:** (a) Add visual markdown rendering using the "invisible markdown" technique described in [§7.6](#76-markdown-in-the-mirror) — extending the existing mirror/textarea dual-layer rather than replacing it, since replacing it would regress the Thai-caret-correctness reason that architecture exists (`Editor.tsx:6-13`). (b) Add Tab handling that inserts real indentation (spaces or a tab character, product owner to confirm) at the caret/selection instead of moving focus, with Shift+Tab as outdent, implemented via a `textarea` `onKeyDown` handler that calls `preventDefault()` and manipulates `value`/`selectionStart` directly — this must integrate with, not fight, the native undo stack ([REQ-UX-016](#req-ux-016)). (c) Extend the existing token/selection pipeline so a highlighted word can show its synonyms/related words as inline highlight affordances in the mirror (reusing the `Related` data already fetched at `Write.tsx:76-79`), not only in the side panel.
  - **Acceptance criteria:** Markdown syntax (bold/italic/heading/list markers, at minimum) renders visually distinct in the writing surface while the underlying value remains plain markdown text (so save/export stays markdown); Tab/Shift+Tab indent/outdent the current line(s) without leaving the editor or the document; selecting a word surfaces its synonyms without requiring a click into the side panel to discover that they exist.

<a id="req-ux-019"></a>
#### REQ-UX-019: Satisfying typing feel and caret/bar animation

- **Source:** Brief point 19 — *"Take Grammarly text editor as example."*
- **Priority:** P1.
- **Required behavior:** Typing shall feel smooth and immediate: no visible input lag between keystroke and paint (the current architecture already avoids this — direct `<textarea>` value binding, no debounce on keystroke itself); suggestion underlines and the active-suggestion card shall animate in rather than pop (an animation already exists for the card, `.span-card`/`rise` keyframe, `styles.css:232-233` — extend the same care to underline appearance); the word-count/status area shall animate value changes rather than jump-updating; a save/sync indicator (`.saved`, `styles.css:240-241`) shall pulse or transition on state change rather than toggle instantly.
- **Acceptance criteria:** No layout thrash (measurable via no forced synchronous layout warnings) during normal typing; all state-driven UI changes in the writing surface (suggestion count, word count, save indicator, active card) use a transition/animation rather than an instant DOM swap, respecting `prefers-reduced-motion` per the app's existing global rule.

### 5.11 MOD-UX-11 — Navigation

<a id="req-ux-020"></a>
#### REQ-UX-020: Discover ↔ Write transition polish

- **Source:** Brief point 21.
- **Priority:** P1.
- **Current state:** Navigation between Discover and Write is presumed to be a simple view swap driven by `onWrite`/route state in a parent component (not shown in the files read for this SRS — verify against the actual router/shell before implementation).
- **Required behavior:** Switching between Discover and Write shall use a cohesive transition (shared-element or cross-fade/slide, consistent with the glass/motion language established elsewhere in this document) rather than an instant swap, and shall be reachable from a persistent, clearly-labeled control (a tab, not a buried link) so it reads as one product with two modes, not two separate pages.
- **Acceptance criteria:** The switch completes as an animated transition, not an instant re-render; the control to switch is visible from both Discover and Write without scrolling.

### 5.12 MOD-UX-12 — Stretch

<a id="req-ux-021"></a>
#### REQ-UX-021: Embedding-steering slider (stretch)

- **Source:** Brief point 20 — explicitly conditional ("if there's more time... MIGHT").
- **Priority:** P2 — deferred from this redesign's core scope; documented for planning only.
- **Required behavior (if pursued):** A slider (or set of sliders) tied to user-supplied steering words (e.g. ผู้หญิง) shall bias semantic-neighbor ranking/selection so results shift toward the steered concept (e.g. ราชา → ราชินี as "ผู้หญิง" increases) without the user re-typing a query.
- **Dependency:** This requires vector arithmetic or re-ranking against the embedding space, which is a **backend/retrieval capability**, not a front-end styling change — see [§8](#8-data-and-api-impact). It is out of scope for this SRS's engineering estimate and should be scoped as its own BRD/API addendum if prioritized.
- **Acceptance criteria:** N/A for this document — tracked as a follow-on spec, not committed here.

---

## 6. Non-Functional Requirements

<a id="nfr-ux-001"></a>
**NFR-UX-001 — Motion budget.** All new animation (graph physics idle drift, bloom intro, transitions, typing-bar micro-animations) shall run at a sustained frame rate that does not visibly stutter on mid-range hardware, and shall fully respect `prefers-reduced-motion: reduce` by collapsing to the equivalent instant/static end state, extending the app's existing global rule (`styles.css:364-366`) to every new animated element rather than adding motion the existing rule doesn't reach.

<a id="nfr-ux-002"></a>
**NFR-UX-002 — Contrast on glass.** Wherever a glass/translucent surface is used under [REQ-UX-001](#req-ux-001), it shall meet WCAG AA text contrast (4.5:1 body text, 3:1 large text) against its *worst-case* backdrop (the busiest region of the graph behind it), not just against an average sampled color — this typically requires a solid-enough blur/scrim layer under the text, not blur alone. This is precisely the risk that justifies REQ-UX-001's "clarity first" ordering: a surface that cannot clear this bar with blur shall use a more opaque/solid treatment instead of shipping blur that fails contrast. Verify with the existing axe-core Playwright integration (`@axe-core/playwright` devDependency) plus manual spot-checks against the graph's densest state.

<a id="nfr-ux-003"></a>
**NFR-UX-003 — Accessibility parity.** No requirement in this document may reduce existing accessibility affordances: ARIA roles/labels/live-regions already present (`aria-pressed`, `aria-expanded`, `role="listbox"`, `aria-live="polite"`, etc., observed throughout `SemanticGraph.tsx`, `Discover.tsx`, `Modals.tsx`) shall be preserved or improved, never dropped, when a component is restyled. Keyboard operability of the graph, mode selector, and document switcher is mandatory, not a nice-to-have, since the graph is now the full-page canvas everything else sits on top of.

<a id="nfr-ux-004"></a>
**NFR-UX-004 — Responsive integrity.** The existing breakpoint set (`1180px`, `940px`, `640px`/`620px`) and its established patterns (side panel becomes an off-canvas drawer below `940px`, per `styles.css:346-349`) shall be extended to the new full-bleed graph and permanent dictionary panel, not replaced with a new breakpoint scheme, to keep the redesign a coherent evolution rather than a parallel mobile implementation.

<a id="nfr-ux-005"></a>
**NFR-UX-005 — Dependency budget.** The current front end ships with zero UI/animation/graph dependencies beyond React itself. Any new dependency proposed in [§7](#7-technology-selection) must earn its place against that baseline — this redesign shall prefer native platform features (CSS, View Transitions, SVG filters) and small, single-purpose libraries over frameworks, and shall document the bundle-size cost of anything added.

<a id="nfr-ux-006"></a>
**NFR-UX-006 — Offline/local-first posture.** No requirement in this document may introduce a hard runtime dependency on a network resource beyond what already exists (the Google Fonts `@import`, already treated as progressive enhancement with an offline fallback chain, `styles.css:5-7`). Documents remain browser-local per the existing privacy model (`Modals.tsx`'s `PrivacyModal`); this redesign does not change that.

---

## 7. Technology Selection

Ladder applied: prefer native platform features, then the smallest single-purpose library, before anything heavier — consistent with [NFR-UX-005](#nfr-ux-005) and the codebase's current zero-dependency posture.

### 7.1 Graph physics

**Recommendation: `d3-force`** (not the full `d3` bundle — just the force module, ~20KB min, well under React/Vite's existing budget) to compute node positions only. Rendering stays exactly as it is today: React-owned SVG lines + absolutely-positioned DOM buttons (`SemanticGraph.tsx`). The simulation runs in a `useEffect`, and on each `tick` either (a) writes positions into a ref-backed map and updates DOM `style.transform` directly for 60fps (bypassing React re-render per tick — the current code already does manual `transform`/`left`/`top` styling, so this is a natural fit), or (b) throttles into React state if profiling shows (a) is unnecessary. `d3-force`'s `forceLink` + `forceManyBody` + `forceCollide` map directly onto [REQ-UX-005](#req-ux-005)'s "no overlap, organic spacing" requirement, and a small constant "wander" force per idle node produces the floating effect without hand-rolled physics.

**Alternative considered:** hand-rolled naive O(n²) repulsion (true zero-dependency). Viable given the existing bounded neighborhood cap (~14 visible nodes), but `d3-force` is small, battle-tested on exactly this problem, and avoids reinventing collision/link-distance tuning — the pragmatic choice even under a lazy-dependency bias. Do **not** reach for `three.js`/WebGL/`react-force-graph`: this is a modest 2D node count, not a large-graph visualization problem, and a 3D engine would be pure bundle-size and complexity cost for no requirement that asks for it.

### 7.2 Expand/collapse transition

**Recommendation: the native View Transitions API** (`document.startViewTransition(() => { /* update state */ })`) as the primary mechanism for [REQ-UX-006](#req-ux-006)'s collapse-then-form motion on a new search, with a CSS opacity/scale transition as the fallback path for browsers without support (Safari <18, Firefox behind a flag as of this writing — verify current support before implementation). In-place node expansion continues to use the existing `--from-x`/`--from-y` parent-relative entrance animation (`SemanticGraph.tsx:67`, `semantic-graph.css:56`), extended to read live positions from the `d3-force` simulation instead of the current static angle math.

### 7.3 Cinematic intro / bloom

**Recommendation: SVG filters + CSS keyframes**, no canvas/particle engine. An `feGaussianBlur`/`feMerge` filter on the center node and its outbound edges, animated via CSS custom-property-driven keyframes (the codebase already uses this pattern extensively, e.g. `--edge-delay`, `--node-delay` in `SemanticGraph.tsx:61,67`), produces a convincing bloom-and-beam effect without a new rendering pipeline. Revisit only if a build-out shows the desired "light traveling along a path" effect needs per-frame control SVG/CSS can't give it — in which case a small `<canvas>` overlay used *only* for the ~1-2s intro (then torn down) is the next-smallest step, still well short of a full WebGL/three.js investment.

### 7.4 Undo

No new library. Graph-navigation undo is a plain array-index step against state (`path`/`history`) already held in `Discover.tsx` — a `useState` stack with a keydown listener is sufficient (see [REQ-UX-016](#req-ux-016)'s scoping rule). Do not attempt to unify this with the browser's native textarea undo stack; keeping them separate and correctly scoped by focus target is simpler and less risky than any library that tries to abstract over both.

### 7.5 Mode selector

No new dependency required. The existing `.search-mode` markup (`Discover.tsx:196`) already implements the correct accessible pattern (a two-button group with a sliding indicator); [REQ-UX-013](#req-ux-013) is a restyle, informed by shadcn/ui's segmented-control visuals and Radix's `RadioGroup`/`Tabs` accessibility pattern (`role`, `aria-pressed`/`aria-selected`, arrow-key navigation) as a **reference**, not an install. Only add Radix primitives if hand-rolled keyboard handling proves fiddly in practice — unlikely for a two-to-N-item segmented control.

### 7.6 Markdown in the mirror

Extend the existing textarea-over-mirror architecture (`Editor.tsx`) rather than switching to `contenteditable` or a rich-text framework (CodeMirror/ProseMirror/Lexical) — switching would reintroduce the exact Thai-caret bug the current architecture was built to avoid (`Editor.tsx:6-13`). Technique: keep raw markdown syntax (`**bold**`, `# heading`, etc.) in the `<textarea>`'s plain-text value, unchanged; in the mirror layer, parse the same value and render matched markdown spans with their visual styling (bold weight, heading size, list indent) while *visually hiding* the marker characters themselves via a near-zero-width styled span (`font-size: 0` or `opacity` trick with layout preserved) — the "invisible markdown" pattern used by editors like Bear/iA Writer. This keeps `onChange`/undo/IME behavior exactly as today; only the mirror's rendering function grows.

### 7.7 Document gallery

No new component library. Repurpose the already-defined, currently-unused `.dash`/`.doc-grid`/`.doc-card`/`.doc-menu` CSS in `styles.css:137-177` for [REQ-UX-017](#req-ux-017) — it already has the card, hover-lift, excerpt-clamp, and overlay-menu affordances required; the work is wiring it to `Write.tsx`'s document list instead of writing new CSS from scratch.

---

## 8. Data and API Impact

This redesign is scoped as **front-end only**. No backend schema or endpoint changes are required for REQ-UX-001 through REQ-UX-020.

- **Optional enhancement (not required for MVP):** a relation "strength"/weight field on `/words/{id}/related` edges would let the force simulation ([§7.1](#71-graph-physics)) tune link distance/strength by actual semantic closeness rather than a uniform default. In its absence, the simulation shall degrade gracefully to uniform edge strength with spacing derived from node degree — visually acceptable, just less differentiated. This is a candidate for a future BRD line item, not a blocker here.
- **REQ-UX-021 (embedding slider)** would require a backend capability to bias/re-rank semantic neighbors against a user-supplied steering vector — out of this SRS's scope; see that requirement's note.

---

## 9. Acceptance Criteria and Validation Plan

The project already has the right test infrastructure in place (`playwright.config.ts`, `playwright.reliability.config.ts`, `@axe-core/playwright`, `vitest`); this redesign extends it rather than introducing a new QA stack.

1. **Automated accessibility:** run the existing axe-core Playwright pass against Discover (all three states: landing/intro, graph expanded, compare mode) and Write (empty, with document, with active suggestion) after the redesign — zero new violations, with particular attention to [NFR-UX-002](#nfr-ux-002)'s contrast-on-glass requirement.
2. **Motion-preference test:** a Playwright run with `prefers-reduced-motion: reduce` emulated shall show the intro, graph transitions, and typing-bar animations all collapse to their static end states with no residual motion.
3. **Graph behavior test:** automate the [REQ-UX-006](#req-ux-006) acceptance criteria directly — assert that a node click preserves prior node IDs in the DOM/state and a new search does not.
4. **Visual regression:** screenshot-diff the Word Card, search box, and a compare box to confirm the shared styling required by [REQ-UX-014](#req-ux-014).
5. **Manual QA checklist:** cinematic intro readability and pacing (subjective — needs a human pass, not automatable); Niramit glyph rendering across at least Windows/macOS/one mobile browser; keyboard-only walkthrough of graph navigation, mode switch, and document switcher.
6. **Undo scoping test:** focus the writing textarea, type, Ctrl+Z → text undo only; blur to the graph, click a node, Ctrl+Z → graph steps back only. Both assertions in one Playwright spec to guard the scoping rule in [REQ-UX-016](#req-ux-016) against regression.

---

## 10. Traceability Matrix

| Brief point | Summary | Requirement(s) |
|---|---|---|
| 1 | Glassmorphism / whitespace / spacing, keep color theme | [REQ-UX-001](#req-ux-001) |
| 2 | Slogan on landing only | [REQ-UX-003](#req-ux-003) |
| 3 | Cinematic opening sequence | [REQ-UX-004](#req-ux-004) |
| 4 | Obsidian-like graph view | [REQ-UX-005](#req-ux-005) |
| 5 | Expand in place vs. collapse-and-reform | [REQ-UX-006](#req-ux-006) |
| 6 | 2/3 graph, 1/3 permanent dictionary panel | [REQ-UX-010](#req-ux-010) |
| 7 | No hover definitions; node = icon + word only | [REQ-UX-007](#req-ux-007), [REQ-UX-012](#req-ux-012) |
| 8 | Remove "ความหมาย — คำ — บริบท" | [REQ-UX-012](#req-ux-012) |
| 9 | Word Card glass + hierarchy, drop `example` | [REQ-UX-011](#req-ux-011) |
| 10 | Niramit font | [REQ-UX-002](#req-ux-002) |
| 11 | Search/Compare segmented mode selector | [REQ-UX-013](#req-ux-013) |
| 12 | Shared box styling, tuned hierarchy | [REQ-UX-014](#req-ux-014) |
| 13 | Full-bleed graph, center always visible | [REQ-UX-008](#req-ux-008) |
| 14 | Remove demo footer, keep professional footer | [REQ-UX-015](#req-ux-015) |
| 15 | Breadcrumb placement | [REQ-UX-009](#req-ux-009) |
| 16 | Ctrl+Z undo everywhere needed | [REQ-UX-016](#req-ux-016) |
| 17 | Visual document create/open/delete | [REQ-UX-017](#req-ux-017) |
| 18 | Minimal required editor feature set | [REQ-UX-018](#req-ux-018) |
| 19 | Satisfying typing feel (Grammarly-like) | [REQ-UX-019](#req-ux-019) |
| 20 | Embedding steering slider | [REQ-UX-021](#req-ux-021) (stretch) |
| 21 | Discover/Write tab transition | [REQ-UX-020](#req-ux-020) |

---

## 11. Risks and Open Questions

All items below were open at the previous draft and have since been resolved by the product owner; each resolution has also been folded into its requirement's text above. Kept here as a decision log.

<a id="q-ux-001"></a>
- **Q-UX-001 — Intro cadence. RESOLVED.** Once per session, and short — see [REQ-UX-004](#req-ux-004)'s updated acceptance criteria (`sessionStorage` flag, target under ~2s). Not once-per-browser/persisted, and not replayed on every reload within the same session.
<a id="q-ux-002"></a>
- **Q-UX-002 — Niramit loading. RESOLVED.** Use Google Fonts' own generated embed (`<link>`/`@import`), the same mechanism the app already uses for its current fonts — no hand-rolled `@font-face`. If that embed doesn't render Thai tone marks/combining vowels acceptably, fall back to the existing `IBM Plex Sans Thai`/`Maitree` pairing rather than shipping a broken primary font. See [REQ-UX-002](#req-ux-002)'s updated technical note. A pre-implementation spot-check across Windows/macOS/Android is still recommended to decide *which* path ships, but the loading mechanism itself is no longer open.
<a id="q-ux-003"></a>
- **Q-UX-003 — Glassmorphism priority. RESOLVED.** Clarity first, modern/"wow" feel second; glassmorphism is one available technique, not a requirement of shipping REQ-UX-001 on every surface — a strong solid/opaque treatment with good spacing, shadow, and motion satisfies the same requirement if blur doesn't clear the [NFR-UX-002](#nfr-ux-002) contrast bar on a given surface. The redesign can ship its first pass without glass anywhere and add it later where it earns its place. REQ-UX-001 and NFR-UX-002 have been reworded to reflect this; downstream requirements that reference "the glass surface tokens from REQ-UX-001" should be read as "whatever surface treatment REQ-UX-001 settles on for that surface."
<a id="q-ux-004"></a>
- **Q-UX-004 — Node cap. RESOLVED.** Not fixed. Product owner is comfortable anywhere in the ~14-20 range (or beyond); the only hard constraint is that raising it must not cost smoothness or usability — settle the actual number empirically against [NFR-UX-001](#nfr-ux-001)'s frame-rate budget and node-overlap legibility, and document the number chosen alongside the measurement that justified it. See [REQ-UX-005](#req-ux-005)'s updated note.
<a id="q-ux-005"></a>
- **Q-UX-005 — View Transitions fallback. RESOLVED (confirmed required).** The CSS opacity/scale fallback described in [§7.2](#72-expandcollapse-transition) is not optional — implement and test it as a first-class path, not an afterthought, regardless of current Safari/Firefox support levels at implementation time.
<a id="q-ux-006"></a>
- **Q-UX-006 — Undo/redo ordering. RESOLVED.** Undo ships first (P1, part of this redesign); redo is explicitly P2/deferred. Structure the undo history so redo is a cheap follow-on rather than a rewrite. See [REQ-UX-016](#req-ux-016).
<a id="q-ux-007"></a>
- **Q-UX-007 — Write/Discover shell.** Still open: [REQ-UX-020](#req-ux-020) was written without visibility into the actual page-shell/router component (not among the files reviewed for this SRS) — confirm the current mechanism before implementing the transition.
- **REQ-UX-021 dependency risk.** Still open, and expected to stay open until scoped separately: this stretch item needs a backend capability this SRS does not scope.

---

## 12. Suggested Rollout Phasing

Ordered so each phase is independently shippable and later phases build on earlier ones rather than blocking on the whole document landing at once.

1. **Foundation** — [REQ-UX-001](#req-ux-001), [REQ-UX-002](#req-ux-002): tokens, spacing scale, glass surfaces, Niramit. Touches every other phase's raw material first.
2. **Graph engine** — [REQ-UX-005](#req-ux-005), [REQ-UX-006](#req-ux-006), [REQ-UX-007](#req-ux-007), [REQ-UX-008](#req-ux-008), [REQ-UX-009](#req-ux-009): the highest-risk, highest-visibility piece; get physics and the expand/collapse feel right before layering the intro on top of it.
3. **Layout and content** — [REQ-UX-010](#req-ux-010), [REQ-UX-011](#req-ux-011), [REQ-UX-012](#req-ux-012), [REQ-UX-013](#req-ux-013), [REQ-UX-014](#req-ux-014), [REQ-UX-015](#req-ux-015): permanent panel, Word Card, mode selector, cleanup — depends on phase 1's tokens and phase 2's graph being full-bleed.
4. **Cinematic intro** — [REQ-UX-003](#req-ux-003), [REQ-UX-004](#req-ux-004): layers cleanly on top of a working, physics-based graph; doing it earlier means re-choreographing it against a graph engine that's still changing shape.
5. **Write page** — [REQ-UX-017](#req-ux-017), [REQ-UX-018](#req-ux-018), [REQ-UX-019](#req-ux-019): largely independent of the Discover-side phases; can run in parallel with phases 2-4 if resourcing allows.
6. **Navigation polish** — [REQ-UX-020](#req-ux-020): naturally last, since it ties together the two finished surfaces.
7. **Stretch** — [REQ-UX-021](#req-ux-021): only after a separate backend-capability scoping pass, per [§8](#8-data-and-api-impact).
