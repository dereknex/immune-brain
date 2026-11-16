# Revisit Synthetic Input Filter (`S4`)

- **Task ID**: `revisit-synthetic-input-filter`
- **Initiative**: `explicit-port-review-and-retro-hygiene` (`Explicit Port Review and Retro Signal Hygiene`)
- **Design risk**: Medium
- **Threat model and supported environment**: Offline analysis of local JSONL session transcripts produced by supported Hosts (`claude`, `antigravity`, `pi`) in trusted workspaces. Security/integrity boundary: preserve raw transcript fidelity and `immune_brain/revisit_evidence/v2` schema completeness (`events[]` keeps Host-injected entries marked `synthetic: true`, `BR-DEC-5`) while preventing Host-injected pseudo-user notifications from distorting human-resume anomaly detection (`F3`).
- **Design views**:
  1. *Event extraction & classification*: `plugins/immune-brain/skills/revisit/scripts/session_evidence.ts:207-248` adds deterministic classification (`synthetic: boolean`) on `user_input` events.
  2. *Candidate & summary aggregation*: `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:374-386,435,450` filters `synthetic: true` entries out of `user_resume` candidates and human `user inputs` totals.
  3. *Contract & verification*: `plugins/immune-brain/dist/revisit.md` documents human vs synthetic `user_input` accounting, and `tests/review-retro-analyzer.test.ts` locks positive/negative/bound classification cases.
- **Execution posture**: Fully disjoint from `S1`–`S3` (`4` files only).

---

## 1. Problem and Evidence (`F3`, `BR-REQ-4`, `BR-DEC-5`)

1. **`user_resume` conflates Host-injected notifications with genuine human prompts (`F3`)**:
   - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:376,384` currently records any `user_input` event immediately following a `turn_end(stop)` (`else if (e.type === "user_input" && state.stop) state.user = e;`) as a `user_resume` candidate, and `:450` counts every `e.type === "user_input"` toward total `user inputs`.
   - In empirical transcripts across `claude`, `antigravity`, and `pi`, the majority of captured entries were Host-injected pseudo-user frames (`<task-notification>`, `"Tool loaded."`, Claude skill directory preambles `"Base directory for this skill:..."`, usage-limit reset notices `"Your claude.ai usage limit has reset."`, `[plan review]`), obscuring genuine human follow-ups (e.g., short `"继续"` turns).
2. **Auditability must not discard events from JSON output (`BR-DEC-5`)**:
   - `Q5=A` confirmed keeping Host-injected `user_input` events in `--json` (`immune_brain/revisit_evidence/v2`) `events[]`, explicitly tagged `synthetic: true`, rather than dropping them before serialization.

---

## 2. Architecture & Design Decisions

Each design decision traces to an exact source requirement (`BR-*`) or explicit delegated technical choice:

- **D1 — Deterministic Classification of Pure Host-Injected `user_input` Entries** *(Source: `BR-REQ-4`, `BR-DEC-5`)*:
  - Extend `SessionEvent` (`type: "user_input"` in `plugins/immune-brain/skills/revisit/scripts/session_evidence.ts:207-248`) with `synthetic: boolean` (default `false` for human input, `true` for pure Host-injected frames).
  - Pure Host-injected frames classified `synthetic: true`:
    - `<task-notification>...</task-notification>` and Host-injected `<...>` system notification envelopes (`<command-name>` / `<local-command-...>` without genuine human instruction body, etc.)
    - `"Tool loaded."`
    - Claude Code skill expansion preambles starting with `"Base directory for this skill:..."` (pure preamble without trailing human instruction text)
    - Usage-limit reset notices (e.g., `"Your claude.ai usage limit has reset."` / rate-limit reset system notices)
    - Automated `[plan review]` / Host continuation notifications (`[plan review due]` / `[plan review]`)
  - Explicit human protection (`BR-REQ-4`): `/skill` command invocations that carry genuine human instructions (and normal short human follow-ups such as `"继续"`) MUST be classified `synthetic: false`.
  - Exact helper/regex decomposition inside `session_evidence.ts` *(delegated technical choice)*.
- **D2 — Exclude `synthetic: true` From `user_resume` Candidates & Human Counts** *(Source: `BR-REQ-4`, `BR-DEC-5`, `F3`)*:
  - Update `review_retro.ts:376,384` so `user_resume` candidates ignore `user_input` events where `e.synthetic === true`.
  - Update `review_retro.ts:450` (and summary text/candidate reporting around `:435`) so `user inputs` reports genuine human `user_input` count (`!e.synthetic`) cleanly (while synthetic count may be reported separately if helpful, never inflated into human resume totals).
  - Update `plugins/immune-brain/dist/revisit.md` (self-owned source per `scripts/dist-sync-manifest.ts`) to document `synthetic: true` preservation in `revisit_evidence/v2` and exclusion from `user_resume` & human input counts.

---

## 3. Agreed Seams & Exact File Scope (`4` paths)

1. `plugins/immune-brain/skills/revisit/scripts/session_evidence.ts` — extend `user_input` `SessionEvent` with `synthetic: boolean` and implement Host-injected pseudo-user classifier preserving `/skill` human instructions as `synthetic: false`.
2. `plugins/immune-brain/skills/revisit/scripts/review_retro.ts` — exclude `synthetic: true` events from `user_resume` candidates (`:376`) and human `user inputs` summary count (`:450`).
3. `plugins/immune-brain/dist/revisit.md` — document `synthetic` flag in `--json` (`immune_brain/revisit_evidence/v2`) and human-only `user_resume` / `user inputs` semantics.
4. `tests/review-retro-analyzer.test.ts` — add fixture-driven unit tests covering Host-injected synthetic entries vs genuine human follow-ups & `/skill` calls, `--json` `events[]` preservation, and `user_resume` + `user inputs` summary counts.

---

## 4. User Scenarios (`BR-SCN-3`)

| ID | Actor | Given | When | Then | Mode | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| `BR-SCN-3` | Maintainer running `/immune-brain:revisit` | Session logs from Claude, Antigravity, or Pi contain `turn_end(stop)` followed by `<task-notification>`, `"Tool loaded."`, `"Base directory for this skill:..."`, usage-limit reset notices, `[plan review]`, `/skill <human instruction>`, and `"继续"` | `session_evidence.ts` extracts events (`--json` `immune_brain/revisit_evidence/v2`) and `review_retro.ts` aggregates candidates and totals | Pure Host-injected entries remain present in `--json` `events[]` with `synthetic: true`, are excluded from `user_resume` candidates and human `user inputs` counts, while `/skill <human instruction>` and `"继续"` carry `synthetic: false` and remain counted | `automated` | `AC1, AC2` |

---

## 5. Acceptance & Controls

- **AC1 (`session_evidence.ts` `synthetic` classification & `revisit_evidence/v2` preservation — `BR-REQ-4`, `BR-DEC-5`, `BR-SCN-3`)**:
  - `session_evidence.ts` marks pure Host-injected pseudo-user entries (`<task-notification>`, `"Tool loaded."`, `"Base directory for this skill:..."`, usage-limit reset notices, `[plan review]`) with `synthetic: true` and keeps them in `--json` (`immune_brain/revisit_evidence/v2`) `events[]`. Genuine human turns and `/skill` calls carrying human instructions are marked `synthetic: false`.
- **AC2 (`review_retro.ts` candidate/total filtering & `revisit.md` contract — `BR-REQ-4`, `BR-SCN-3`)**:
  - `review_retro.ts` excludes `synthetic: true` events from `user_resume` candidates (`:376`) and human `user inputs` counts (`:450`), while continuing to detect genuine human `user_resume` after `turn_end(stop)`; `plugins/immune-brain/dist/revisit.md` documents the rule accurately.

### Done looks like
- Focused test passes (`bun test tests/review-retro-analyzer.test.ts`) plus `bun run typecheck`.
- Positive (`"继续"` and `/skill ...` human prompt remain `synthetic: false` and trigger `user_resume` after `turn_end(stop)`), negative (all 5 Host-injected pseudo-user classes carry `synthetic: true` and produce zero `user_resume` candidates and zero human `user inputs`), and bound (mixed transcript where Host notification precedes human `"继续"` after separate stops, plus `--json` `events[]` length preservation) cases pass.

---

## 6. Devil's Advocate Audit

1. *Could filtering on leading `<` drop a user message that legitimately pastes XML/HTML code?* Guard carefully: match known Host notification wrappers (e.g., `<task-notification>`, `<system-reminder>`, `<local-command-...>`, `<command-name>` without user text) rather than naively discarding arbitrary code snippets starting with `<` when real human text is present; `BR-DEC-5` also guarantees events stay inspectable in `--json` with `synthetic: true` rather than being deleted.
2. *What if a `/skill` call is expanded by Claude Code into `"Base directory for this skill: ..."` on the same user turn or the previous line already emitted `user_input(skill)`?* Pure `"Base directory for this skill:..."` system/skill expansion preamble with no human request payload is `synthetic: true`; `/skill` invocation with human instruction stays `synthetic: false` so human prompt tracking stays accurate.

**False-compromise check**: No false compromise detected — `synthetic: true` distinguishes signal cleanly inside `events[]` without mutating raw log retention (`BR-DEC-5`) and without allowing pseudo-user messages into `user_resume` metrics (`F3`).

---

## 7. Brainstorm Trace

| Item | Ownership | Notes |
| --- | --- | --- |
| `BR-REQ-1..2`, `BR-DEC-1..3`, `BR-OUT-1`, `BR-SCN-1..2` | S1 & S2 | Out of `S4` scope. |
| `BR-REQ-3`, `BR-DEC-4` | S3 | Out of `S4` scope (`F2`). |
| `BR-REQ-4` | **S4** | Core `F3` synthetic pseudo-user classification and filtering across `session_evidence.ts`, `review_retro.ts`, `revisit.md`. |
| `BR-DEC-5` | **S4** | Keep `synthetic: true` events in `--json` (`immune_brain/revisit_evidence/v2`) `events[]`. |
| `BR-OUT-2`, `BR-DEFER-1`, `BR-Q-1` | Excluded / Deferred / Resolved | Out of `S4` scope. |
| `BR-SCN-3` | **S4** (`AC1, AC2`) | Covered in `tests/review-retro-analyzer.test.ts`. |

---

## 8. Completeness and Remaining Gap

- **Covered in S4**: Classifier rules in `session_evidence.ts`, filtering & counts in `review_retro.ts`, documentation in `dist/revisit.md`, and regression fixtures in `tests/review-retro-analyzer.test.ts`.
- **No remaining gap** for `F3` / `BR-REQ-4` / `BR-DEC-5`.

## 9. Rollback

- Revert `S4` changes across the 4 files; no Kernel database or persisted contract state is altered.
