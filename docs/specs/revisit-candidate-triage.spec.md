# Candidate triage for `revisit`

**Status**: Candidate; no execution authority.
**Task ID**: `revisit-candidate-triage` (source issue #336; follow-up to #330).
**Design risk**: Medium — one Skill module (the `revisit` analyzer) changes the shape of its public `--json` candidate list and the text candidate section, and the Skill contract gains one selection rule; no Kernel, record, store or authority behavior changes, and the committed-audit boundary of ADR 0032 is unchanged.
**Design views**: service/component interfaces (the `immune_brain/revisit_evidence/v2` document), data flow (pointed events → candidate chains → grouped candidates → text section or JSON).
**Document language**: English, following Planner's default document policy.

## Outcome

On a real window the analyzer stops emitting one undifferentiated line per candidate occurrence. Candidates arrive grouped by `kind + key` with an occurrence count. The text report shows at most five groups per kind. Resumes after an error or abort are separated from resumes after a normal stop. Each normal-stop resume carries the locating facts an agent needs to triage it, and `sessions[]` lists only sessions with activity in the window. The contract tells the agent how to pick about three groups. This closes the gap between #330's "a few candidates" and the 136 ungrouped chains observed on 2026-11-01.

| Slice | Observable when it has landed | Remaining gap |
|---|---|---|
| `revisit-candidate-triage` | `--json` emits contract `immune_brain/revisit_evidence/v2` with grouped candidates; the text report lists at most five groups per kind with a `+N more groups (see --json)` tail; `error_resume` is split from `user_resume`; `user_resume` chains carry `last_result`, `last_result_is_error`, `last_result_state` and `reply_chars`; `sessions[]` lists only sessions with activity; `dist/revisit.md` carries the selection rule | the manual SCN-3 run that closes #330 (agent judgment over evidence; not automatable) |

## Sources

- **#336** — issue body (https://github.com/dereknex/immune-brain/issues/336). Its sections are cited as `#336-Problem` and `#336-Dn` (Decisions 1–5), plus `#336-Testing`, `#336-Acceptance` and `#336-Out`. The decisions were confirmed by the user in a design interview on 2026-11-01 and are adopted as written. Direct Planner entry; no upstream `clarify` manifest.
- `docs/specs/revisit-evidence-chain.spec.md` — the #330 Spec. This Spec supersedes its D1 (`sessions[]` content and the contract version), its D3 (one candidate per occurrence; `user_resume` covering `error`/`aborted`) and its D4 (the candidate section prints every candidate), and adds to its D7 (Verify selection), in part. That Spec is not edited, because its TaskIntents are terminal and a TaskIntent binds at most one Spec (same reasoning as its own D9).
- Repository evidence:
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:285-322` — `candidates()` pushes one `{ kind, key, pointers }` per occurrence. `user_resume` fires on a `turn_end` with stop reason `stop`, `error` or `aborted` (`:311`), and its key embeds the stop reason (`:316`).
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:328-351` — `sessions.push` runs for every session file that passes the project filter, whether or not it has in-window lines. `session.used` already marks activity and drives the `sessions with activity` header count. The `--json` contract string is `immune_brain/revisit_evidence/v1`.
  - `plugins/immune-brain/skills/revisit/scripts/review_retro.ts:356-359` — the text section prints every candidate as `kind: key pointers…`.
  - `plugins/immune-brain/skills/revisit/scripts/session_evidence.ts:42-49` — the `tool_result` event carries `is_error` and `state`; the `user_input` event carries `chars`.
  - `tests/review-retro-analyzer.test.ts:228-277` — candidate tests build inline sessions with `sessionRoot`/`turn` and assert `Object.keys(c)` equal `["key", "kind", "pointers"]`. Its fixture's resume uses `stopReason: "error"`, so it moves to `error_resume` under this Spec.
  - `tests/rework-root-cause-contract.test.ts:107-110` — asserts the Follow-through Verify sentences of `dist/revisit.md`.
  - `plugins/immune-brain/dist/revisit.md:131` — the `--json` CLI bullet. `:169-175` — the Verify step ("default about three"). `dist/revisit.md` is not a derived file (`docs/agents/derived-files.json` has no `revisit` entry).
  - Consumer check (repository grep, 2026-11-01): outside the revisit scripts and tests, nothing reads `revisit_evidence/v1` or the evidence `candidates`. The two other `candidates` matches, `plugins/immune-brain/runtime/loop_contract.ts:411` and `docs/solutions/workflow.md:705`, are unrelated.
  - Real-window measurement (read-only, 7 days to 2026-11-01T04:07Z, all projects): 136 candidates, of which 112 are `user_resume` over 37 distinct keys, 13 `repeated_block` and 11 `review_without_verdict`; 2262 listed sessions, of which 243 have events. A sample of 10 `user_resume` (one per distinct key, every 4th sorted key) classified as 2 avoidable friction, 4 necessary decisions, 3 error recovery and 1 unknown. All 13 `error`/`aborted` resumes in the window are in the error class by stop reason alone.

## Threat model and supported environment

Unchanged from `docs/specs/revisit-evidence-chain.spec.md`: inputs are the user's own Pi session JSONL files, and there is no hostile adversary. Handled cases are malformed or truncated lines, lines without `id` or `timestamp`, toolResults without a matching call, and non-JSON tool results. Supported: Bun, macOS and Linux, UTF-8 JSONL, the Pi line shape surveyed in that Spec.

## Decisions and technical design

### D1 — Grouped candidates in `revisit_evidence/v2` (source: #336-D1)

`--json` prints `contract: "immune_brain/revisit_evidence/v2"`. All other top-level fields keep their v1 shape and meaning except `sessions[]` (D3) and `candidates[]`. `candidates[]` holds one group per distinct `(kind, key)`:

```
{ kind, key, occurrences, chains: [ { pointers: ["session#line", ...], ...kind fields } ] }
```

- `occurrences` equals `chains.length`. `--json` keeps every group and every chain, with no truncation.
- Each chain keeps its D3 pointers from the #330 Spec (at most five `session#line` strings). No group or chain carries a cause, class or severity field.
- Order: kinds in the fixed display order `repeated_block`, `review_without_verdict`, `batch_oscillation`, `user_resume`, `error_resume`; within a kind, `occurrences` descending, then `key` ascending; chains in event order. The kind order is presentation only and carries no priority. Ordering by `occurrences` helps locate candidates and is not a severity (delegated technical choice; #336-D1).
- The decision text names a group's pointers. This Spec places them on chains, because D2's per-occurrence fields need a per-occurrence record (delegated technical choice; the per-group pointer bound is unchanged).

Rejected alternative: keep one record per occurrence and add a `group` field. Consumers would still need to group, and the text report could not stay short without regrouping anyway.

### D2 — `error_resume` split and `user_resume` locating fields (source: #336-D2)

- The resume chain (`turn_end`, then `user_input`, then a Kernel `tool_call` on the same `task_id` as the last Kernel call before the stop, excluding an applied `request_stop`) is unchanged. Its kind is now chosen by stop reason: `stop` → `user_resume`; `error` or `aborted` → `error_resume`.
- The key of both kinds is `<cwd> / <task_id>`. The stop reason moves out of the key and is now implied by the kind (delegated technical choice).
- A `user_resume` chain adds:
  - `last_result`: the `session#line` of the last `tool_result` event before that `turn_end` in the same session, or `null`.
  - `last_result_is_error`: that result's `is_error`, or `null`.
  - `last_result_state`: that result's `state` when present, else `null`.
  - `reply_chars`: the `chars` of the last `user_input` between the stop and the resume.
- An `error_resume` chain carries pointers only.
- No content filter and no regex over the reply text (#330 RC6; #330 Spec D5).

### D3 — `sessions[]` lists sessions with activity (source: #336-D3)

`sessions[]` lists a session only when `readSession` marks it `used`, the same condition that drives the `sessions with activity` header count. The project and window scope stay in `scope` and `window`.

### D4 — Text candidate section (source: #336-D1)

Under `=== candidate chains (locating only; not causes) ===`, each group prints one line: `<kind>: <key> x<occurrences> <pointers of its first chain>`. At most five groups print per kind, in D1 order. When a kind has more, one line `<kind>: +<n> more groups (see --json)` follows. A kind with exactly five groups prints no such line. The rest of the report order (#330 Spec D4) is unchanged.

### D5 — Selection rule in the contract (source: #336-D4)

`dist/revisit.md` `## Follow-through` step 2 (**Verify**) adds:

> Select the candidate groups that answer the user's question first. When the question points at no specific kind, take the group with the most occurrences of each kind until about three are selected. List every unselected group as not checked. Kinds carry no fixed priority.

The `--json` CLI bullet names the v2 grouped shape and `error_resume`. Everything else in the #330 Spec's D6–D8 is unchanged.

### D6 — Release note (source: #336-D5)

One `immune-brain` `minor` changeset, `.changeset/revisit-candidate-triage.md`, because the public `--json` contract changes version and the text section changes shape.

## User scenarios

Source: #336-Problem and #336-Acceptance (direct entry; confirmed in the 2026-11-01 interview recorded in #336).

- **SCN-1** (automated → AC1, AC3) — Actor: maintainer with an agent. Given a window where one task resumes several times after normal stops and once after an error, when the agent runs `revisit --json`, then it gets one `user_resume` group with `occurrences` equal to the normal-stop resumes, each chain carrying `last_result`, `last_result_is_error`, `last_result_state` and `reply_chars`, and a separate `error_resume` group.
- **SCN-2** (automated → AC2, AC4) — Actor: maintainer. Given a window with more than five candidate groups of one kind and session files with no in-window lines, when they run `revisit`, then the text report shows five groups of that kind and a `+N more groups (see --json)` line, and `--json` lists only sessions with activity.
- **SCN-3** (manual) — Actor: maintainer with an agent. After merge, in Pi, `/revisit` on immune-brain over the 7 days before the merge, asking "where does the workflow make people step in, and what should change first?", passes the seven criteria in #336-Acceptance. The run's own session is then checked through `revisit --json`. Manual reason: the agent's judgment over evidence cannot be asserted by a deterministic test; this Slice tests the analyzer output and the contract text (AC1–AC5).

## Verification and acceptance mapping

| AC | Seam (test file → observable boundary) |
|---|---|
| AC1 | `tests/review-retro-analyzer.test.ts` → `run([... "--json"])`: contract v2, one group per `(kind, key)`, `occurrences` = `chains.length`, chains ≤ 5 pointers, group/chain key sets, D1 order |
| AC2 | `tests/review-retro-analyzer.test.ts` → text candidate section: six groups of one kind print five plus `+1 more groups (see --json)`; exactly five print no tail line |
| AC3 | `tests/review-retro-analyzer.test.ts` → `error`/`aborted` resume is `error_resume`, `stop` resume is `user_resume`, different task is neither; `user_resume` chain fields, including `last_result: null` with no prior result; applied `request_stop` still produces neither |
| AC4 | `tests/review-retro-analyzer.test.ts` → a second session file with only out-of-window lines is absent from `sessions[]`, and `sessions.length` equals the `sessions with activity` header count |
| AC5 | `tests/rework-root-cause-contract.test.ts` → the D5 selection sentences in `dist/revisit.md` Follow-through; grep of the CLI bullet (`revisit_evidence/v2`, `error_resume`) and the `minor` changeset |

Prior art: `tests/review-retro-analyzer.test.ts:228-277` already drives inline sessions through `run()` and checks candidate key sets. That test's `Object.keys(c)` assertion and its `error`-stop fixture are updated, not duplicated. The test at `:261-277` (19 isolated calls, receipt-backed review → no candidates) stays as the negative control for grouping input. Each control fails on the regression it names. AC1 fails if two occurrences of one key produce two records. AC2 fails if truncation drops the tail line or prints a tail at exactly five. AC3 fails if an error resume stays in `user_resume` or a normal-stop resume loses its fields. AC4 fails if an inactive session file is listed.

## Devil's Advocate Audit

- **Rollback resilience**: one PR. Reverting it restores v1 one-per-occurrence candidates and the old `sessions[]`. No Kernel state or persisted file changes, so partial implementation leaves no residue. No consumer of v1 exists outside the revisit scripts and tests (Sources, consumer check).
- **Verification vanity**: every behavior has a negative or bound control: a single occurrence still forms a group of one, exactly five groups print no tail, a different task forms no resume, no prior result gives `null`, and an out-of-window session is not listed. AC5 asserts the new sentence and the v2 CLI wording, so a contract left at v1 fails.
- **Spec dilution**: #336-D1 maps to D1 and D4 → AC1 and AC2; #336-D2 to D2 → AC3; #336-D3 to D3 → AC4; #336-D4 to D5 → AC5; #336-D5 to D6 → AC5. #336-Testing is covered by AC1–AC5. #336-Acceptance maps to SCN-3 (manual). #336-Out stays out: no cross-kind priority (D1 kind order is presentation only) and no exclusion by blocking source (D2 has no content filter).
