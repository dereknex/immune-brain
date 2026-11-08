# Layering rules: shared reference, planner and executor amendments, ADR

**Status**: Candidate; planning only.
**Design risk**: Medium — no runtime module, persisted state, Kernel or Port contract changes, but the change amends shipped instruction contracts (the Planner contract `dist/draw-up.md`, the Executor role prompt, `dist/drive.md`) that every Host loads, and adds a packaged reference with three mirror copies.
**Output language**: English, following the Planner document-language default.
**Threat model and supported environment**: None beyond the repository's own tooling. Inputs are repository-controlled Markdown and TypeScript read from disk; the supported environment is the existing Bun toolchain on macOS/Linux with UTF-8 paths.
**Design views**: service/component interfaces — the reference is one canonical callee and the Planner contract, Executor prompt, drive contract, ADR, and CONTEXT.md are its callers.

## Outcome

Issue #418, absorbing #408 in full and the general rule of #416. The four layering norms — the Dependency Rule, Port slicing, mapping convergence, and the module-documentation format — get one canonical, packaged home in `docs/reference/layering-rules.md` and are recorded as doctrine in a new ADR 0035. The Planner contract makes a candidate state its slicing, dependency direction, ADR prerequisite, and each behavior acceptance's observable done-looks-like next to its agreed seam. The Executor prompt applies the execution norms where Lane Executors actually implement. Enforcement stays with the merged boundary test from #415. No new skill, no new enforcement tool, no runtime change.

No user-visible change: the delivery is instruction text, a reference, an ADR, and a contract test; no command, output, or runtime behavior changes, so there is no scenario section.

## Evidence

| ID | Evidence |
| --- | --- |
| E1 | `CONTEXT.md:268` is the only repository statement of any of the four norms (module documentation). The Dependency Rule, Port slicing, and mapping convergence appear only in issue bodies #413, #416, #417, #418. |
| E2 | Precedent for a packaged shared reference: `scripts/dist-sync-manifest.ts:41` mirrors `reference/code-quality-guard.md`; `tests/code-quality-guard-contract.test.ts:15-26` asserts source/mirror byte equality and the manifest entry; `runtime/prompts/executor.md:99` carries the `## Code Quality Guard` section. |
| E3 | The default single-task entry implements inside the Lane Executor, not in the drive Execution Loop: `plugins/immune-brain/dist/drive.md:116` (`## Execution Loop`) and `:128-131` ("a new single-task entry runs this step inside its Lane's Executor instead"). |
| E4 | Planner contract anchors: `plugins/immune-brain/dist/draw-up.md:570` `## Planning Rules`, `:590` "Agreed seam recording", `:392` `### Verification Descriptor Discipline`, `:683` `## Red Flags`. `dist/draw-up.md` and `dist/drive.md` are the canonical sources (no other source copy). |
| E5 | The Reviewer seam and scenario rules already exist and already grandfather: `runtime/prompts/code-review.md:96-101` ("candidates written before this rule carries no defect for lacking one") and `:103-107` (scenario `Then` at the agreed seam). |
| E6 | Enforcement exists: `tests/runtime-layering-boundary.test.ts:138` locks host-to-host edges to a five-edge baseline, including `.pi-extension` → `runtime/claude/review_host`; the host-selection violation `runtime/claude/kernel_ports.ts:115` is one of those baselined edges (owner #413). #415 is merged. |
| E7 | Generated copies: `docs/agents/derived-files.json:63` lists each Antigravity `dist/docs/reference/*.md` output explicitly, so a new packaged reference needs a new output line; the Antigravity build also copies `dist/draw-up.md`, `dist/drive.md`, `dist/role-prompts/executor.md`, and `runtime/prompts/executor.md` (`derived-files.json:72,74,84,185`). `bun scripts/sync-dist-docs.ts --check` and `bun scripts/build-antigravity-plugin.ts --check` both pass on the current HEAD. |
| E8 | The Planner contract and Executor prompt ship to arbitrary target repositories through the Claude, Pi, and Antigravity packages (`CONTEXT.md:266`), and the Code Quality Guard is written repository-agnostic. |
| E9 | User-facing precedent: `docs/reference/immune-brain-skills-guide.md:72` names the Code Quality Guard reference and what it constrains. |
| E10 | `bun test <file> -t <pattern>` exits 1 when the pattern matches zero tests (Bun 1.4.2, checked locally), so name-filtered descriptors cannot pass vacuously. |
| E11 | ADR numbering: `docs/adr/0034-layered-configuration.md` is the latest; ADR 0004 already carries a dated amendment section (`docs/adr/0004-dual-host-assurance-adapters.md:47`). |

## Decisions and provenance

| ID | Decision | Source |
| --- | --- | --- |
| D1 | Create `docs/reference/layering-rules.md` with sections `## Dependency Rule`, `## Port Slicing`, `## Mapping Convergence`, `## Module Documentation`, `## Execution Order`, and `## Enforcement`. Each norm is stated as a general principle, then instantiated for this repository (Kernel ← Port + coordinator ← Adapter ← CLI/host; adapters `runtime/claude/`, `runtime/antigravity/`, `.pi-extension/`). | BR-REQ-1 |
| D2 | The Planner and Executor rules apply when the target repository declares layers (an architecture map, ADR, or Port/adapter structure); a repository without declared layers incurs no finding. | E8; delegated technical choice: the contracts ship to repositories that have no Kernel or adapters. |
| D3 | Mirror the reference through a `mode: "mirror"` entry in `scripts/dist-sync-manifest.ts`, add its Antigravity output line to `docs/agents/derived-files.json`, and regenerate with `bun scripts/sync-dist-docs.ts` and `bun scripts/build-antigravity-plugin.ts`. | BR-REQ-2, E7 |
| D4 | One contract test, `tests/layering-rules-contract.test.ts`, modeled on E2, with one `describe` block per acceptance so each descriptor filters by name. It includes a small relative-link resolver (self-tested) for the new reference, ADR 0035, and the ADR 0004 amendment. | BR-REQ-3, E10 |
| D5 | `dist/draw-up.md` Planning Rules gains one `**Layering rules**` bullet pointing at the reference: Port slicing by method group with its conformance test; the dependency direction stated in a slice's acceptance; an ADR before a new layer, shared location, or cross-layer dependency; one canonical form plus one subtract-or-pointerize projection per host. | BR-REQ-4 |
| D6 | The #408 rules go directly after the existing "Agreed seam recording" paragraph, not into Verification Descriptor Discipline: each behavior acceptance states an observable done-looks-like beside its agreed seam; an `automated` scenario's `Then` must be observable at its mapped acceptance's named seam, and writing that mapping is mandatory; candidates authored before the rule carry no defect. | BR-DEC-1, E4, E5 |
| D7 | The #416 general rule joins the D5 bullet: new-host work is sliced by Port method group, sequenced seams → state machines → packaging. The per-host slice list (a–e) and per-slice review stay in #416. | BR-DEC-2 |
| D8 | `dist/draw-up.md` Red Flags gains four entries: a cross-adapter import; forked or inherited adapter machinery; a new layer, shared location, or cross-layer dependency without an ADR; mapping to a host form in more than one place. | BR-REQ-5 |
| D9 | `runtime/prompts/executor.md` gains `## Layering Rules` directly after `## Code Quality Guard`: seam first, state machine second, packaging last; share through composition and neutral modules, never inheritance; adapters neither import nor extend each other; scope per D2; the rules live in `docs/reference/layering-rules.md`. | BR-REQ-6, BR-DEC-3, E3 |
| D10 | `dist/drive.md` Execution Loop gains one sentence pointing the in-place implementation step at the same reference and does not restate the rules. | BR-REQ-7, BR-DEC-3 |
| D11 | New `docs/adr/0035-layering-doctrine.md` (status accepted) records the four norms as doctrine, links the reference and the #415 test as enforcement, and names no neutral-core path. ADR 0004 gains `## Amendment: Layering doctrine (2026-11-08)` linking ADR 0035. | BR-REQ-8, BR-DEC-4, BR-DEFER-1, E11 |
| D12 | `CONTEXT.md:268` becomes a one-line navigation pointer to the reference's Module Documentation section; the definition text moves to the reference. | BR-REQ-9 |
| D13 | The reference's Enforcement section cites `tests/runtime-layering-boundary.test.ts` and its five-edge baseline, and states that the host-selection edge at `runtime/claude/kernel_ports.ts:115` stays baselined under #413. | BR-DEC-5, E6 |
| D14 | `docs/reference/immune-brain-skills-guide.md` gains one sentence beside the Code Quality Guard sentence naming the layering reference and what it constrains; add a patch changeset. | E9; delegated technical choice: keep user-facing docs consistent with shipped prompt behavior. |

## Technical Design

**Component interfaces.** The reference is the single callee; consumers point at it rather than restating it.

| Caller | Consumes | Owns |
| --- | --- | --- |
| `dist/draw-up.md` Planning Rules, Red Flags | Planner obligations (D5–D8) | Candidate shape; no execution rule |
| `runtime/prompts/executor.md` | Execution Order and the adapter rules (D9) | Implementation choices inside the enrolled scope |
| `dist/drive.md` Execution Loop | Pointer only (D10) | Nothing new |
| ADR 0035 | All four norms as doctrine (D11) | Decision record; the reference stays the operational text |
| `CONTEXT.md` | Pointer only (D12) | Vocabulary and navigation |

- Inputs and outputs: Markdown text only. Errors: a missing mirror, a stale Antigravity copy, or a broken relative link fails the contract test or the two sync checks.
- Compatibility: additive text. Existing TaskIntents and Specs gain no defect (D6 grandfathering, E5). No schema, parser, or verdict change.
- Invariants: (I1) the canonical reference and every packaged copy are byte-identical; (I2) each consumer references the reference path; (I3) `CONTEXT.md` and `dist/drive.md` do not restate the rules; (I4) no neutral-core path is named before #414.

## Devil's Advocate Audit

- **Rollback resilience**: every change is text in tracked files plus one test. A partial implementation either fails the contract test (missing consumer, copy drift) or the sync checks; reverting the commit restores the prior contracts with no state to migrate.
- **Verification vanity**: textual presence proves the contract says the rule, not that a model obeys it (draw-up Environment and prerequisite discipline). The acceptances claim only the former; obedience is observed later through Review (#409/#412). The byte-equality and link checks fail on the real regressions this change can cause: drift between canonical and packaged copies and dangling links.
- **Spec dilution**: every `BR-*` item maps below. #408 is absorbed in full (D6); #416 keeps only its host-specific list, recorded as BR-DEC-2. D2 narrows applicability only to repositories that declare layers, which is where every rule has a referent; the immune-brain instance keeps full force.

## Acceptance and verification mapping

| AC | Seam | Controls |
| --- | --- | --- |
| AC1 | `tests/layering-rules-contract.test.ts` › `reference`: the reference file, its packaged mirror, its Antigravity copy, and the manifest | Positive: six section headings present; Module Documentation keeps "without a Verification command is incomplete"; Enforcement names `tests/runtime-layering-boundary.test.ts`; three copies byte-equal; manifest has `{ rel: "reference/layering-rules.md", mode: "mirror" }`. Negative: the link resolver reports a fixture link to a missing file. Bound: `http(s)` URLs and same-file `#anchor` links are not resolved. |
| AC2 | Same file › `planner`: `dist/draw-up.md` and its Antigravity copy | Positive: Planning Rules contains the Layering rules bullet with the reference path, Port method group, dependency direction, ADR, projection, and seams → state machines → packaging; the paragraph after "Agreed seam recording" contains "done-looks-like", the mandatory scenario mapping, and the grandfathering clause; Red Flags names the four entries. Negative: the Verification Descriptor Discipline section does not contain "done-looks-like". Bound: Antigravity `dist/draw-up.md` is byte-equal. |
| AC3 | Same file › `executor`: `runtime/prompts/executor.md`, its three packaged copies, and `dist/drive.md` | Positive: `## Layering Rules` follows `## Code Quality Guard` and states the order, composition over inheritance, no adapter import or extension, and the reference path; the drive Execution Loop names the reference path. Negative: `dist/drive.md` does not contain "never inheritance"; `qa.md` and `ui-review.md` prompts do not contain "Layering Rules". Bound: `dist/role-prompts/executor.md`, Antigravity `dist/role-prompts/executor.md`, Antigravity `runtime/prompts/executor.md`, and Antigravity `dist/drive.md` are byte-equal to their sources. |
| AC4 | Same file › `doctrine`: ADR 0035, ADR 0004, `CONTEXT.md`, the skills guide | Positive: ADR 0035 is accepted, names the four norms, and links the reference and ADR 0004; ADR 0004 has the amendment linking ADR 0035; `CONTEXT.md` links the reference; the skills guide names the reference. Negative: `CONTEXT.md` no longer contains "without a Verification command is incomplete"; ADR 0035 and the reference contain no `runtime/core` or `runtime/neutral` path. Bound: all relative links in ADR 0035 and the ADR 0004 amendment resolve. |

Final local checks for the Executor, not acceptance: `bun scripts/sync-dist-docs.ts --check`, `bun scripts/build-antigravity-plugin.ts --check`, `bun test tests/code-quality-guard-contract.test.ts tests/dist-docs-sync-contract.test.ts tests/antigravity-host-package.test.ts`.

## Brainstorm Trace

| Item | Mapping |
| --- | --- |
| BR-REQ-1 | D1, D2; AC1 |
| BR-REQ-2 | D3; AC1 |
| BR-REQ-3 | D4; AC1–AC4 |
| BR-REQ-4 | D5; AC2 |
| BR-REQ-5 | D8; AC2 |
| BR-REQ-6 | D9; AC3 |
| BR-REQ-7 | D10; AC3 |
| BR-REQ-8 | D11; AC4 |
| BR-REQ-9 | D12; AC4 |
| BR-DEC-1 | D6; AC2. The delivering PR closes #408. |
| BR-DEC-2 | D7; AC2. #416 stays open for its slice list and per-slice review. |
| BR-DEC-3 | D9, D10; AC3 |
| BR-DEC-4 | D11; AC4 |
| BR-DEC-5 | D13; AC1 |
| BR-OUT-1 | Out: no new skill; `dist/registry.yaml` and `skills/` unchanged. |
| BR-OUT-2 | Out: `runtime/prompts/code-review.md` unchanged (#409, #412). |
| BR-OUT-3 | Out: `dist/clarify.md` unchanged (#403). |
| BR-OUT-4 | Out: no runtime import change (#413), no neutral-core extraction (#414), no canonical packet (#417). |
| BR-OUT-5 | Out: no new enforcement tool or dependency; no Kernel, Port, or verdict change. |
| BR-DEFER-1 | Deferred to #414: D11 and AC4 keep the neutral-core path unnamed. |
| BR-Q-1 | Resolved by BR-DEC-1, BR-DEC-2. |
| BR-Q-2 | Resolved by BR-DEC-3. |

## Rollback

Revert the delivering commit. The contract test, reference, ADR 0035, and their copies disappear together; ADR 0004, `CONTEXT.md`, the Planner contract, and the Executor prompt return to their prior text. No runtime or persisted state is involved.
