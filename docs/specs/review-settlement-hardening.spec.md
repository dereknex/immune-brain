# Review Settlement Hardening

## Status, ownership, and outcome

This is the shared candidate Spec for Initiative `review-settlement-hardening`, a three-Slice plan. The user confirmed the Initiative name, slug, the three-Slice decomposition and its dependencies, and adopted every recommended decision from the Brainstorm retrospective of Claude session `6f45be21-a028-4fbe-a93a-0f601b248ef7`. It grants no execution authority; each TaskIntent still requires the current Host's native Enrollment gate.

Outcome: on the Claude Host, a rejected `submit_review` tells the agent exactly how to recover; the Parent cannot rewrite the reviewer prompt and still settle; and a Review `pass` that did not inspect every changed path cannot settle.

Carrier: one GitHub Parent with three native Sub-issues (repository default `Initiative carrier default: github`). Execution is S1 first; S2 and S3 are independent of each other and both follow S1.

**Design risk**: High. S3 changes the shared Review verdict contract consumed by the host-neutral coordinator, the Claude Host and two Pi extension call sites. S1 and S2 are Medium on their own: they change Claude Host review-binding behavior and packaged contract prose, without Kernel authority or persisted state.

**Design views**: service interface (the `submit_review` result and the verdict payload are the whole change) and state transitions (which rejections release a Review reservation and which keep it). Architecture layers, data flow and temporal sequence are omitted: module ownership, the evidence pipeline and hook event ordering are unchanged.

**Diagram decision**: not_required

**Diagram reason**: each Slice changes one predicate or one payload field; the reservation states and their recovery are fully expressed by the table under S1.

**Execution posture**: test-first. Each Slice's acceptance is a set of negative controls that pass vacuously unless the test exists before the runtime change.

## Evidence and discovery closure

Observed in the reviewed session (Immune-Brain 4.4.1 driving another repository): `submit_review` was rejected three times. The first reason was `duplicate SubagentStop observed for review reservation`, after the Parent continued the same reviewer through `SendMessage`. The next two were `async Agent transcript carries no reviewer result`; that transcript-reader defect is already fixed and released in 4.6.0 and is not part of this plan. Between rejections the agent attributed the asynchronous launch receipt to a host configuration fault and offered `repair_authority_state` and committing first as options. In the same session the Parent dispatched a reservation's prompt with an appended paragraph, and later with a body rewritten from 10,551 to 4,706 characters; both bound. Two of three `pass` reports stated that the test files had not been read.

Current behavior, read from the repository:

- `plugins/immune-brain/runtime/claude/kernel_ports.ts` `submitClaudeReview`: an observation failure returns `{ state: "blocked", reason }` (retained reservation) or `coordinator.abandonReview` (released reservation); a parent/receipt mismatch returns `{ state: "blocked", reason }`. None carries a recovery action. `AssuranceSubmitReviewResult` in `plugins/immune-brain/runtime/assurance/coordinator.ts` has no such field on its `blocked` variant.
- `plugins/immune-brain/runtime/claude/review_host.ts`: `inspectReviewForTask` produces seven distinct failure reasons with a `release` flag; `applyReviewEvent` sets three `state.error` reasons (second native tool call, duplicate `PostToolUse`, duplicate `SubagentStop`), all released. No test exercises the three `state.error` paths.
- `review_host.ts` `bindsStart`: a prompt carrying the `<!-- immune-brain:operation_id=… task_id=… -->` marker binds when the two identifiers match; the body is not compared. Only a prompt without a marker is compared for equality.
- `review_host.ts` documents that every Claude `Agent` call is asynchronous and that `run_in_background: false` is not honoured, while `plugins/immune-brain/dist/imm-loop.md` states "All internal Agent envelopes use `run_in_background: false`." Neither the Loop contract nor `plugins/immune-brain/agents/immune-brain-reviewer.md` forbids continuing a reviewer.
- `coordinator.ts` `parseAssuranceVerdict` accepts a `pass` with `approval` limited to `kind`, `authority_role` and `summary`. It is shared by the QA and Review roles. The reviewed change set is available to the coordinator from the Review evidence (`changed_paths` for a Git review revision, `dirty_files` for a legacy bundle).
- The Review revision's `changed_paths` is built in `plugins/immune-brain/runtime/workspace_scope.ts` from staged in-scope paths that differ from the Enrollment base. A Spec staged before Enrollment and not edited afterwards is therefore not a changed path. This closes Brainstorm question BR-Q-1: the reviewer in the session could not find the Spec for that reason, and the S3 required set is the reviewed change set, not the Spec.
- `tests/claude-review-host-async-agent.test.ts` already settles a reservation from a handed-back report through hook events. This closes BR-Q-2: no further end-to-end test of the 4.6.0 fix is planned; the uncovered `state.error` paths are covered by S1.

Consumers and mirrors:

- `parseAssuranceVerdict` is called from `coordinator.ts` (`submitReviewOnce`, `isReviewVerdictValid`), and from `plugins/immune-brain/.pi-extension/imm-canary-work.ts` and `plugins/immune-brain/.pi-extension/pi-canary-assurance-progression.ts`. `kernel_ports.ts` compares the parent verdict with the reviewer receipt by fingerprint after both validate.
- `plugins/immune-brain/dist/claude/mcp-server.mjs` inlines the runtime; rebuild with `bun scripts/build-claude-plugin.ts`. `tests/claude-host-package.test.ts` checks the bundle and the packaged reviewer definition.
- `plugins/immune-brain/dist/imm-loop.md` is its own authoring source (`scripts/dist-sync-manifest.ts`); contract tests that read it include `tests/managed-authority-failure-contract.test.ts`, `tests/host-runtime-cutover.test.ts` and `tests/loop-contract-v4-alignment.test.ts`.
- Behavior tests: `tests/claude-host-authority.test.ts`, `tests/claude-review-host-async-agent.test.ts`, `tests/claude-batch-authority.test.ts`, `tests/host-neutral-assurance-coordinator.test.ts`, `tests/pi-canary-assurance-progression.test.ts`, `tests/pi-canary-assurance-authority.test.ts`.

## Brainstorm Trace

| ID | Approved requirement/decision | Coverage |
| --- | --- | --- |
| BR-REQ-1 | Every blocked `submitClaudeReview` result carries one same-Host recovery action | S1, RSH-S1-A1 |
| BR-REQ-2 | Correct the Loop contract's `run_in_background: false` statement to match the Claude Host | S1, RSH-S1-A2 |
| BR-REQ-3 | Forbid continuing a reviewer; the duplicate `SubagentStop` reason directs to a fresh reviewer | S1, RSH-S1-A1 and RSH-S1-A2 |
| BR-REQ-4 | `bindsStart` requires the full prompt to be identical | S2, RSH-S2-A1 |
| BR-REQ-5 | A `pass` must list inspected paths and is rejected when a changed path is missing | S3, RSH-S3-A1 |
| BR-DEC-1 | Recovery guidance, contract wording and the continuation rule form one Slice, done first | Slice decomposition |
| BR-DEC-2 | Strict equality, not prompt-by-reference | S2 |
| BR-DEC-3 | Kernel-side rejection, not an advisory record | S3 |
| BR-OUT-1 | The stuck task in the other repository is not handled here; it has since completed | Not planned |
| BR-OUT-2 | The session's own operating mistakes (unconfirmed root cause, test-first not followed, invalid stash baseline, compaction) are not handled here | Not planned |
| BR-DEFER-1 | Delivering the reviewer prompt by reference to remove the retyping cost | Deferred until after S2; revisit only if retyping remains a measured problem |
| BR-Q-1 | Why the Spec was absent from the review tree | Resolved in Evidence; fixes the S3 required set |
| BR-Q-2 | Whether to add an end-to-end regression for the 4.6.0 fix | Resolved in Evidence; missing `state.error` tests are in S1 |

## Technical design

### Common invariants

- A rejection never grants authority and never suggests another Host, a worktree, `repair_authority_state`, a commit, or unmanaged implementation.
- No Kernel schema, TaskRecord field, persisted approval, Enrollment rule or hook event shape changes in any Slice.
- Hosts other than Claude keep their current `submit_review` results; new result fields are optional on shared types.
- Packaged prose and the generated Claude bundle change in the same Slice as the behavior they describe.

### S1: recovery guidance for a blocked Review

The `blocked` variant of `AssuranceSubmitReviewResult` gains an optional `recovery_action: string`. `submitClaudeReview` fills it on every blocked return it produces, chosen by reservation state rather than by matching reason text:

| Reservation after the rejection | Cases | Recovery action |
| --- | --- | --- |
| Released | receipt already consumed; correlation mismatch; launch envelope names a different agent; the three `state.error` reasons; reviewer receipt is not a valid verdict | Call `advance_assurance` to obtain a new Review reservation, then dispatch one fresh reviewer with the returned envelope unchanged |
| Retained, reviewer not finished or not observed | reservation not observed; terminal event order incomplete; transcript unreadable; transcript carries no reviewer result | Wait for the dispatched reviewer to finish, then call `submit_review` again with its verdict; do not dispatch or continue another reviewer |
| Retained, verdict mismatch | parent verdict differs from the reviewer receipt | Resubmit the reviewer's verdict exactly as the reviewer returned it |

The duplicate `SubagentStop` reason is reworded to say that a reviewer was continued after it finished and that a reviewer cannot be continued. Other reason strings, every `release` decision, `verdict_invalid` handling and all non-blocked results are unchanged. Results produced inside the coordinator (`submitReviewOnce`) keep their existing recovery fields and are not part of this Slice.

Contract prose: the Loop contract replaces the foreground sentence with the actual rule (pass the envelope through unchanged; on the Claude Host the `Agent` call returns an asynchronous launch receipt, which is expected; wait for completion before `submit_review`). The Loop contract and the reviewer definition state that a reviewer is never continued or re-prompted, that the reserved prompt is dispatched verbatim, and that a blocked `submit_review` is recovered only through its `recovery_action`.

### S2: exact prompt binding

`bindsStart` compares a present prompt with the reserved dispatch prompt for full equality. The marker stops being an alternative acceptance path; a prompt whose marker matches but whose body differs does not bind. A start with no prompt and an explicit matching `operationId` binds as today, because that evidence comes from the hook, not from Parent-authored text. An unbound start leaves the reservation unobserved, so `submit_review` returns the S1 retained-reservation result; the Loop contract states that editing the reserved prompt forfeits the reservation and that the same envelope must be dispatched unchanged.

Compatibility: sessions that append context to the reviewer prompt stop settling. That is the intended effect and is why S1 lands first.

### S3: path coverage on a Review pass

For the review role only, a `pass` verdict's `approval` gains a required `inspected_paths`: an array of unique repository-relative path strings. `parseAssuranceVerdict` receives the reviewed change set and rejects a `pass` when the field is absent or malformed, contains a duplicate, names a path outside the change set, or omits any path of the change set. Deleted paths are part of the required set. The rejection is `verdict_invalid`, names the missing paths, keeps the reservation, and follows the existing single-correction path. Rework verdicts and QA-role verdicts are unchanged and still reject the field as unknown.

The list is checked at the coordinator and removed before the approval is settled, so the Kernel approval and TaskRecord are unchanged and no migration or replay path is affected. The verdict contract identifier stays `assurance_kernel/assurance_verdict/v2`: verdicts are produced and consumed within one live reservation and are not persisted in this form, so no historical copy needs to parse under the new rule.

Every `parseAssuranceVerdict` call site passes the change set. The Claude parent-versus-receipt fingerprint comparison keeps comparing the full verdict, including the new field. The reviewer prompt assembled in `coordinator.ts`, the reviewer definition and the Loop contract describe the field and state that a path is listed only after its diff was read.

Limit: the check proves the reviewer claimed every path, not that it read them. It converts silent partial coverage into an explicit false statement in the verdict, which is the enforceable part; this is accepted under BR-DEC-3.

## Slice decomposition, dependencies, and acceptance mapping

All three Children are `material`. Task IDs are `review-block-recovery-guidance`, `review-prompt-exact-binding` and `review-pass-path-coverage`.

| Slice | Closable result | Remaining gap after it | Blockers | Acceptance | Focused verification |
| --- | --- | --- | --- | --- | --- |
| S1 | Blocked Review results are self-recovering and the contract prose matches the Host | Prompt rewriting and partial-coverage passes still settle | None | RSH-S1-A1 (runtime results), RSH-S1-A2 (contract prose) | Claude host authority, async-agent and package tests; Loop contract tests |
| S2 | A rewritten reviewer prompt cannot settle | Partial-coverage passes still settle | S1 | RSH-S2-A1 | Claude host authority, async-agent, batch authority and package tests |
| S3 | A pass that omits a changed path cannot settle | None for this Initiative | S1 | RSH-S3-A1 | Host-neutral coordinator, Pi progression and authority, Claude host authority and package tests |

Descriptors use `bun test` with explicit file arguments, `prepare` null and no writable paths, following the existing Review Host descriptors. `bun` is provided by the QA host; every test dependency is tracked repository content.

This Spec is intentionally absent from every `scope_hint`: no Slice edits it, and a Spec staged before Enrollment inside a task scope would be an unchanged pre-Enrollment scope path.

## Devil's Advocate Audit

- Rollback resilience: each Slice is confined to runtime modules, the generated bundle, packaged prose and tests, with no persisted state. Reverting S2 or S3 alone restores the looser behavior without migration. Reverting S1 while S2 remains would bring back unexplained rejections for edited prompts, so S1 is reverted last.
- Verification vanity: asserting only that a correct review still settles would pass today. S1 asserts a recovery action for every rejection case in the S1 table and the absence of forbidden fallbacks; S2 asserts the appended, truncated and rewritten prompts do not bind; S3 asserts each malformed and missing-path case separately from the accepting case.
- Spec dilution: "recovery action on every blocked result" must not shrink to the two inline returns in `submitClaudeReview`; the `abandonReview` returns are included. "Exact binding" must not keep the marker as a second path. "Path coverage" must not become an advisory log.
- Lost flexibility: S2 removes the Parent's ability to add context for the reviewer. Context belongs in the Kernel-assembled prompt; that cost is accepted by BR-DEC-2 and the by-reference alternative is BR-DEFER-1.
- Scope closure: `parseAssuranceVerdict` serves QA as well; S3 must not require the field for QA or accept it on rework. The Pi call sites must pass the same change set the coordinator uses, or Pi reviews would reject every pass.

## Assumptions

A1: the reviewed change set is reachable at every `parseAssuranceVerdict` call site without a new port; if a Pi call site lacks it, S3 threads it through that call site's existing reservation and stays within the listed files, or requests an Intent revision naming the missing path. A2: the Claude hook supplies the dispatched prompt unmodified, so byte equality is achievable for an unedited dispatch; the existing equality branch for marker-less prompts indicates it is. A3: contract tests can assert prose by presence and absence of fixed sentences, as the existing Loop contract tests do.

## Planning completion and execution handoff

Author the three candidates through `imm-kernel intent author <path> --stdin --json`, stage only this Spec and the three Intents, and require `valid: true` and `enrollment_ready: true`. Publish the three Children with one `imm-tracker publish-initiative --stdin --json` call. Enrollment and execution need a later explicit trigger and the native gate; the recommended first task is `review-block-recovery-guidance`.
