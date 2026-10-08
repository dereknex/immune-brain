# Changelog

## 5.0.0

### Major Changes

- [`f8c69e1`](https://github.com/dereknex/immune-brain/commit/f8c69e112634c8a5be2323dd88384becbf52ff49) Thanks [@dereknex](https://github.com/dereknex)! - **BREAKING:** rename three public Skills so the suffix names the job (#163). There is no alias layer and no deprecation window: the old names stop resolving on upgrade.

  | Old                      | New            |
  | ------------------------ | -------------- |
  | `imm-loop`               | `imm-run`      |
  | `imm-agent-doc-maintain` | `imm-doc-slim` |
  | `imm-review-retro`       | `imm-retro`    |

  Update every invocation (`/immune-brain:imm-run`, `/skill:imm-run`, and the equivalents for the other two) and any personal command or prompt alias that forwards to the old names. `imm-brainstorm`, `imm-planner`, `imm-doc-prune` and `imm-pr-fix` are unchanged.

  The Skill directories, the packaged contracts under `dist/`, both registries (`name`, `path`, `next_actions`, plus the `Doc Slim` and `Retro` titles) and the dist sync manifest move with the names. The Loop routing contract's `entry` value in `runtime/loop_contract.ts` is now `"imm-run"`, and the Kernel and Pi Enrollment routing hints name `imm-run`. Internal identifiers without the `imm-` Skill prefix keep their names (`loop_contract.ts`, the `imm_loop_action` Tool, `review_retro.ts`), and historical records (archived docs, Plans, Specs, reports, `.imm/` audit records, the changelog) are not rewritten.

### Minor Changes

- [`057f647`](https://github.com/dereknex/immune-brain/commit/057f647636b026261117cb92bc62f9d54cc5ce3b) Thanks [@dereknex](https://github.com/dereknex)! - Ship generated native agent definitions for the read-only roles on the Claude Host.

  - The Claude plugin build now also writes `immune-brain-qa`, `immune-brain-ui-review` and `immune-brain-advisory-reviewer`, each body generated from the matching `runtime/prompts/` role prompt the Pi Host dispatches, under fixed frontmatter whose tool allowlist is exactly `Read, Grep, Glob`. These roles declare `no tools` in `INTERNAL_ROLE_PROMPTS`; a native definition cannot express an empty allowlist without inheriting every tool, so read-only-without-shell is the strictest expressible boundary. `--check` fails when a committed definition differs from a fresh generate.
  - `runtime/claude/role_agents.ts` maps exactly those three roles to their plugin agent types, and `arch-explorer` to the Host's own `Explore` agent with no shipped definition, so a second definition cannot fork a boundary the Host owns.
  - The packaged Loop and Planner contracts and the dispatch protocol, with its packaged mirror identical to its source, state that on the Claude Host a read-only role is dispatched through the `Agent` tool by its plugin agent type, that architecture exploration uses the Host's `Explore` agent, and that the agent definition rather than prompt text bounds the role's tools. They state that on Pi the agent configuration belongs to the user and the boundary remains prompt text.
  - `loopRoleSubagentFor`, the Pi dispatch envelope and the reviewer definition are unchanged.

- [`bbaa947`](https://github.com/dereknex/immune-brain/commit/bbaa947323f53168f64bb8bf2634ce68196d0868) Thanks [@dereknex](https://github.com/dereknex)! - Send the Claude reviewer only the parameters its `Agent` tool accepts, and pin the read-only tool boundary of its native definition.

  - The Claude Review dispatch envelope is now exactly `{ name, prompt }`; the receiver-less `max_turns` and `run_in_background` are gone, so a Parent copying the envelope unchanged no longer passes two parameters the Host rejects. `ReviewRequest.maxTurns` stays on the shared type because the Pi port forwards it natively.
  - A package test reads the shipped reviewer frontmatter and requires the allowlist to be exactly `Read, Grep, Glob, Bash`, so `Agent`, `Edit`, `Write` and `NotebookEdit` stay natively denied, and rejects the `hooks`, `mcpServers` and `permissionMode` keys that a plugin agent ignores and would otherwise read as enforced.
  - Reservation binding, hook observation, settlement and every blocked Review result with its reason, release decision and `recovery_action` are unchanged.

- [`1e5043e`](https://github.com/dereknex/immune-brain/commit/1e5043ec3c0c04cb857ab00fcb393a20f666e47e) Thanks [@dereknex](https://github.com/dereknex)! - Assurance snapshot capture, Review-revision proof, capability minting and verdict application now live in one host-neutral module, `runtime/assurance/verdict_authority.ts`. The coordinator constructs that authority itself, so both hosts supply only their `AssuranceHostPort`, a confirmation-reference source (`claude:<actor>` / `pi-confirm-<16 hex>`) and an optional rework-parked notice; `AssuranceCoordinatorPorts` no longer carries per-host `buildAssurance`, `ensureReviewRevision` or `applyVerdict`. The Claude adapter thereby adopts the stricter checks the Pi adapter already enforced: capture validates record revision, intent revision and intent content hash together, refuses a v4 record without `git_base_head`, and verdict application re-verifies the whole snapshot before any capability is minted. Hook ordering is now identical on both hosts — `beforeCommit` → mint → commit → `afterCommit`, with the first hook error rethrown while the committed transition stands.

- [`fa759e3`](https://github.com/dereknex/immune-brain/commit/fa759e3129e8353530c8337bad1d0dd9fda23604) Thanks [@dereknex](https://github.com/dereknex)! - Require a named source for every planned decision and an agreed test seam for every acceptance.

  - The Planner contract gains `Decision Provenance`: every Spec decision and every acceptance names exactly one source — an upstream `BR-*` ID, repository evidence with a concrete path, or a delegated technical choice — with or without a Brainstorm manifest. A user-owned decision with no source is a defect that is removed or returned for clarification. Direct Planner entry and delegated technical choices stay legitimate sources, so this adds no `BR-DEC`-only rule.
  - `TaskIntent decomposition` now requires each Slice of a multi-TaskIntent Initiative to state what is verifiable when that Slice alone has landed, and forbids an acceptance that needs another unfinished Slice's work. A Slice with no such statement is a horizontal layer slice and is re-cut; a wide mechanical refactor may still be batched behind one final integrate-and-verify Slice. Both rules stay Planner judgment, not a schema field or an Enrollment counting rule.
  - `Testing Seam Selection` records the agreed seam of each acceptance in the candidate — the Spec's verification mapping for complex work, the acceptance assertion for simple work — and presents it through the surfaces Enrollment already shows. No confirmation is added: seam selection still must not weaken focused descriptors or create a mandatory user confirmation. Replacing a seam remains an acceptance change under Enrolled Intent Revision.
  - The `code-review` role prompt checks delivered tests against each named agreed seam. A missing or silently replaced seam is a finding with `violated.kind: "acceptance"` and the acceptance id as `ref`; an acceptance naming no seam produces no finding, so historical candidates stay valid.
  - `docs/reference/planning-quality-gate.md` mirrors the provenance and Slice rules; its packaged copy, the role-prompt mirror, and `agents/immune-brain-reviewer.md` are regenerated.

  Contract text and generated mirrors only: no runtime, schema, validator, or gate changed.

- [`7783446`](https://github.com/dereknex/immune-brain/commit/778344687d617089016e153e24dff9c6e65d98b3) Thanks [@dereknex](https://github.com/dereknex)! - Retire the Pi extension's `runtime-stub` layer: the Pi enroll, work and unattended-batch Tools import the host-neutral runtime statically, so the same Kernel code now has one import shape across both Hosts. The stub's adapter-owned logic moved unchanged into the Pi adapters — `readTaskIntentForRecord` (record-aware sidecar resolution), `markGithubTaskTerminal`, the shared session progression accessors and `projectAssuranceForTask` now live in `imm-canary-work.ts`, and `readSettledTaskRecord` moves to `imm-unattended-batch.ts` (currently caller-free; the settled-run Slice makes it Run-aware). The mirrored `LITERAL_USER_ACTOR_ID` constant and hand-copied structural types are gone in favor of the real runtime exports. `tests/pi-canary-package-boundary.test.ts` now proves the boundary through the import graph (no dynamic runtime import under `.pi-extension`, every static runtime import resolves, and the Pi Enrollment adapter reaches Kernel prepare only through `runtime/assurance/enrollment`) with a negative control, instead of pinning stub source text.

- [`856ef49`](https://github.com/dereknex/immune-brain/commit/856ef4994b299afd5a0015354145e16901844035) Thanks [@dereknex](https://github.com/dereknex)! - Tell a blocked Claude `submit_review` how to recover on the same Host, and stop claiming every Host runs reviewer Agents in the foreground.

  - A blocked Claude Review result carries one `recovery_action`: a released reservation starts a fresh reviewer through `advance_assurance`; a reservation still waiting asks for the same reviewer's verdict; a mismatched parent verdict must be resubmitted exactly.
  - Continuing a finished reviewer is rejected as a duplicate `SubagentStop`, and the Loop contract plus the reviewer definition forbid re-prompting one, including through SendMessage.
  - The packaged Loop contract states that a Claude `Agent` call returns an asynchronous launch receipt, which is normal, and that the reserved prompt is dispatched unchanged.

- [`e8c8784`](https://github.com/dereknex/immune-brain/commit/e8c878405ad04c64bfed61e9f9e288925d5d2076) Thanks [@dereknex](https://github.com/dereknex)! - Require a Review pass verdict to claim every path of the reviewed change set.

  - For the review role only, `parseAssuranceVerdict` now requires `approval.inspected_paths`: an array of unique repository-relative path strings. A pass is rejected as `verdict_invalid` when the field is absent, is not an array of strings, duplicates a path, lists a path outside the reviewed change set, or omits any path of it; deleted paths are part of the required set and an empty change set is claimed as an empty array.
  - The rejection names the offending paths, keeps the reservation, and follows the existing single-correction path, so the fix is a corrected verdict rather than a re-dispatched reviewer.
  - The list is checked at the coordinator and removed before settlement: the Kernel approval and TaskRecord are unchanged, so no schema, persisted record or replay path changes, and the contract id stays `assurance_kernel/assurance_verdict/v2`.
  - Rework verdicts and QA-role verdicts still reject the field as unknown. The reviewer prompt, the packaged reviewer definition and the Loop contract state that a path may be listed only after its diff was read.

  This converts silent partial Review coverage into an explicit false statement in the verdict. The check proves the reviewer claimed every path, not that it read it; that limit is accepted under BR-DEC-3.

- [`c7aafba`](https://github.com/dereknex/immune-brain/commit/c7aafba2b6b51719bba321ab22084c9dd90ba877) Thanks [@dereknex](https://github.com/dereknex)! - Bind a Claude reviewer start only to a byte-identical reserved prompt.

  - The reservation marker stops being an acceptance path. `bindsStart` and the `Agent` `PostToolUse` now compare a present prompt against the reservation's own `dispatchPrompt`, so a dispatch that keeps the matching `operation_id` and `task_id` marker but appends context, truncates, or rewrites the body does not bind, cannot settle, and yields a blocked `submit_review` with the retained-reservation `recovery_action`.
  - A start carrying no prompt still binds through the identifiers the hook supplies, because that evidence is not Parent-authored text.
  - The packaged Loop contract states that any edit to the reserved prompt forfeits the reservation and that the same envelope must be dispatched unchanged.

  Sessions that append context to the reviewer prompt stop settling. That is the intent: context belongs in the Kernel-assembled prompt. The generated Claude bundle matches the runtime source.

- [`97f1763`](https://github.com/dereknex/immune-brain/commit/97f1763d9799ab5603170737f3205ff0d92b9e30) Thanks [@dereknex](https://github.com/dereknex)! - Generate the packaged Claude reviewer definition and stop sending its static rules twice.

  - `STATIC_REVIEW_RULES` and `REVIEWER_DISPATCH_RULES` are now exported from the role prompt bridge as the single source for the sentences every Review dispatch carries: the read-only rule, the final-turn single JSON verdict rule, the finding provenance rule, the `inspected_paths` statement, and the BR-REQ-3 dispatch rules.
  - `scripts/build-claude-plugin.ts` writes `plugins/immune-brain/agents/immune-brain-reviewer.md` from the `code-review` role prompt plus those rules under fixed frontmatter, and `--check` now fails when the committed definition differs from a fresh generate, so a hand-edit cannot drift from the instructions a dispatched reviewer is meant to carry.
  - `ReviewRequest` carries a second projection, `snapshotPrompt`: the per-dispatch facts alone. The coordinator builds the complete prompt as the role contract, the static rules and those facts, so `buildReviewPrompt` keeps every instruction and fact it carried before for the Pi Host, while the Claude envelope prompt is the reservation marker followed by `snapshotPrompt` — it no longer repeats instructions the reviewer definition already holds.
  - The one resulting change to the Pi prompt is formatting: the `inspected_paths` sentence now backticks the identifier, because the shared sentence has to satisfy both dispatch shapes.
  - Binding, settlement, blocked results with their reason, release decision and `recovery_action`, and the Pi dispatch parameters are unchanged.

- [`45223ae`](https://github.com/dereknex/immune-brain/commit/45223ae982b74d999ce7916998de039bc814cf3b) Thanks [@dereknex](https://github.com/dereknex)! - Add the Run-exact settled-Run read behind the Authority Store: `readSettledRunEvidence` returns a Task's settled Run with its identity-validated record, its proof, its raw bytes, and whether its audit pair has been exported, and never answers from live state. `readSettledTaskEvidence` layers that read over the legacy flat layout, so pre-store terminals keep resolving without ever projecting another worktree's run. The run-blind `readAuditTaskPair` terminals in `assurance_projection.ts`, the batch preflight/commit/reconfirmation paths and the Pi `readSettledTaskRecord` now bind to this worktree's own run, so a re-enrolled Task reads its current Run's evidence and an earlier Run's exported pair is never returned. Batch children reconfirm their audit paths through `storage_paths.ts` instead of `.imm/` literals, the `enroll-<task>-<created_at>` convention is defined once (`enrollmentEventIdFor`), and the forwarding `readTaskRecord` export is gone — callers use `readTaskRecordRaw`. No schema change; the bundle is regenerated from these sources.

- [`80dc66f`](https://github.com/dereknex/immune-brain/commit/80dc66fcf3038415c785646d21806578be26ed3e) Thanks [@dereknex](https://github.com/dereknex)! - Give unattended batch runs one production child Kernel port (`deepen-authority-seams` D5). A new `runtime/unattended/batch_kernel_port.ts` owns `enrollTask` (through the single Enrollment entry), `projectTask`, `ownsTaskClaim` and `validateBatchAuthorization`; a Host supplies only its own `advanceTask` progression seam. The Pi and Claude adapters both call this shared port instead of each building its own, so Enrollment, projection, resume-ownership re-verification and batch authorization validation cannot drift between Hosts. Git operations leave `BatchRunnerKernelPort` entirely: the runner resolves `BatchRunnerGitPort` once (the injected port, or `createDefaultBatchGitPort` when a Host supplies none) instead of a three-level fallback over optional port members.

- [`80d6e3c`](https://github.com/dereknex/immune-brain/commit/80d6e3c44b8b700038cbb8c45ff31d37234eeda6) Thanks [@dereknex](https://github.com/dereknex)! - One function in `runtime/workspace_scope.ts` now computes a TaskRecord's delivery identity: `taskDeliveryIdentity` selects the revision family for a v4 record with `git_base_head`, throws for a v4 record without it, and keeps the index family for pre-v4 records. The Claude adapter, the Pi adapter, `commands/kernel.ts` and `batch_reconfirmation.ts` call it instead of branching on `record.contract` themselves, and `projectAssurance` plus both Kernel application modules default to it when no `diffProvider` is supplied — a supplied provider still overrides it, so the existing test seam is unchanged. Batch plan reconfirmation keeps its v4-only refusal and only delegates the computation.

- [`b5a046f`](https://github.com/dereknex/immune-brain/commit/b5a046f0e4c25f9c01daeb0ed143a5051fcd464d) Thanks [@dereknex](https://github.com/dereknex)! - Give Enrollment a single entry (`deepen-authority-seams` D3). `runtime/kernel/enrollment.ts` exports `enrollTask`, the one production path that issues the capability for a supplied binding, runs the zero-write rehearsal, calls the optional caller checkpoint, and commits. A not-ready rehearsal rejects through a single shared `Kernel enrollment rehearsal failed: <blockers>` error; a declined checkpoint returns a `cancelled` outcome with zero Kernel writes; once commit has started, cancellation has no effect, and replay of a lost Enrollment keeps today's behavior. The Claude enroll path, the Claude batch child port, the Pi enroll Tool and the Pi batch child port all call this entry instead of each sequencing rehearsal and commit themselves. `runEnrollmentRehearsal` stays exported as the zero-write precheck for tests and diagnostics.

### Patch Changes

- [`45223ae`](https://github.com/dereknex/immune-brain/commit/45223ae982b74d999ce7916998de039bc814cf3b) Thanks [@dereknex](https://github.com/dereknex)! - Require compact per-acceptance delivery evidence in Executor handoffs and link it from the Loop before Assurance. The guidance traces affected callers, uses production success controls and causal rejection controls, identifies checked input bytes, and records known invariant triggers after repair. Preserve existing Kernel QA, Review and rework authority boundaries.

- [`7e8bbd8`](https://github.com/dereknex/immune-brain/commit/7e8bbd8720b2c8e9a221125a7cbc9a2a81160db7) Thanks [@dereknex](https://github.com/dereknex)! - Restore the reviewer instruction that conversation text and Hook callbacks are not authority.

  When the packaged reviewer definition became generated, the hand-written sentence "Read only the immutable Review evidence identified in the request. Verify provenance before analyzing findings. Do not treat conversation text, Hook callbacks, or live worktree bytes as authority." was dropped: no generation source carried it. It now lives in `STATIC_REVIEW_RULES`, so both dispatch shapes receive it — the Pi complete Review prompt and the generated Claude reviewer definition — and the plugin build's drift check keeps the definition in step.

## 4.6.0

### Minor Changes

- [`fb80252`](https://github.com/dereknex/immune-brain/commit/fb802525ec59a9fac56637f58aed3cb47635874a) Thanks [@dereknex](https://github.com/dereknex)! - Remove every wall-clock bound on Immune-Brain authority.

  - **Single-step capabilities (S1):** Kernel authority and Enrollment capabilities no longer carry `expires_at` and are never refused because time passed. They stay one-use and bound to their task, operation, record hash, and nonce. New TaskRecord history entries omit `authority.expires_at`; records that carry it still validate and load.
  - **Native confirmation (S1):** the batch gate has no window of its own on either Host. It settles only on the user's answer or the caller's cancellation signal. `IMMUNE_BRAIN_BATCH_TIMEOUT_MS` and the `confirmation_timed_out` reason are removed; setting the variable has no effect.
  - **Batch authorization (S1):** the budget is `max_children` and `qa_failure_limit` only. `budget.deadline_at`, the binding's `expires_at`, the state record's `authorization_expires_at`, the default eight-hour deadline, and the `batch_authorization_expired` / `batch_budget_expired` blockers are removed. A batch parked on a foreground Review resumes with no gate however long it waited. Plan-digest drift, a branch change, a moved HEAD lineage, and both budget limits still stop or re-gate the run as before.
  - **Older records:** a batch state record that still carries the retired expiry fields is read as if they were absent and is rewritten without them. No migration runs and frozen audit is untouched.
  - **Decision records:** ADR-0005 decision 3 and ADR-0008 decision 3, with its rejected alternative, now describe the clockless rule and why the deadline was retired.
  - **Gate-free closeout (S2):** a batch child that reaches Kernel `done` in the foreground is committed and the batch record settled in the same tool call, with no new gate. A HEAD that fast-forwards on the batch branch is adopted as the new expected head and recorded in the batch run state; any other HEAD movement still ends the run with `batch_head_lineage_broken`. A failure after the Kernel result is reported beside it with one retry action and never alters it.
  - **Parent close (S3):** after `mark-terminal` closes a Child as completed, the tracker reads the Parent and its Sub-issue list (Issue-scoped, no repository listing) and closes the GitHub Initiative Parent as completed exactly once when every Slice Child is completed. An open, stopped or parked Child keeps it open; an already closed Parent and a rerun write nothing. A failed Parent read or close is reported as tracker observation, retried by the same `mark-terminal`, and never changes the Kernel result. The Parent body, the Planner contract and `docs/agents/issue-tracker.md` state the new rule; the tracker result contract and Issue markers are unchanged.

- [`f72f2e8`](https://github.com/dereknex/immune-brain/commit/f72f2e89aea6069e7103a95f0a421a52f5d5dfeb) Thanks [@dereknex](https://github.com/dereknex)! - Publish GitHub Initiatives with a direct create-then-relate write flow.

  - **Direct write flow (S1):** `imm-tracker publish-initiative` reads the repository identity, the Issue listing, and the label listing once at start, then creates each absent Issue in dependency order, attaches each Child as a native Sub-issue, and writes one `blocked_by` relation per dependency edge. Issue numbers come from the create responses; no repository listing, attachment confirmation, dependency confirmation, ownership confirmation, or closing topology pass follows a write. The number of repository-wide reads is constant in the number of Children, so a large Initiative no longer grows its call count or its runtime with the batch.
  - **Start-only deduplication:** a rerun of the same approved batch adopts whatever the start listing already carries and writes only the missing relations, so a partial run, a lost create response, or a repeated complete batch never creates a duplicate Issue and never repeats a completed write. Concurrent edits made during a run are no longer detected within that run; they surface as drift at the start of the next run.
  - **No whole-operation deadline:** the 120-second publication budget and its expiry refusal are removed. One publication call is a finite step sequence that stops at its first failed call, each call keeps its own 20-second timeout, and the caller's cancellation signal still stops the run at the next call. A failure is reported as uncertain with its confirmed steps, pending steps, and exactly one recovery action — rerun the same approved batch.
  - **Amendment uses the same flow (S2):** an `amendment` input verifies every bound Issue against its approved baseline once, from the start listing plus Issue-scoped relation reads, then edits the Parent at most once, edits each approved pending brief at most once, creates newly added pending Children as in ordinary publication, and converges each pending Child's `blocked_by` set from the start read. Historical Children receive zero writes. No read follows a write, so baseline drift that appears after the start listing is not detected in that run; it surfaces at the start of the next run. Omitted membership, start drift, and stopped historical prerequisites still fail closed before any write. A Parent edit that already succeeded is reported as confirmed even when a later Child or relation call fails.
  - **Generator consistency:** this changeset also regenerates `plugins/immune-brain/dist/claude/mcp-server.mjs`. The previous commit (`aa8b5b8`) added `QA_MAX_IDENTICAL_FAILURES` to `runtime/assurance/coordinator.ts` and to the bundle, but the following tracker commit re-checked out an older bundle while keeping the newer runtime source, leaving the checked-in bundle inconsistent with its own sources. The regenerated bundle restores that consistency; no Kernel behavior is changed by this task.
  - **Unchanged surfaces:** local preflight, Issue body and marker format, `mark-terminal`, `observeGithubInitiative`, the tracker result contract, Kernel authority, and Enrollment are untouched.

### Patch Changes

- [`ca0f7ec`](https://github.com/dereknex/immune-brain/commit/ca0f7ec0b3e1e5dd419fe0a8b251952922389a9c) Thanks [@dereknex](https://github.com/dereknex)! - Limit repeated identical QA failures and add opt-in stage timings to `advance_assurance`.

  - **QA retry limit:** after two consecutive QA failures on the same snapshot (record revision, intent hash, diff hash) the coordinator returns `blocked` instead of rerunning the descriptors. A changed snapshot, a QA success, or a new session resets the count; host cancellation neither counts nor resets it.
  - **Stage timings:** with `IMM_ASSURANCE_TIMINGS=1` (or the `reportTimings` port) advance results carry `timings: { total_ms, stage_ms }` per progress stage. Off by default, so existing result contracts are unchanged.

## 4.5.0

### Minor Changes

- [#134](https://github.com/dereknex/immune-brain/pull/134) [`0567223`](https://github.com/dereknex/immune-brain/commit/0567223c0ef09793dd598627d2a5f4b53cfa49e1) Thanks [@dereknex](https://github.com/dereknex)! - Close the `workflow-decision-closure` Initiative (S1–S7): preserve the complete approved outcome through handoff, bound side effects and authority recovery, tie acceptance to observable invariants, make canonical Intent authoring discoverable, bound repository discovery, and record truthful observed behavior evidence.

  - **Outcome conservation through handoff (S1):** Planner and Brainstorm keep every upstream decision and required phase mapped exactly once, including clear zero-question requests and staged implementation; a plan that conserves only part of the confirmed outcome fails the completeness check instead of passing.
  - **Exact effect and outbound authorization (S2):** staging recovery, research and provider calls stay inside the existing operation/target/impact grants. A new outbound channel or provider is an authorization delta, and documentation, mock, real-channel and model-quality evidence stay distinct rather than merging into one verified claim.
  - **Authority-fact resume (S3):** Loop resumes from the Kernel task/run projection, not from a compaction summary, HANDOFF prose or Issue state. Authoritative, validated, published, enrolled and completed remain distinct, and a summary that contradicts receipts is corrected rather than replayed.
  - **Invariant-based acceptance and executable prerequisites (S4):** verification binds to observable seams with positive, negative and bound controls. Zero matched checks, skipped required checks, absent dependencies and a missing simulator fail instead of passing, and automated geometry evidence stays separate from human motion-quality judgment.
  - **Discoverable Intent authoring and bounded publication (S5):** `imm-kernel intent --help` states the canonical destination/stdin contract and strict v2 descriptor shape before a caller fails a call. GitHub publication recovers from confirmed partial writes within a whole-operation deadline: exact ownership/topology readback before any replay, idempotent reuse of the approved manifest, no duplicate Issues and no Enrollment before complete readback.
  - **Bounded discovery and partial-result recovery (S6):** internal roles keep read-only, bounded tool authority; discovery expands only along proved callers and stops on its stated criterion, truncated material is read in bounded pages when still required, and an interrupted step inspects already-applied edits and retries only the unfinished part.
  - **Observed behavior evidence (S7):** a focused offline verifier (`scripts/benchmark_eval.ts`) checks a sanitized ten-scenario cohort without ever calling a provider, failing closed on missing, duplicate, undisclosed or contract-only outcomes, on a pass whose recorded criteria do not cover its `successChecklist`, on an unmet criterion that is not the scenario's own, and on fingerprint or provenance drift. Live observation is disclosed honestly, including recorded failures.

  Task execution continues to require the native Host Enrollment confirmation gate, and no real commit, GitHub write or Enrollment is performed as scenario evidence.

## 4.4.1

### Patch Changes

- [`75bcf7d`](https://github.com/dereknex/immune-brain/commit/75bcf7d099ef134705caf8f32c82038f3d1d7ec7) Thanks [@dereknex](https://github.com/dereknex)! - Fix unattended batch execution and recovery across Pi and Claude hosts:

  - Renew expired parked authorization with a fresh budget while preserving progress and QA failure counters.
  - Return enrolled children to the foreground Executor before QA/Review, and continue serial children under the same grant.
  - Derive precise recovery actions from fresh Kernel obligations and findings, retaining safe check diagnostics without persisting raw verifier output.
  - Preserve authority-read retry budgets, legal path reconciliation actions, and fresh QA when Review preparation fails.

## 4.4.0

### Minor Changes

- Expose `revise_intent` in the Claude MCP tool surface and `ClaudeRuntime` to allow compatible TaskIntent revisions to be submitted and persisted directly, restoring the sidecar file and Git index on failure.

## 4.3.0

### Minor Changes

- [`50b1b7d`](https://github.com/dereknex/immune-brain/commit/50b1b7d85d1c4b83e583a1cb382ae9eff1bc2530) Thanks [@dereknex](https://github.com/dereknex)! - Allow Pi and Claude Enrollment in Git repositories with an unborn HEAD. The existing native confirmation includes creating an empty initial commit without staging project files or modifying Git configuration. Revalidate Git and workspace ownership around initialization, and expose the required initialization in TaskIntent validation.

## 4.2.0

### Minor Changes

- [#114](https://github.com/dereknex/immune-brain/pull/114) [`82aab3c`](https://github.com/dereknex/immune-brain/commit/82aab3cec921b5a60635f940c06a75f29c7b84ab) Thanks [@dereknex](https://github.com/dereknex)! - Auto-activate absent managed-task routing policy during explicit imm-planner runs.

  - In unowned repositories missing `managed-task-routing-policy.json`, explicit `imm-planner` entry now creates and stages the canonical `kernel_task_intent` routing policy automatically before authoring, removing redundant manual setup prompts.
  - Existing invalid, untracked, unreadable, or divergent routing policy files remain fail-closed as `routing_policy_invalid` and are not overwritten.
  - Task execution continues to require the native Host Enrollment confirmation gate.

## 4.1.0

### Minor Changes

- [#112](https://github.com/dereknex/immune-brain/pull/112) [`4350bd8`](https://github.com/dereknex/immune-brain/commit/4350bd81940f97c54bea1db65e7372a306f28e0e) Thanks [@dereknex](https://github.com/dereknex)! - Add user-configurable interaction language for host-native UX and internal role dispatches.

  - Host-native UI text (Task Rail sentences, authority dialog titles and actions, enrollment progress summaries) follows the new `IMM_UX_LANGUAGE` environment variable (for example `zh`); state enums, operation ids, domain field labels, agent-facing Tool result reasons, and diagnostic notifications stay literal English.
  - Internal role dispatches (`dispatch_role` and routed role contexts) accept `interaction_language` in the delegation context, so QA/Review/Explorer roles report findings and summaries in the user's language while keeping machine contracts literal; omitting it keeps prompt bytes and English role output unchanged.
  - Document the language boundaries in BASELINE.md and the dispatch contract in dist/imm-loop.md, and align AGENTS.md reply-language rules with explicit user language instructions.

## 4.0.1

### Patch Changes

- [#110](https://github.com/dereknex/immune-brain/pull/110) [`62a451b`](https://github.com/dereknex/immune-brain/commit/62a451beefb3c53605d145a6f76872b751539388) Thanks [@dereknex](https://github.com/dereknex)! - Codify rework root-cause lessons: require generalization arguments or contract-boundary refutations on repeated rework, require state-machine consumer enumeration before planning, record authority uniqueness key principles in ADR-0012, and aggregate review rounds per task in workflow-evidence-retro.

## 4.0.0

### Major Changes

- [#109](https://github.com/dereknex/immune-brain/pull/109) [`5f9da27`](https://github.com/dereknex/immune-brain/commit/5f9da279a28ff5953cf68a5a94f98df18fc9d2cb) Thanks [@dereknex](https://github.com/dereknex)! - Close the TaskRecord v3 drain window and delete the drained v4 CLI surface.

  The live `TaskRecord` contract is v4 only: `parseTaskRecord` and every entry
  point that mutates authority now reject a v2/v3 record, and the frozen parsers
  for those contracts moved to `kernel/legacy_task_record.ts`, where the audit and
  storage-layout readers reach them as a fallback. Settled pre-v4 evidence under
  `.imm/audit/` stays exactly as it was written — it is read through those frozen
  parsers rather than rewritten (see `docs/adr/0011-frozen-readers-for-pre-v4-terminal-evidence.md`), so no existing workspace needs a new migration step.

  The eight commands marked "Retired after v4 storage retirement" (`imm-work`,
  `imm-review`, `imm-autowork`, `imm-heal`, `imm-migrate`, `imm-finish`,
  `imm-check-child-output`, `imm-retire-stale-wrapper`) are gone: their `bin/`
  wrappers and the runtime's per-command `drain_required` / `v3_storage_retired`
  wall are deleted, a retired name now returns the generic
  `Unknown Immune-Brain v4 command` response, and `list-commands --json` no longer
  publishes a `retired` list. The retired _option_ wall on `imm-plan --sync` and
  friends is unchanged.

- [`60d310d`](https://github.com/dereknex/immune-brain/commit/60d310d587dbe8bc8c4983f5410ca59e6587942f) Thanks [@dereknex](https://github.com/dereknex)! - Replace the multi-file JSON authority store with one SQLite database per
  worktree (`.imm/state/kernel.sqlite`), and remove the retired file store, its
  byte-CAS journals, the duplicate claim/tombstone/relocation writers and the
  manual repair instructions that existed to reconcile them.

  Enrollment, freeze, QA, Review, settlement and audit export now run as Kernel
  transactions over that store; Git keeps sole ownership of code identity and
  terminal audit evidence stays tracked under `.imm/audit/<task-id>/`.

  Behavior that becomes simpler or stricter in the same release:

  - A simple TaskIntent no longer needs a Spec, and freeze, rework and stop bind
    artifacts in place instead of relocating them into `archive/`.
  - Delivery scope is an authorization envelope: new helpers and tests inside an
    approved directory need no revision, while staged work outside the envelope
    is rejected and each task's own dirt is preserved.
  - Deterministic QA runs every descriptor in a disposable materialization of the
    frozen tree with isolated Git metadata, so a descriptor can no longer observe
    or contaminate the live worktree.
  - Ordinary Review rework returns straight to execution. Only a recurring
    security boundary, or five effective rework rounds, pauses a task for a user
    decision, and a passing Review may carry non-blocking advisories that settle
    the task with the notes recorded on the attestation.

  The legacy audit projection stays read-only and is scheduled for removal in the
  next major release; migration of an existing workspace is explicit, claimless
  and validated against a temporary database before publication.

- [`ea5c6b6`](https://github.com/dereknex/immune-brain/commit/ea5c6b69b8f96da121d33876f885179f7283dfcb) Thanks [@dereknex](https://github.com/dereknex)! - Replace Bun-specific QA execution with project-owned preparation and verification commands for arbitrary toolchains.

  Deterministic QA now proves that every project process is gone before a result settles, and the declared 60-minute aggregate budget covers preparation and checks together.

### Patch Changes

- [`47fefda`](https://github.com/dereknex/immune-brain/commit/47fefda339def7e850113679f812bf79e81c4d79) Thanks [@dereknex](https://github.com/dereknex)! - Bind a Batch Authorization's expiry to the budget deadline the literal user confirmed instead of a fixed ten-minute window. A batch parked on a foreground Review inside its confirmed budget no longer lapses and demands a second native gate, while the fail-closed expiry, deadline, clock, and renewal checks are unchanged on both Hosts.

- [`b2a8e0a`](https://github.com/dereknex/immune-brain/commit/b2a8e0a89e660b3243262d920ca400058ec3afe9) Thanks [@dereknex](https://github.com/dereknex)! - Resume an authorized unattended batch without a second native gate. Pi and Claude Code reuse an intact, still-binding Batch Authorization — unexpired, same plan digest, batch branch, and HEAD lineage, batch still running — and open a fresh confirmation, named with the reason, whenever any of those no longer binds.

- [`dcf03db`](https://github.com/dereknex/immune-brain/commit/dcf03db733c62c0358651b00b6fbe8f14c8f396a) Thanks [@dereknex](https://github.com/dereknex)! - Start a new confirmed batch from the current Initiative plan after the previous run settles, with a fresh run identity and current HEAD binding. Reuse the existing batch branch only when its settled lineage is intact, retaining prior run evidence.

  Strengthen contract tool-name checks and exercise successful and resumed Host batch paths in the Git safety guards.

- [`aecf5dd`](https://github.com/dereknex/immune-brain/commit/aecf5ddab3b608dbf06023ef9f87662e45812667) Thanks [@dereknex](https://github.com/dereknex)! - Make the packaged contracts Host-neutral about tool identity: drop the stale `freeze_artifacts` step the Kernel already performs inside `advance_assurance`, restate every remaining Pi-only tool spelling as the obligation it stands for, and add a guard test that fails whenever a packaged contract names a tool absent from every Host tool surface.

- [`978fe57`](https://github.com/dereknex/immune-brain/commit/978fe57211c10f237251ed0070d64d998d4f71f0) Thanks [@dereknex](https://github.com/dereknex)! - Fix project-owned verification process discovery on Linux: the token search reads procfs instead of invoking `ps` with BSD modifiers, so deterministic QA can prove and complete process cleanup on Linux hosts.

  Descendants are attributed by session membership rather than by uid, so a command that drops its privileges while staying in the verification session is still cleaned up, and unrelated system processes with unreadable information can no longer fail every check on an ordinary Linux host.

- [`9bb43e3`](https://github.com/dereknex/immune-brain/commit/9bb43e34ca64abdc1aa326a509921681a5df2b12) Thanks [@dereknex](https://github.com/dereknex)! - Exclude a batch Child at planning time when its TaskIntent cannot name its bound Spec pair, instead of offering it for confirmation and having enrollment refuse it later. The batch plan reuses the same shared `spec_binding` predicate enrollment uses and reports a stable reason that names every path the intent must add; critical-child exclusion, dependency order, skipping, and the plan digest are unchanged.

- [`09c461a`](https://github.com/dereknex/immune-brain/commit/09c461ada89a6e35f2ce1e7b0a921f5fa4b973fa) Thanks [@dereknex](https://github.com/dereknex)! - Give the Claude Code Host the post-settlement GitHub tracker projection the Pi Host already performs, so an opted-in terminal projection no longer depends on which Host settled the task. The step lives in the shared coordinator (`projectTerminalTrackerState`) and both Hosts call it: it derives the projection input only for a fresh claimless done/stopped task with its exact terminal tombstone, forwards to the tracker, and reports a tracker failure as `tracker` beside the authoritative result instead of turning it into evidence, a Loop blocker, or a reason to repeat the settling Kernel mutation. Enrollment still performs no projection.

- [`70c3adc`](https://github.com/dereknex/immune-brain/commit/70c3adc469a7b7fe7862defd89dd6829b35681e9) Thanks [@dereknex](https://github.com/dereknex)! - Record one literal-user actor identity instead of two. A survey of the 122 settled records under `.imm/audit/` counted `literal-user` 220 times across 54 records against `user` 4 times in three Claude-Host-era records, so `literal-user` (which the Kernel's own batch validation already named in its error text) is the converged spelling: both Hosts now mint it for a batch or enrollment authorization, and the Kernel canonicalizes the actor where the audit identity is written, so a Host that still supplies the historical spelling is recorded as the literal user.

  Nothing is rewritten in place: the reader accepts both spellings, so a settled record or a batch capability issued under the old spelling keeps validating and stays byte-identical, and the batch authorization projection stays faithful to the state it read. The extension's mirrored constant is pinned to the Kernel's by a conformance assertion.

- [`9d61307`](https://github.com/dereknex/immune-brain/commit/9d61307a4e7249327e8d293a137c58b9d2c73dee) Thanks [@dereknex](https://github.com/dereknex)! - Converge three Host divergences onto the safer branch. Restoring a staged TaskIntent is now one shared, verifying implementation, so a restore that leaves the bytes or the index inconsistent fails closed on both Hosts instead of only on Pi. The bounded native-confirmation deadline is shared too: an unanswered confirmation ends on the same `IMMUNE_BRAIN_BATCH_TIMEOUT_MS` setting with the same default, and reports a stable timeout reason rather than a cancellation. Claude now imports the shared authorization-operation derivation instead of re-deriving it inline, so the mapping from Kernel readiness cannot drift between Hosts.

- [`ed64724`](https://github.com/dereknex/immune-brain/commit/ed64724ab7cd69a933d76df02be6765a0b7c7b01) Thanks [@dereknex](https://github.com/dereknex)! - Make the Spec binding an enrollment precondition instead of a freeze surprise. A new shared `runtime/kernel/spec_binding.ts` owns the "one scope-bound active Spec and its archive path" predicate; enrollment and its zero-write rehearsal now refuse an intent whose `scope_hint` cannot name that pair, naming every path the intent must add, while freeze-time enforcement is retained unchanged because enrollment cannot observe post-implementation scope drift.

- [`b284e65`](https://github.com/dereknex/immune-brain/commit/b284e653f4df2a5f2422b0097bb03d51c389dde7) Thanks [@dereknex](https://github.com/dereknex)! - Reduce `runtime/plan_core.ts` to the validator surface production reaches — `PlanValidationError` and `projectPlanValidation` — with the compiler deciding which bodies were genuinely unreachable, and remove the two orphans in `runtime/v4_runtime.ts` (the unused `READ_ONLY_V3_COMMANDS` set and `retiredResponse`'s unused `command` and `args` parameters). Plan validation behavior, the `imm-plan` projection, and the v3 retirement messages are unchanged; the plan-signature helpers, which no production caller reached, are gone.

- [`6ea8283`](https://github.com/dereknex/immune-brain/commit/6ea82832decddf847c420a643e5310b847287c46) Thanks [@dereknex](https://github.com/dereknex)! - Remove the retired authority-observation island — observation, automatic observations, legacy state mapping, readiness, readiness evidence, and authority commit receipts — together with the tests whose only subject was that code, and narrow the published `files` list to match. The TaskRecord v3 read path, the `imm-kernel audit --legacy` reader, and the storage-layout migration stay.

- [`059786f`](https://github.com/dereknex/immune-brain/commit/059786fa462b253f84981901c1e0515824fd12a3) Thanks [@dereknex](https://github.com/dereknex)! - Move the batch preflight both Host adapters duplicated into one shared projection (`runtime/unattended/batch_preflight.ts`): claim ownership, branch availability, working-tree cleanliness against the authorized child scope, reconstructed recovery children, plan digest, and base HEAD are now decided once below the Host boundary, and the post-confirmation drift check re-runs the same implementations. Each adapter keeps only its confirmation transport, failure envelope, and non-interactive refusal. `findExistingActiveBatch` now filters terminal states and has a single implementation, so a settled batch is no longer treated as active — while the settled record's identity still drives the runner's idempotent terminal replay instead of a parallel run.

- [`482b132`](https://github.com/dereknex/immune-brain/commit/482b1321bd49ca32e8bd00713f8f9805254280c5) Thanks [@dereknex](https://github.com/dereknex)! - Make one frozen table (`runtime/unattended/batch_reasons.ts`) the only producer of batch-gate reason and recovery prose on both Hosts, so the same condition reads identically by construction instead of because two copies still agree. Every migrated message keeps its exact text and recovery action; only a Host's own transport form (a returned envelope versus a thrown native error) stays with that Host. The dual-host parity assertions that compared the two adapters' reason strings are retired and restated as the property that can still fail: no adapter may carry a copy of the table's prose again.

- [`3635893`](https://github.com/dereknex/immune-brain/commit/36358931becdc469daa379535093982170a80b02) Thanks [@dereknex](https://github.com/dereknex)! - ADR-0008 now matches the batch runtime it describes and is settled. Its
  reuse/expiry decision is attributed to the shared implementation that owns it —
  `projectBatchPreflight`, `authorizeBatch`, and `projectBatchDrift` in
  `runtime/unattended/batch_preflight.ts`, with the blocker names it reuses nothing
  for — instead of the pre-extraction claim, and the record states the shipped
  decision (status `accepted`) with the persisted-capability and widened-window
  options kept as rejected alternatives.

- [`5b2b9e4`](https://github.com/dereknex/immune-brain/commit/5b2b9e4870f125acbdae1b159875d2a5d0afa098) Thanks [@dereknex](https://github.com/dereknex)! - A settled Initiative is no longer treated as a resume: `projectBatchPreflight` and `projectBatchDrift` now derive `is_resuming` once from the active batch record, so a fresh batch over a settled record issues the default 8h budget instead of inheriting an expired deadline from the old run (which made authorization impossible), while the settled record's children still replay from their own states instead of every child being reconstructed as `already_settled`.

- [`6c66311`](https://github.com/dereknex/immune-brain/commit/6c6631157ed70f7afeb278fec4961c87ed015710) Thanks [@dereknex](https://github.com/dereknex)! - Both Host adapters now call one shared authorization flow (`authorizeBatch` in `runtime/unattended/batch_preflight.ts`) after the shared preflight: the ADR-0005 reuse/expiry decision, the literal-user gate, the post-gate claim/drift cascade, and the `BatchAuthorizationBinding` construction live below the Host boundary. The Pi and Claude adapters keep only their own gate transport, confirmation reference, and failure-envelope shape, so a batch decision can no longer drift between the two Hosts.

- [`9180330`](https://github.com/dereknex/immune-brain/commit/9180330144529e7f34048cf721e1433f84a9ac1f) Thanks [@dereknex](https://github.com/dereknex)! - The non-interactive refusal in the Pi batch entry point lives in one helper the
  registered tool surface and the batch entry point both call, so the refusal text
  and its recovery hint cannot drift between them. The comment that described
  `isOwnBatchClaim` while sitting above an unrelated interface moves to the
  function's own definition in `runtime/unattended/batch_preflight.ts`, where it
  also records the evidence it checks and why `confirmation_time` is deliberately
  not part of it.

- [`fe9b2fe`](https://github.com/dereknex/immune-brain/commit/fe9b2fe5ced50188d7cc2c9e12f1bbe3403268c5) Thanks [@dereknex](https://github.com/dereknex)! - Two suites now prove behavior by running it. The batch-plan Spec-binding refusal
  is driven through `enrollCanaryTask` itself — for a child with no Spec path, one
  with a single declared half, and one whose two halves never pair — and asserted
  on the refusal the enrollment path returns, with no TaskRecord or claim written.
  The dual-host conformance scenarios that proved adapter routing by matching
  adapter source text now drive the real entry points: a cancelled breaking
  revision against a git that lies about `update-index` must surface the shared
  restore failure on both Hosts, and `request_authorization` on each Host must
  answer with the shared authorization derivation.

- [`3b7c31f`](https://github.com/dereknex/immune-brain/commit/3b7c31fb2d03ff2843189953b55c3c4ee458a178) Thanks [@dereknex](https://github.com/dereknex)! - ADR-0006 and ADR-0007 record the decisions they were drafted around instead of
  an open options list: the Review handoff stays a foreground obligation of the
  literal user's Host session and the runtime never dispatches or receipts a
  reviewer, and a parked child keeps its claim with no second record introduced.
  Both records carry `status: accepted`, and their unimplemented options move to
  rejected alternatives with the reasons that keep them rejected.

- [`5605ba6`](https://github.com/dereknex/immune-brain/commit/5605ba6c6d5725d165d7ab96ed39c87ec5d8140b) Thanks [@dereknex](https://github.com/dereknex)! - ADR-0009 records the accepted decision that the three settled Slices frozen on
  bun `1.3.14` — `wc-host-neutral-contract-tool-names`, `wc-behavioral-guardrails`,
  and `wc-batch-resume-single-gate` — permanently lose their frozen re-verification
  path once the host runner moved to `1.4.2`, which
  `runtime/assurance/verification.ts`'s `assertRunnerCompatible` now refuses. Their
  `1.3.14` descriptors stay as historical evidence, and protection for shipped
  Slices is `main`'s standing test suite rather than a re-openable frozen artifact.

- [`d5db962`](https://github.com/dereknex/immune-brain/commit/d5db962312f9283f17cde4066df35611e4fcce5f) Thanks [@dereknex](https://github.com/dereknex)! - The Claude Host pays for the post-settlement GitHub tracker projection only when
  the call actually settled its task. `withTerminalTracker` reads the Kernel
  identity the shared step needs through `settledKernelResult`, which admits the
  coordinator's `completed`/`stopped` outcomes and a committed `done`/`stopped`
  lifecycle, so an advance, review submission, or privileged mutation that leaves
  the task active no longer spends a full projection read on a tracker step that
  could not have marked anything.

- [`8ad09cb`](https://github.com/dereknex/immune-brain/commit/8ad09cba2ffac0fdf2f735694c42f463a5e8cc36) Thanks [@dereknex](https://github.com/dereknex)! - The Spec-binding refusal now names what the TaskIntent still has to add, and the
  Claude bundle is regenerated with it. `inspectSpecBinding`'s binding_missing
  fallback is reachable for the scope_hint shapes that declare Spec halves which
  never pair, and it returns those concrete unpaired paths instead of an empty
  `missing` and a generic message; the genuinely-empty case keeps its generic
  message because it has no path to name, and a complete pair carrying an unpaired
  half stays `binding_incomplete`. `batch_plan.ts` renders the paths of every
  refusal that carries them through one branch, so its unreachable
  `SPEC_BINDING_REASONS.binding_incomplete` entry is gone.

- [`146dd14`](https://github.com/dereknex/immune-brain/commit/146dd1442b3cd2c259d57fa7002f28ee4f1daf1b) Thanks [@dereknex](https://github.com/dereknex)! - The coverage retired with `tests/kernel-r2a-boundary.test.ts` has a named
  successor in `tests/kernel-shadow-cli.test.ts`: the unknown-command case now
  also exercises the literal `readiness --json` invocation, asserting the same
  `invalid_command` refusal with `.imm/state/workspace.json` left uncreated, and
  records that the retired top-level token deliberately appends no friction journal
  entry while the arbitrary unknown token still does.

- [`ab02218`](https://github.com/dereknex/immune-brain/commit/ab02218469926f49cdd4a2b6dee4e4580849d805) Thanks [@dereknex](https://github.com/dereknex)! - `noUnusedLocals` is enabled, so an unused import or local now fails
  `bun run typecheck` instead of surviving review, and the unused symbols it
  surfaced are gone: the orphaned imports S9/S13 left behind in the Claude port and
  both Pi extension entries, plus the pre-existing unused imports, constants, and
  locals in the rest of the runtime and scripts. Two removals keep the effect they
  had — the Claude enrollment call and the Kernel authority consume still run as
  statements — and the checked-in Claude bundle is regenerated.

- [`0f034bc`](https://github.com/dereknex/immune-brain/commit/0f034bca7b0be806a1e5b23503ca59620aa9cb0a) Thanks [@dereknex](https://github.com/dereknex)! - The superseded source-text guards are retired now that the behavioral guards cover the same regressions across both Host adapters. The batch worktree/push prohibition no longer scans runner sources for the words: a second behavioral leg drives the Pi and Claude batch entry points against a recording `git` and asserts neither adapter emits a mutating, `worktree`, or `push` vector, alongside the existing runtime leg. The v3-island suite drops its test-file-path coverage table in favour of the production import closure, and its retirement scans now cover `plugins/immune-brain/.pi-extension/` as well as `runtime/claude/`, asserted explicitly so neither adapter can fall out of scope.

- [`760d3ee`](https://github.com/dereknex/immune-brain/commit/760d3ee73abc05b947a406295e6c296dab44eada) Thanks [@dereknex](https://github.com/dereknex)! - The Claude Host's post-settlement GitHub tracker projection no longer runs inside the `authorize` try/catch that owns Kernel-mutation rollback: a projection failure that happens after `app.execute` has already committed can no longer restore the staged intent or rethrow an error a caller could read as "the mutation did not happen" and retry. The committed result is returned unchanged, with the tracker failure reported beside it as a retryable observation failure.

- [`be260b2`](https://github.com/dereknex/immune-brain/commit/be260b203a294dc58c62bb5e494ec76d215840d2) Thanks [@dereknex](https://github.com/dereknex)! - The packaged-contract tool-surface guard no longer passes silently when a contract names a Tool that no Host registers: a backticked name the contract itself spells as a `Tool`/`Operation` is now a failure when it resolves on zero Host surfaces, not only when it resolves on one. Its pre-change comparison also reads the actual pre-change contract text at test time (`git show aecf5dd^:<path>`) instead of a hardcoded paraphrase, so the case that proves the guard catches the HTN-2 regression cannot drift from what the guard really rejected.

## 3.6.9

### Patch Changes

- [`6e3f370`](https://github.com/dereknex/immune-brain/commit/6e3f3705971326d90c9149f9bd6d0287dbe87810) Thanks [@dereknex](https://github.com/dereknex)! - Publish readable GitHub tracker Issues: titles are composed from bounded Planner display names (`[<short_name>] <title>` for the Parent, `[<short_name>] S<n> <title>` for Children) instead of the full goal text, Children carry the repository's `ready-for-agent` and `blocked` labels while the Parent carries none, Issue bodies no longer repeat the title or the opt-in/Lifecycle/Authority stanzas, and a declared `projection.source_issue` renders a Provenance link.

- [`bc1b6f9`](https://github.com/dereknex/immune-brain/commit/bc1b6f90785871b7d585d329a501d94713943e5c) Thanks [@dereknex](https://github.com/dereknex)! - Add the public `imm-review-retro` Skill: rank models by the code review their own edits triggered and report basic project usage from pi session logs. Standalone host-native entry; no Managed Path or Kernel authority change.

## 3.6.8

### Patch Changes

- [`699ac64`](https://github.com/dereknex/immune-brain/commit/699ac64c4edee410f6b2e235680bb4382191da3f) Thanks [@dereknex](https://github.com/dereknex)! - Register the unattended batch tool in the Pi host extension manifest and document tracker issue slug extraction. The extension entry manifest (`plugins/immune-brain/.pi-extension/package.json`) now lists `./imm-unattended-batch.ts`, allowing Pi to discover and load `start_unattended_batch` for executing multi-task Initiatives after native confirmation. Also clarifies resolving an Initiative tracker issue to its `initiative_slug` in `dist/imm-loop.md`.

- [`923c0a9`](https://github.com/dereknex/immune-brain/commit/923c0a9463c52a533bbd04e10d80a8cf35f6abd5) Thanks [@dereknex](https://github.com/dereknex)! - Enhance the unified interaction UI with pipeline milestone progress, single-key authority decisions, and structured summary formatting. The Task Rail and task overview overlay now display pipeline milestone progress (`[1.Plan] ─ [2.Exec] ─ [3.QA] ─ [4.Review]`) across all lifecycle states. Authority dialogs highlight structured summary fields (Risk, Goal, Acceptance) and support single-key decisions (`y` to confirm/authorize, `n` to cancel/decline). Tool row results render micro-execution facts when present, terminal settlement outputs a clear Final Settlement summary card, and long file paths intelligently preserve the trailing filename during terminal width truncation.

## 3.6.7

### Patch Changes

- [#61](https://github.com/dereknex/immune-brain/pull/61) [`3a8070a`](https://github.com/dereknex/immune-brain/commit/3a8070a39f4629176a992956bb2f7fe3d8e960c6) Thanks [@dereknex](https://github.com/dereknex)! - Implement the Claude Code native Host confirmation gate for unattended batch runs (`start_unattended_batch`), fail-closed on non-interactive sessions with plan digest binding, zero writes on decline/cancel, and full lineage verification.

- [#61](https://github.com/dereknex/immune-brain/pull/61) [`df0c411`](https://github.com/dereknex/immune-brain/commit/df0c411555d4bd160b41f5f65c7fcecc7999fdd7) Thanks [@dereknex](https://github.com/dereknex)! - Add the Pi Host gate for unattended initiative batch runs and prove dual-host parity: the Pi extension now presents the Kernel-derived batch confirmation through its native TUI, issues the same Batch Authorization through the shared registry and `startBatch` driver, and a shared conformance test asserts both Hosts accept and refuse the identical batch identically.

- [#61](https://github.com/dereknex/immune-brain/pull/61) [`3905728`](https://github.com/dereknex/immune-brain/commit/39057280fc26449a2d2d6101c5aacf25a4b76cd5) Thanks [@dereknex](https://github.com/dereknex)! - Document unattended batch runs as a declared capability and repair the regressions that surfaced with them: `imm-loop`'s contract now names the `start_unattended_batch` opt-in and its limits, `IMMUNE.md`/`CONTEXT.md` carry the Batch Authorization, batch plan, plan digest, HEAD lineage and batch branch vocabulary plus the sole batch-state owners, ADR 0005 records the reopened decision, and per-host session isolation, the Pi Enrollment boundary, post-freeze intent resolution, the settled-child resume scope and the checked-in Claude bundle are back in line.

- [#62](https://github.com/dereknex/immune-brain/pull/62) [`a686673`](https://github.com/dereknex/immune-brain/commit/a68667385ec6c9322cd7eb5e6a3a341d327d91ec) Thanks [@dereknex](https://github.com/dereknex)! - Carry refuted Review findings as derived state with executable counterevidence: a Review rework finding now carries the reviewer's evidence and a Kernel-derived anchor, the new `refute_finding` operation is reachable from both Hosts and binds only a fresh passing QA attestation covering the finding's own acceptance, a re-submitted claim inherits the still-live refutation for its anchor instead of reopening as bare blocking work, and the refutation loses force — without rewriting stored state — as soon as its evidence goes stale for the current revision, intent hash or diff. The TaskRecord parse and append-only update invariants fail closed on anchor/evidence pairs that do not match, counterevidence no QA attestation backs, refuted user-decision or replan findings, and transitions that rewrite finding fields they do not own.

- [`e75c5e8`](https://github.com/dereknex/immune-brain/commit/e75c5e859e7464d5042d4c269ebc2c04e02e3cbe) Thanks [@dereknex](https://github.com/dereknex)! - Reduce Immune-Brain interference with unrelated Skills by removing Managed workflow explanations from the repository agent instructions.

## 3.6.6

### Patch Changes

- [`b1d8696`](https://github.com/dereknex/immune-brain/commit/b1d8696501fd7e97e5ce38132f43256a71cd6b65) Thanks [@dereknex](https://github.com/dereknex)! - Unattended batch runs: Git branch preflight and scope-bounded child commits

  Batch preflight now requires a clean tree (including untracked files and dirty
  submodules), a committed HEAD, a verified top-level repository root, and the
  absence of `imm/<initiative-slug>` before any state is written. Child commits
  are created only after Kernel settlement, staged strictly within the child's
  TaskIntent scope plus its audit directory, verified against branch/HEAD
  lineage and the committed tree delta, and backed by durable commit evidence so
  crash recovery can distinguish its own commits from forged external ones.
  Also fixes the bun runner resolution under mise/asdf shims.

## 3.6.5

### Patch Changes

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Carry the assurance fixes found while running the first real batch

  Driving an enrolled batch through both Hosts surfaced five boundaries that
  stopped a task with no way forward:

  - A user can now authorize rework continuation directly, without escalating a
    routine rework to the reviewer.
  - A malformed Review receipt is recovered from durable evidence instead of
    pinning the task in a state no operation can leave.
  - The Claude Host exposes `resolve_finding`, so a closed finding on that Host no
    longer requires switching to Pi.
  - Published GitHub Issues carry their own public acceptance summary instead of
    the canonical TaskIntent assertion prose. The projected text stays within
    1–500 characters, and the input limit now accepts a summary that matches a
    canonical assertion length rather than rejecting the whole batch.

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Stop a Managed task from Pi with one native confirmation

  Kernel already settled tasks on `stop`, but the Pi extension exposed no user
  reachable entry, so a task holding the workspace claim could not be released
  without editing `.imm` state by hand.

  `imm_kernel_canary` accepts `action: {op: request_stop}` for an eligible
  `active` or `frozen` task, including one waiting on Review or a replan gate.
  The Host opens one native confirmation, builds the stop authority itself, and
  the Kernel performs the existing stop settlement: terminal TaskRecord,
  terminal proof, archived planning artifacts and a released claim. Unrelated
  and implementation files are preserved.

  Cancelling, timing out, aborting, or closing the session before the commit
  mutates nothing, and a stop preparation failure releases the invocation so the
  same session can retry. Concurrent Assurance work and a snapshot that moved
  under the request are rejected rather than overwritten; a confirmed stop
  invalidates outstanding Review resources so a late verdict cannot rewrite
  terminal evidence. A delivery failure after the commit is reported separately
  and does not undo the stop.

- [#52](https://github.com/dereknex/immune-brain/pull/52) [`439658a`](https://github.com/dereknex/immune-brain/commit/439658abaaa1064fd570977a1c9d457a1f2054bf) Thanks [@dereknex](https://github.com/dereknex)! - Run one confirmed Initiative batch serially and resume it after a crash

  A confirmed batch plan had no executor that could survive an interruption: a
  child could be enrolled, settled and committed at three separate points, and
  restarting the run re-derived none of them.

  `startBatch` and `resumeBatch` now drive one eligible child at a time through
  enroll → advance → commit, and a resumed run adopts whatever the previous
  process had already persisted. Recovery shares the dependency-aware child
  selection rule with the normal loop instead of re-implementing it, so a
  reverse-ordered plan resumes identically to a forward-ordered one.

  Renewed authorization no longer loses the consumption history of children that
  were already committed. Before the next enrollment the driver verifies each
  committed child against the batch commit ledger, so a stale or fabricated
  `committed` flag cannot report a completed batch, and HEAD lineage stays
  enforced for the first enrollment of a fresh authorization.

  Persistence derives its path from a validated `batch_id` at every entrypoint,
  so a caller cannot escape `.imm/state/batches/`, and the replan gate keeps
  QA rework and Review rework on separate counters.

## 3.6.4

### Patch Changes

- [#39](https://github.com/dereknex/immune-brain/pull/39) [`5a14619`](https://github.com/dereknex/immune-brain/commit/5a14619ad8e2b383c5c99646d46b689e554c837b) Thanks [@dereknex](https://github.com/dereknex)! - Publish the full Review revision identity from the Claude Host

  `submitReview` re-derives the Review revision and compares `base_head`,
  `review_commit`, `review_tree` and `manifest_digest` against the reservation. The
  Claude Host adapter returned only the commit identity, so the last comparison put
  a real digest against `undefined` and every TaskRecord v4 submission stopped with
  `review_preparation_failed: Review revision changed before submission` — an
  unfalsifiable failure, because the revision it named had not moved. No Review
  could settle on that Host.

  The adapter now recomputes the manifest and republishes the same four fields the
  Review snapshot binds, using the outcomes of the settled QA attestation. The Pi
  adapter already recomputed the manifest but drew its outcomes from a preflight
  stand-in, which matched the settled attestation only because deterministic QA
  happens to write that exact summary; it now reads the attestation too, so both
  hosts agree by construction rather than by coincidence.

  Adds `tests/review-revision-identity-conformance.test.ts`, which drives a real
  repository and a real TaskRecord through `advance` and `submitReview`. A port
  double cannot express this defect, which is why the existing coordinator suites
  never saw it.

- [#40](https://github.com/dereknex/immune-brain/pull/40) [`934115b`](https://github.com/dereknex/immune-brain/commit/934115b9c3fb4cdce100321d8930209faa413297) Thanks [@dereknex](https://github.com/dereknex)! - Typecheck the repository and gate every pull request

  Four host-adapter defects reached published plugins in a row. The systemic cause
  was not any one of them: this repository had never been type checked, and no
  check ran before a merge.

  There was no `tsconfig.json`, no `tsc` invocation anywhere, and TypeScript was
  not even a dependency. Turning the compiler on reported 59 errors in the runtime
  and script sources, 17 of them (36%) in `runtime/claude/kernel_ports.ts` and
  `runtime/claude/review_host.ts` — the two files that produced three of the four
  escapes. The compiler was already pointing at the shipped defect family:
  `'{ review_revision?: … }' is not assignable to 'TaskApprovalV2'` and
  `Property 'git_base_head' does not exist on type 'TaskRecord'`.

  All 59 are fixed, none by widening to `any`. The substantive ones:

  - The Claude approval literal was untyped, so `kind` widened to `string` and
    every check on `review_revision` — the exact field family that shipped broken
    four times — was disabled. It is now a declared `TaskApprovalV2`.
  - Reading `git_base_head` off a `TaskRecord` union tested the contract string
    into a plain boolean, which does not narrow. Adds `isTaskRecordV4`, and both
    host adapters now prove the field is present before binding a revision.
  - `runtime/claude/review_host.ts` matched a reservation on `sessionId` and
    `agentId`, which `PendingReview` never declared; every check was inert and the
    function had no callers. Removed.
  - `commitEnrollmentLocked` was declared as returning a v2 record while returning
    a v4 one, and `JournalReasonCode` was missing the 13 codes the Kernel CLI
    actually emits.
  - A `TaskTombstone` could be written with `terminal_lifecycle: "active"`, which
    its own contract forbids; settlement now refuses a nonterminal record.
  - `failCanaryTool` could not report `review_preparation_failed`, a declared
    `ToolFailureV1` state and a documented Loop recovery path.
  - `notifyOnce` was called through a coordinator port that supplies no UI.

  Closes the type-level hole behind the last escape: `ReviewRevision.manifest_digest`
  was optional, so a host returning the bare commit identity still satisfied
  `ensureReviewRevision`. The bare identity is now a separate
  `ReviewRevisionCommit`, and omitting the digest fails the build instead of every
  v4 submission at runtime. Deletes the unused `ensureReviewRevision` export that
  defined the loose shape.

  Makes the production port wiring reachable from tests. `ClaudeRuntime.kernelPorts()`
  returns the object the coordinator actually runs on, and its `ports` option now
  layers overrides on top of it rather than replacing it wholesale; the Pi ports
  move out of an anonymous default export into
  `createPiAssuranceProgressionPorts`. Every escaped defect lived in these two
  objects, and neither was constructible from a test.

  Adds `.github/workflows/ci.yml` on `pull_request`, running typecheck, the
  plugin build and doc sync checks, versioning validation and `bun test`. Adds
  `bun run typecheck` and wires it into `verify:release`.

## 3.6.3

### Patch Changes

- [#37](https://github.com/dereknex/immune-brain/pull/37) [`89254ef`](https://github.com/dereknex/immune-brain/commit/89254ef60b07c3996624dc1b64831f406d931314) Thanks [@dereknex](https://github.com/dereknex)! - Settle Claude Host Review from the async Agent transcript

  The Claude Code Host reconstructed the Review receipt from the `Agent` tool's
  `PostToolUse` result, assuming that result was the reviewer's verdict. This
  Claude Code build runs every `Agent` call asynchronously — `run_in_background:
false` is not honoured and there is no synchronous mode — so the result is a
  launch receipt (`{"isAsync":true,"status":"async_launched",…}`) and never the
  verdict. No Review could be consumed on that Host.

  `inspectReview` now recognises the launch receipt, cross-checks the `agentId`
  against the `SubagentStart`/`SubagentStop` pair it already observed, and reads
  the reviewer's terminal message from the transcript the receipt names, matching
  the writing `agentId` per record. There is no fallback to Parent-supplied bytes:
  an unreadable or silent transcript fails closed, because an optional weaker path
  is one the Parent could force.

  A stale `SessionEnd` no longer discards live evidence. A resumed session reuses
  its id and hook log, so an end recorded for the previous run could sit ahead of
  the current run's events; draining cleared the whole log and stopped there. It
  now advances surviving reservations past the end — keeping pre-end events
  unusable — and reclaims the log only when nothing followed. `prepareReview`
  also drains before taking its cursors.

  Adds `tests/claude-review-host-async-agent.test.ts`, whose fixtures are recorded
  from Claude Code 2.1.261 rather than reconstructed from the documented shapes.

## 3.6.2

### Patch Changes

- [#35](https://github.com/dereknex/immune-brain/pull/35) [`0464612`](https://github.com/dereknex/immune-brain/commit/04646126c0ae3cbdf63663fb3f6b20240a74fdfc) Thanks [@dereknex](https://github.com/dereknex)! - Resolve packaged internal role prompts from the shipped bundle layout

  `loadRolePrompt` walked one directory up from the module that contains it and
  looked for `dist/role-prompts/`. That is correct from source, where the module
  sits in `runtime/` beside `dist/`, but the Claude Code Host loads the bundle at
  `dist/claude/mcp-server.mjs`, where the same walk computes a `dist/dist/` that
  never exists. Every internal role prompt therefore failed to load on the Claude
  Host, blocking Review delegation. The resolver now searches both layouts.

## 3.6.1

### Patch Changes

- [#33](https://github.com/dereknex/immune-brain/pull/33) [`2657d08`](https://github.com/dereknex/immune-brain/commit/2657d082052c7000d28b66eb51dcb671c3691489) Thanks [@dereknex](https://github.com/dereknex)! - Resolve the TaskIntent sidecar through the TaskRecord on the Claude Code Host.

  `freeze_artifacts` relocates `docs/plans/<task-id>.intent.json` into
  `docs/plans/archive/`, but the Claude adapter read every intent at the pre-freeze
  default path. Any Managed task therefore failed QA settlement with a raw `ENOENT`
  once its artifacts were frozen, which no test covered because every settled task
  in this repository had run on Pi.

  - `runtime/claude/kernel_ports.ts` now reads through `intent_ref.path` at all five
    call sites, matching the Pi adapter.
  - `runtime/kernel/intent.ts` resolves a path-less read to the sidecar that exists —
    active first, archive as the post-freeze fallback — and reports a missing sidecar
    as a stable contract failure instead of a raw filesystem error.
  - `runtime/assurance/coordinator.ts` proves a rejected ordinary mutation wrote
    nothing by re-reading the record revision, so a Kernel precondition rejection is
    reported as a deterministic failure rather than `settlement_unknown`, which the
    Loop would otherwise retry forever.
  - `dist/imm-loop.md` carries the Initiative carrier gate it actually performs, so a
    failed `publish-initiative` batch can no longer be cleared by re-entering the Loop.

## 3.6.0

### Minor Changes

- [`35a46f7`](https://github.com/dereknex/immune-brain/commit/35a46f7541ec413f51032a6d4f18b0d9ba831e24) Thanks [@dereknex](https://github.com/dereknex)! - Make Initiative carrier resolution host-portable and remove its silent default. Planner now reads the repository and user-level agent instruction files directly instead of assuming the Host injected `AGENTS.md` into context, so a configured carrier is no longer ignored on Hosts that auto-load `CLAUDE.md` or never read `~/.pi/agent/AGENTS.md`. When no valid directive is found, Planner asks and reports which sources it checked rather than silently resolving to `local` or `github`.

## 3.5.0

### Minor Changes

- [`75842d3`](https://github.com/dereknex/immune-brain/commit/75842d36c6c9cff625e29140cd512a6417e7344c) Thanks [@dereknex](https://github.com/dereknex)! - Deepen Task Rail acceptance-progress row with granular lifecycle phases and introduce the read-only `/imm-tasks` command and modal overview.

## 3.4.0

### Minor Changes

- [`6d7d645`](https://github.com/dereknex/immune-brain/commit/6d7d6457a03ff25bdbe82b36d2139c149527d952) Thanks [@dereknex](https://github.com/dereknex)! - Replace Claude permission-Hook authorization with digest-bound server-initiated MCP elicitation, make Managed authority guidance Host-neutral, and raise the verified Claude Code minimum to 2.1.236.

## 3.3.0

### Minor Changes

- [`e5e41ac`](https://github.com/dereknex/immune-brain/commit/e5e41ac9b43d2b367d3c88918d101eba3ee74a11) Thanks [@dereknex](https://github.com/dereknex)! - Retire the critical user approval gate from Kernel settlement. Fresh QA and any required Review now settle tasks automatically; the former critical-completion confirmation gate is removed, and `request_authorization` is reserved for unresolved user decisions and explicit stop. User authority stays bound to unresolved decisions, explicit stop, breaking Intent revisions, and concrete exception operations rather than risk tier alone.

## 3.2.2

### Patch Changes

- [`af66a62`](https://github.com/dereknex/immune-brain/commit/af66a62df426d84b2f51cbd2a9ae7216050a04e3) Thanks [@dereknex](https://github.com/dereknex)! - Slim public skill entry points to minimal canonical-contract loaders: imm-planner, imm-loop, and imm-agent-doc-maintain SKILL.md files no longer duplicate contract prose and instead identify and load their dist/ packaged contracts; contract tests and the dist sync manifest enforce the loader shape.

## 3.2.1

### Patch Changes

- [`f031290`](https://github.com/dereknex/immune-brain/commit/f031290002748d23b414e73ff063a3a0a1471b49) Thanks [@dereknex](https://github.com/dereknex)! - Use Changesets as the only version bump and publish entrypoint while retaining manifest synchronization and validation for the Claude Code plugin.

## 3.2.0

### Minor Changes

- [`32d6538`](https://github.com/dereknex/immune-brain/commit/32d6538330d794385f1294c2565b3edfc9e2a1c0) Thanks [@dereknex](https://github.com/dereknex)! - Replace incremental GitHub Initiative Issue creation with one complete publication batch.

  Planner now presents the full Parent/Child decomposition, granularity, dependencies, and execution order for one user decision before any remote mutation. After approval, `imm-tracker publish-initiative --stdin --json` validates every tracked TaskIntent and the complete dependency graph, idempotently publishes and verifies all native Issue relationships, links each Child to its Parent, and returns the recommended first Issue, stable order, and parallel groups.

  The former `create-initiative` and `upsert-task` CLI entrypoints are removed. Existing terminal Issue projection remains unchanged.

- [`dc76728`](https://github.com/dereknex/immune-brain/commit/dc767286cace89bc111b0984a1af0fdfd73c72d) Thanks [@dereknex](https://github.com/dereknex)! - Add `imm-agent-doc-maintain` as the sixth public standalone maintenance skill for agent-facing documentation upkeep.

## 3.0.1

### Patch Changes

- [`f0b99a0`](https://github.com/dereknex/immune-brain/commit/f0b99a0a2f1d4577f9e219aa023e6cb61e8fe8fc) Thanks [@dereknex](https://github.com/dereknex)! - Normalize JSON-string Tool action arguments before schema validation.

  `hyper/qwen3.8-flash` can emit the object-valued `action` argument of
  `imm_loop_action` and `imm_kernel_canary` as a JSON string
  (`action: "{\"op\":\"status\"}"`), which the strict TypeBox schemas previously
  rejected with repeated pre-execution failures. These Tools now recover exactly
  that observed shape through Pi's `prepareArguments` pre-validation hook: only a
  top-level `action` string that parses to a non-null, non-array object is
  recovered; native object input, invalid JSON, arrays, `null`, primitives, and
  all other malformed input still fail the unchanged strict schemas.

## 2.8.3

### Patch Changes

- [`61ccc29`](https://github.com/dereknex/immune-brain/commit/61ccc29c175edc29af7c485f795c8c33e4be8c1f) Thanks [@dereknex](https://github.com/dereknex)! - fix(tracker): avoid gh output limit exceeded by paginating snapshot and raising MAX_GH_OUTPUT

  - paginate GitHub Issues snapshot (100/page, up to 100 pages) instead of single --paginate --slurp blob
  - raise MAX_GH_OUTPUT 1MiB -> 8MiB to handle 65KB bodies without per-page overflow

## 2.2.0

### Removed

- The temporary Canary Slash Commands are removed from the Pi extension and npm package. Enrollment, assurance, authorization, interruption recovery, and successor state transitions no longer have command fallbacks or replacement aliases.

### Changed

- Repository mutation requests now enter Managed Path from natural language automatically. `imm-brainstorm`, `imm-planner`, and `imm-loop` remain the public workflow Skills.
- Enrollment and assurance continue through the foreground `imm_canary_enrollment` and `imm_kernel_canary` Tools with native TUI authorization and persistent Kernel `next_action` results.
