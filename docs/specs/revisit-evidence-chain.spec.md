# Evidence-chain diagnosis for `revisit`

**Status**: Candidate; no execution authority.
**Initiative**: `revisit-evidence-chain` (source issue #330; follow-up to #322).
**Task IDs**: `revisit-evidence-chain-s1-evidence-output`, `revisit-evidence-chain-s2-diagnosis-contract`.
**Design risk**: Medium — one Skill module (the session reader) gains a machine-readable output and candidate-chain listing, and the Skill contract changes its method; no Kernel, record, store or authority behavior changes, and the committed-audit boundary of ADR 0032 is unchanged.
**Design views**: data flow (session JSONL → line-level events with pointers → call↔result links → candidate chains → text report or JSON document), service/component interfaces (the `--json` evidence document and the `--since`/`--until` window flags).
**Document language**: English, following Planner's default document policy.

## Outcome

`revisit` stops being a session statistics report and becomes an evidence-based diagnosis of Immune-Brain workflow friction: read-only inspection of one fixed window of real run evidence that locates avoidable process friction, separates it from necessary user decisions and valid quality catches, and recommends at most one smallest improvement, or says the evidence is insufficient. One flow: locate → verify → recommend.

Slice results:

| Slice | Observable when it alone has landed | Remaining gap after it |
|---|---|---|
| S1 | The analyzer reads user, assistant and toolResult lines; `--json` emits one evidence document with a fixed absolute window, scope, line-level pointers, call↔result links and candidate chains; `--since`/`--until` reproduce a window; the text report leads with candidate chains and moves usage, the tool histogram and `rounds/task` to an appendix; regex labels print as unverified markers; regression cases 1–3 are pinned in tests | the contract still prescribes the old Report order and a copy-ready draft per candidate; `SKILL.md` has no follow-through route |
| S2 | `SKILL.md` routes cause / friction / improvement questions to the follow-through method; `dist/revisit.md` carries locate → verify → recommend, source roles, the new Report order and the judgment rules for regression cases 1–2 and 5–6; the per-candidate copy-ready draft is retired; README and registry follow | none inside this Initiative |

## Sources

- **#330** — issue body (https://github.com/dereknex/immune-brain/issues/330). Sections are cited as `#330-Problem`, `#330-Direction`, `#330-CDn` (Candidate decisions 1–6), `#330-RCn` (Regression cases 1–6), `#330-Kept`, `#330-Order`, `#330-Out`. Direct Planner entry; no upstream `clarify` manifest. The issue is the user's own proposal; its candidate decisions are adopted as written and the technical shape below is delegated.
- **PR #329** (merged as `4abfcdb`) — applies the observed Review receipt to a verdict-less `submit_review`, adds the toolResult branch to `readSession`, and pins `#330-RC4` in `tests/review-retro-analyzer.test.ts`. S1 builds on its reader shape (`review_retro.ts:146-152`).
- Repository evidence:
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:152` — `if (m.role !== "assistant") continue;` drops every user and toolResult line.
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts` `SessionEvent` type — `SessionEvent` carries `author`/`key`/`taskId`/`summary` only.
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:263` — `cutOf(days)` derives the window from `Date.now()`, so two runs never share a window.
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:31,37,197` — `BOOKKEEPING` and `JITTER` regexes; `findingEvent` lets `BOOKKEEPING` overwrite the structured `kind`.
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:477-507` — report order: usage and tool histogram, then `rounds/task`, then findings.
  - `plugins/immune-brain/skills/revisit/SKILL.md:24-25` — routes only "running the analyzer" and "interpreting the report".
  - `plugins/immune-brain/dist/revisit.md` `## Report` (order usage → rework → findings → bullets) and `## Follow-through` step 8 (copy-ready TaskIntent or issue draft per candidate).
  - `tests/rework-root-cause-contract.test.ts:78-102` — locks the per-task aggregation sentences, the cross-boundary trace, the fix ladder and the copy-ready draft sentence.
  - `tests/review-retro-analyzer.test.ts:30-60` — `run()` drives committed fixtures under `tests/fixtures/review-retro/`; the `sessionRoot`/`turn` helpers build inline sessions.
  - `tests/review-retro-audit.test.ts:351-367` — pins the audit "infrastructure jitter" label; `tests/rework-root-cause-contract.test.ts:83` pins the matching `dist/revisit.md` sentence, which S2 relabels.
  - `tests/pi-canary-packed-loader.test.ts:58-60` — exact packed-file list for the `revisit` Skill scripts.
  - `tests/skill-dist-consistency.test.ts:82` — trigger tuple `["revisit", …, "workflow-health retro"]`.
  - `plugins/immune-brain/skills/registry.yaml:68-76`, `README.md:127,427,484-487` — public descriptions name usage, rework signal and finding totals.
  - `docs/specs/revisit-workflow-health.spec.md` D6 — the copy-ready draft rule this Initiative supersedes in part.
  - `docs/plans/review-verifier-eval-s1-metrics.intent.json` — RVE-S1 reads the `author` event field; it stays.
  - Line-shape survey of Pi session logs (read-only, 2026-10-30): every line carries `id`, `parentId`, `timestamp`, `type`; `message.role` is `user`, `assistant`, `toolResult` or `system`; a `toolCall` content item carries `id`; a toolResult carries `toolCallId`, `toolName`, `isError`; an assistant message carries `stopReason` (`toolUse`, `stop`, `error`, `aborted` observed). A Skill invocation arrives as one user text item `<skill name="…" location="…">…</skill>` followed by the user's own instruction. `imm_kernel_canary` `request_stop` results carry `"state": "applied"`, `"lifecycle": "stopped"` and `task_state.run_id`.
  - `plugins/immune-brain/runtime/unattended/batch_preflight.ts:122`, `batch_lanes.ts:648` — batch records carry `batch_id` and `batch_state` (`running`, `needs_human`, `completed`, …).

## Threat model and supported environment

Inputs are the user's own Pi session JSONL files and, unchanged from ADR 0032, the committed `.imm/audit/**` of one named repository. No hostile adversary; handled cases are malformed or truncated lines, lines without `id` or `timestamp`, toolResults without a matching call, and tool results that are not JSON. Supported: Bun as the analyzer runtime; macOS and Linux; UTF-8 JSONL; the Pi line shape surveyed above. Claude Code session logs are out of scope (#330-Out).

## Decisions and technical design

### D1 — Evidence document on the existing reader (source: #330-CD1)

`review_retro.ts --json` prints one JSON document to stdout instead of the text report. No second copy of sessions, no database, no file written by the analyzer. The session reader moves into `scripts/session_evidence.ts` (delegated technical choice: keeps `review_retro.ts` the CLI and report owner and lets tests import the reader without the CLI); `review_retro.ts` re-exports `readSession` so existing imports keep working.

Document shape (`contract: "immune_brain/revisit_evidence/v1"`):

- `window`: `{ since, until }` as absolute ISO-8601 UTC strings; `scope`: `{ root, project, exclude }`; `skipped_lines`.
- `sessions[]`: `{ path, cwd, session_id }`.
- `events[]`, in file order per session. Every event carries a pointer: `session` (path), `line` (1-based), `entry_id` (the line's `id`, or `"unknown"`), `timestamp` (ISO), `role`, `cwd`, `task_id` and `run_id` (the literal `"unknown"` when the line and its linked call carry none). Kinds:
  - `user_input` — every `role: "user"` line. `skill` is the `name` of a leading `<skill …>` block or `null`; `instruction` is the text outside skill blocks, trimmed and capped at 240 characters; `chars` is the full text length.
  - `tool_call` — one per `toolCall` item: `tool_call_id`, `name`, `op` (Kernel `action.op` when present), `author` (kept for RVE-S1).
  - `tool_result` — one per `toolResult` line: `tool_call_id`, `call_line` (the line of the matching `tool_call`, or `null` when unmatched), `is_error`, and, when the result text parses as JSON, `state`, `lifecycle`, `batch_id`, `batch_state`.
  - `turn_end` — an assistant message whose `stopReason` is not `toolUse`: `stop_reason`.
  - `review`, `registration`, `finding` — as today, with the pointer added. A `finding` keeps the structured `kind` from the verdict or receipt and adds `markers` (D5).
- `candidates[]` (D3).

Call↔result linking is by `toolCallId` within one session. `task_id`/`run_id` on a result are taken from its call's arguments, then from the result JSON (`task_id`, `task_state.run_id`); otherwise `"unknown"`.

### D2 — Fixed window (source: #330-CD1 "every follow-up query in one analysis reuses this window")

`--since <iso>` and optional `--until <iso>` replace `<days>`; `<days>` stays and resolves to `since = now − days`, `until = now`, both captured once at start. The text header and the JSON `window` print absolute `since`/`until`, so a follow-up passes them back and reads exactly the same lines. A line is in the window when `since ≤ t < until`. Usage errors: `<days>` together with `--since`; `--until` without `--since`; an unparsable ISO value; `until ≤ since`. `--audit` applies the same window to `terminalized_at`.

### D3 — Candidate chains locate, never explain (source: #330-Direction step 1, #330-CD5)

The analyzer lists candidate chains, each `{ kind, key, pointers[] }` with up to five `session#line` pointers and no cause, class or severity field. Kinds:

- `repeated_block` — the same `(cwd, task_id)` receives a blocking finding with the same `acceptance_id` in two or more distinct registrations.
- `review_without_verdict` — a `submit_review` with no explicit verdict and no unconsumed observed receipt (PR #329 semantics).
- `batch_oscillation` — the same `batch_id` is observed entering `batch_state: "needs_human"` two or more times, with another state in between.
- `user_resume` — a `turn_end` (`stop`, `error` or `aborted`), then a `user_input`, then a Kernel `tool_call` on the same `task_id` as the last Kernel call before that `turn_end`. The candidate carries the stop reason; it never labels the stop premature (#330-RC5).

A `request_stop` call whose result reports `state: "applied"` produces `stop_applied` on its `tool_result` and is never part of a `user_resume` chain (#330-RC2). Human input is counted only from `user_input` events; tool calls are never counted or described as human confirmations (#330-RC1).

### D4 — Report order (source: #330-CD3)

The text report prints, in order: the header (absolute window, scope, skipped lines, 口径 line); `=== candidate chains (locating only; not causes) ===` with each candidate's kind, key and pointers; `user inputs: <n>`; finding totals; then `=== appendix: locating context (never a cause) ===` holding usage, the tool histogram and `rounds/task`.

### D5 — Regex labels are unverified markers (source: #330-CD5)

`BOOKKEEPING` and `JITTER` keep their patterns but no longer rename structured data. A `finding` keeps its verdict `kind`; a match adds `markers: ["bookkeeping"]`. Text totals print `blocking: <n> | advisory: <n> | bookkeeping marker (unverified): <n>`; marker matches stay out of `blocking`/`advisory` as today, so totals do not move. The audit Candidate improvements section relabels "infrastructure jitter" as "jitter marker (unverified)" with unchanged membership. S1 changes the analyzer output and its tests; the matching `dist/revisit.md` sentence is relabeled in S2.

### D6 — Sources keep their roles (source: #330-CD2)

Contract rule: sessions show human interaction, failures and recovery; committed audit (`--audit`, ADR 0032) confirms terminal state, formal findings and assurance history. Neither is used to prove what only the other records.

### D7 — Follow-through becomes locate → verify → recommend (source: #330-Direction, #330-CD4)

`dist/revisit.md` `## Follow-through`:

1. **Locate** from the candidate chains; counts, short-message matches and repeated acceptance ids only locate.
2. **Verify** selected candidates (default about three): rebuild `prior state → actual stop/failure → user/Host action → next state` from evidence pointers; classify as necessary decision, valid quality catch, avoidable process friction, or unknown; state which candidates were checked and which were not. Full per-round tables and reading every finding apply only to the selected candidates, or when the user asks for a full retro.
3. **Recommend** at most three findings, each `observation → causal evidence → counterexample or unknown → direction`, and one recommended next step or an explicit "not enough evidence to change anything". A copy-ready TaskIntent or issue draft is written only on request.

Kept: the cross-boundary trace, rejection-test questions, historical resolved ≠ current bug, the fix ladder (architecture > types > lint > test > docs), report-only (`revisit` creates no issue, TaskIntent, branch or commit, and never resumes a stopped managed run), no bypass of assurance (#330-Kept). The per-task aggregation sentences locked at `tests/rework-root-cause-contract.test.ts:78-85` stay, scoped to selected candidates.

Judgment rules carried in the contract: a tool call is never a human confirmation (RC1); `request_stop` is read with its result (RC2); a long user message carrying a Skill plus an instruction is human input (RC3); resuming after a quota error or tool interruption is not judged a premature stop on "continue" alone (RC5); whether a stop was unjustified is semantic judgment over the pointed context, never a regex (RC6).

### D8 — Report and routing (source: #330-CD3, #330-CD6)

`## Report`: the workflow answer leads (findings and the one recommendation, or "not enough evidence"); usage, the tool histogram and `rounds/task` follow as an appendix and are never used as a cause. Window and project scope are asked once and reused for follow-up questions through `--since`/`--until`. `SKILL.md` adds a route for cause / friction / how-to-improve questions to `## Follow-through` and `## Report`. The description becomes a workflow-friction diagnosis while keeping the phrase "workflow-health retro" so the explicit trigger tuple holds.

### D9 — Supersession and release notes (source: #330-CD4; delegated technical choice)

This Spec supersedes `docs/specs/revisit-workflow-health.spec.md` D6 in part (the per-candidate copy-ready draft); that Spec is not edited, because a TaskIntent binds at most one Spec and the #322 intents are terminal. Each Slice adds one `immune-brain` `minor` changeset, because each changes the public `revisit` output or method.

## Follow-up (not in this Initiative)

Snapshot/diff (#322 S4), Claude Code session reader, multi-agent orchestration, dashboards (#330-Out). Removing existing output fields waits for a consumer check; `author` stays for RVE-S1.

## Brainstorm Trace

No upstream manifest. #330 items map as follows:

| #330 item | Mapping |
|---|---|
| Problem 1 (non-assistant lines skipped) | D1 → S1 AC1, AC3 |
| Problem 2 (no pointers) | D1 → S1 AC1 |
| Problem 3 (verdict-less `submit_review`) | covered by merged PR #329; D3 `review_without_verdict` → S1 AC5 |
| Problem 4 (no follow-through route) | D8 → S2 AC1 |
| Problem 5 (stats-first order, copy-ready volume) | D4 → S1 AC6; D7, D8 → S2 AC3, AC4 |
| Direction (locate → verify → recommend) | D3 → S1 AC5; D7 → S2 AC2, AC3 |
| CD1 evidence output | D1, D2 → S1 AC1, AC2 |
| CD2 sources keep roles | D6 → S2 AC4 |
| CD3 report order | D4 → S1 AC6; D8 → S2 AC4 |
| CD4 supersede #322 D6 in part | D7, D9 → S2 AC3, AC6 |
| CD5 regex → unverified markers | D5 → S1 AC7; D7 → S2 AC5 |
| CD6 routing | D8 → S2 AC1 |
| RC1 batch calls ≠ confirmations | D3 → S1 AC3; D7 → S2 AC5 |
| RC2 `request_stop` applied ≠ stall | D3 → S1 AC4; D7 → S2 AC5 |
| RC3 Skill + instruction = human input | D1 → S1 AC3 |
| RC4 receipt findings once | PR #329 test, kept green by S1 (existing test unchanged) |
| RC5 resume after quota/tool error | D3 pointers → S1 AC5; D7 → S2 AC5 |
| RC6 stop judgment is semantic | D7 → S2 AC5 |
| Kept unchanged | D7 Kept list; no boundary edit in either Slice |
| Suggested order | S1 (evidence + regression tests) blocks S2 (Skill + contract) |
| Out of scope | Follow-up |

## User scenarios

Source: #330-Direction and #330-RC1–RC3 (direct entry; scenarios are Spec-local).

- **SCN-1** (S1, automated → S1 AC1, AC2) — Actor: maintainer with an agent. Given Pi session logs, when the agent runs `revisit` with `--json`, then it gets one document with an absolute window, scope, pointed events and call↔result links, and a follow-up run with the same `--since`/`--until` reads exactly the same lines.
- **SCN-2** (S1, automated → S1 AC3, AC4, AC5) — Actor: maintainer. Given a window containing a batch driven by many Kernel calls, a Skill-wrapped instruction and an applied `request_stop`, when they run `revisit`, then the report counts no tool call as human input, counts the Skill-wrapped message as one user input, does not list the applied stop as a stall, and lists candidate chains with pointers and no causes.
- **SCN-3** (S2, automated → S2 AC1) — Actor: maintainer. Given `/revisit`, when they ask where the workflow makes people step in and what to change first, then the Skill routes to the follow-through method rather than only report reading.
- **SCN-4** (S2, manual) — Actor: maintainer with an agent. Given the S1 evidence document, when the agent follows locate → verify → recommend, then the write-up leads with at most three findings in `observation → causal evidence → counterexample or unknown → direction` form and one recommendation or "not enough evidence", states which candidates were checked, and puts usage and `rounds/task` in an appendix. Manual reason: the agent's judgment over evidence cannot be asserted by a deterministic test; only the contract text is tested (S2 AC2–AC5).

## Verification and acceptance mapping

| Slice | AC | Seam (test file → observable boundary) |
|---|---|---|
| S1 | AC1 | `tests/review-retro-analyzer.test.ts` → `run([... "--json"])` document: contract, window, scope, pointers, `"unknown"` ids, call↔result link, unmatched result `call_line: null`, `author` kept |
| S1 | AC2 | `tests/review-retro-analyzer.test.ts` → `run()` with `--since`/`--until`: boundary lines in/out, byte-identical repeat, four usage errors |
| S1 | AC3 | `tests/review-retro-analyzer.test.ts` → `user_input` events and `user inputs: <n>`: Skill+instruction, Skill-only, 19 Kernel calls with no user line |
| S1 | AC4 | `tests/review-retro-analyzer.test.ts` → `request_stop` applied: `stop_applied`, no `user_resume` |
| S1 | AC5 | `tests/review-retro-analyzer.test.ts` → `candidates[]` per kind, one positive and one negative control each |
| S1 | AC6 | `tests/review-retro-analyzer.test.ts` → text report section order |
| S1 | AC7 | `tests/review-retro-analyzer.test.ts`, `tests/review-retro-audit.test.ts` → marker labels, structured `kind` kept, totals unchanged |
| S1 | AC8 | `tests/pi-canary-packed-loader.test.ts` → packed tarball ships `session_evidence.ts`; grep of the `dist/revisit.md` CLI and the changeset |
| S2 | AC1–AC5 | `tests/rework-root-cause-contract.test.ts` → `SKILL.md` and `dist/revisit.md` contract text |
| S2 | AC6 | `tests/skill-dist-consistency.test.ts` → description trigger and dist mirror; grep of README, registry and the changeset |

Prior art: `tests/review-retro-analyzer.test.ts` already builds inline sessions with `sessionRoot`/`turn` and drives `run()`; PR #329 adds the toolResult fixture pattern. Each S1 control fails on the regression it names: AC3's 19-call fixture fails if any tool call is counted as input; AC4 fails if an applied stop enters a `user_resume` chain; AC5's negative controls fail if a single registration, a receipt-backed submit, one `needs_human` entry or a stop without a same-task resume produces a candidate.

## Devil's Advocate Audit

- **Rollback resilience**: each Slice is one PR. Reverting S1 restores the assistant-only reader and old report; S2 references only `--json`, `--since`/`--until` and the candidate kinds, so S2 must revert with or after S1, never alone before it — the serial order enforces that. Neither Slice touches Kernel state, so partial implementation leaves no persisted residue.
- **Verification vanity**: every S1 acceptance has a negative control (D3 kinds, unmatched result, window bounds, usage errors). Totals unchanged by D5 are pinned by the existing `blocking: 1 | advisory: 1` assertions with the label updated, so a silent count change fails. S2 tests assert both the new sentences and the absence of the retired copy-ready sentence, so a half-rewritten contract fails.
- **Spec dilution**: every #330 item maps in the Brainstorm Trace; RC4 is covered by the merged PR #329 test, which S1 keeps green; RC5–RC6 stay agent judgment as the issue states, with S1 supplying the pointers they need.
- **Cross-initiative ordering**: S1 and S2 both edit `review_retro.ts`/`dist/revisit.md`/the analyzer test; they run serially. RVE-S1 also edits `review_retro.ts` and must not share a batch with S1.
