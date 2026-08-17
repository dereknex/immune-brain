# Spec: Host-Native Lightweight Workflow Roadmap (vNext)

**Owner**: user
**Status**: Accepted; R1, R2, R3-A, R3-B1, R3-C, R3-D1, and R3-D2 complete; R4 in progress (five deletion slices complete; v4 Plan control-plane reconciliation is the current slice); R3-B2 blocked
**Design risk**: High
**Supersedes**: deferred Phase 2 (native activity telemetry), Phase 3 (recoverable
assurance operations), and Phase 4 (authority simplification) of
[`pi-observable-assurance-orchestration-roadmap.spec.md`](pi-observable-assurance-orchestration-roadmap.spec.md),
and the unplanned Slice 4b (scope-isolated freshness).

Completed predecessor work remains in force and is not reopened:

- `2026-08-14-001` observable assurance dispatch (`19e040e`)
- `2026-08-14-002` direct package release surface (`6c726f4`)
- `2026-08-14-003` agent-requested host authorization (`5f2e412`, `9258601`)
- `2026-08-14-004` bounded native review completion (`8b60d0e`)
- `2026-08-14-005` Direct-first workflow routing (`eb35f11`)

## 1. Problem Frame

The completed assurance stack works, but operating it through a full session
proved the architecture itself is over-dense for its actual risk mix:

1. **Too many literal-user transitions.** Every review verdict, review-round
   budget gate, and stale-snapshot recovery required typed or confirmed user
   action. Routine work paid strict-mode costs.
2. **Workspace-wide freshness is the wrong blast radius.** Task 001 was halted
   by five out-of-scope file deletions invalidating all QA/Review approvals.
3. **Custom UI duplicates the host.** Immune-Brain draws its own Footer/Widget
   for jobs that `@tintinweb/pi-subagents` already renders natively — and the
   custom copy was worse (RPC-spawned reviewers are invisible in the native
   widget due to an upstream refresh bug, and the custom widget never gained
   real activity telemetry).
4. **Private abstraction where the host suffices.** Production already runs
   reviews on Pi native subagents with `ctx.model`; remaining private surfaces
   are orchestration conveniences, not trust boundaries.

The goal is not fewer safeguards; it is fewer safeguards per unit of risk.

## 2. Design Corrections Carried From Review of the External Proposal

An externally synthesized "lightweight" proposal was reviewed and its direction
adopted with three mandatory corrections:

1. **"Git worktree clean" is not a completion condition.** It reproduces the
   Task 001 failure. Completion requires: verification passing, the task-scoped
   diff stable across assurance, and no unresolved failures. Unrelated dirty
   files never block or stale task evidence.
2. **The confirmation surface is wider than "destructive + credentials".**
   Always-confirm also covers publish/release, deploy, external writes, git
   history rewrite, permission changes, risk overrides, enrollment, and any
   authority-discarding operation (e.g. Kernel `stop`).
3. **"100% no private code" is a means mistaken for a goal.** The target is
   Host-first: delete shallow wrappers; keep deep modules carrying semantics Pi
   does not provide (snapshot digest, CAS, authority binding, strict
   verification descriptors), each with an explicit exit plan.

## 3. Target Architecture

### 3.1 Two execution paths

**Direct Path** — low-risk, scoped, locally verifiable work:

```text
risk routing → Agent edits → focused verification → scoped self-review → done/commit
```

- No Plan, TaskIntent, TaskRecord, QA, Review, or Compounder.
- No `.imm` workflow writes.
- Read-only probes, local tests, and formatting run without confirmation.
- Unrelated dirty files neither block nor enter commits.
- Automatic commit only when the task owns the entire staged diff; otherwise
  stop at ready-to-commit.

**Managed Path** — security, migration, concurrency, public interface, release,
multi-repo, or explicitly requested audit work:

```text
single TaskIntent → continuous implementation → one batched verification
→ one Pi native Review → completion
```

Current behavior:

- No per-step QA. Evidence is recorded once, batched. Critical tasks still
  require a final deterministic QA approval.
- Native Review JSON remains advisory. Literal-user `record-review-verdict`
  confirmation remains load-bearing because current Pi does not expose a
  package-independent terminal receipt that binds final post-middleware
  arguments and the final result.
- Review `rework` returns to `working` after that confirmation. A second rework
  stays in `review` and writes `replan_required`.
- Disk TaskRecord remains the recovery authority; nothing depends on session
  memory.
- Compounder does not block Kernel completion. R3-D2 verified this; no code
  change was required.

Target, blocked on an official Pi host receipt (R3-B2; see §3.3):

- Review `pass` is recorded automatically from a host-attested receipt binding
  the exact operation, immutable snapshot, and terminal result.
- Review `rework` returns to coding automatically; no routine user confirmation.

The Direct/Managed split is decided by a frozen risk matrix, not a target
ratio. Any observed percentage is a metric, not a design input.

### 3.2 Interaction surfaces (Host-native UI)

| Surface | Owner | Use |
| --- | --- | --- |
| `todowrite` todo panel | Parent Agent | The single user-visible progress ledger for all work |
| pi-subagents Widget/Fleet | `@tintinweb/pi-subagents` | All subagent progress (after R1 fix) |
| pi-subagents completion notification | `@tintinweb/pi-subagents` | Visual terminal notice |
| `renderCall`/`renderResult` on `imm_kernel_canary` | Immune-Brain | Native chat rendering of assurance tool calls |
| followUp message | Immune-Brain | Authority-carrying wake-up, not decoration |
| `ctx.ui.confirm` | Immune-Brain | Privileged operations only |

Deleted surfaces: the Immune-Brain assurance Footer status, custom Widget, and
per-stage `presentQa`/`presentReview` projections. Assurance jobs shorter than
a few seconds (deterministic QA) get no progress UI at all.

### 3.3 Review trust chain (blocked; requires Rule #1437 revision)

Native Review authority becomes automatic only when official Pi verifies, from
its own side, a package-independent single-use receipt binding the exact
operation, immutable snapshot, and terminal result after all call and result
middleware. The subagent's JSON stays inert payload. Current `tool_execution_*`
events do not provide that binding, so Rule #1437 remains unchanged and
literal-user confirmation stays load-bearing. Do not implement this with a Pi
fork, a `pi-subagents` manager port, or event-bus correlation.

### 3.4 Confirmation matrix

- **Always confirm**: enrollment; publish/release; deploy; external writes;
  git history rewrite; destructive/authority-discarding operations; credential
  or permission changes; risk overrides; unresolved user decisions.
- **Never confirm**: read-only exploration, local tests, formatting, advisory
  review, routine evidence recording, routine task completion.

## 4. Phases

### R1 — Native subagent visibility (prerequisite)

**Goal**: RPC-spawned subagents render in the pi-subagents Widget/Fleet.

Root cause (verified in `@tintinweb/pi-subagents` v0.15.1): the RPC spawn path
(`cross-extension-rpc.ts`) calls `manager.spawn()` but never triggers
`widget.update()` / `ensureTimer()`; those run only from the Agent tool path,
so RPC children are invisible while running.

- Minimal upstream fix: trigger widget/fleet update and refresh timer from the
  RPC spawn (or manager `onStarted`) path; open an upstream PR.
- Verify locally with a temporary patch before relying on the fix.
- **Status (2026-08-14): complete.** Fork commit `ccb43eb` moved UI activation
  to the shared manager `onStarted` lifecycle and bound UI context at
  `session_start`. Upstream PR `tintinweb/pi-subagents#224` merged the same day
  and shipped in `@tintinweb/pi-subagents@0.16.0`. Evidence was three-layered:
  the upstream suite proved an RPC-spawned running agent calls the native Widget
  without invoking the Agent tool; an independent Pi RPC-mode host probe emitted
  `subagents = 1 running agent`; and the user observed the native Widget
  throughout a live background-agent run. The temporary
  `git:github.com/dereknex/pi-subagents@ccb43eb` pin may now return to the
  official npm package.
- **Promotion gate for R3 UI deletion**: the upstream release exists. After
  R3-B1, Review itself uses the standard `Agent` tool and is natively visible
  without depending on the RPC widget path.

### R2 — Direct-first routing

**Goal**: low-risk tasks never enter the Kernel.

**Implementation status**: complete in `2026-08-14-005` (`eb35f11`). The
canonical BASELINE, project templates, initialization output, user guidance,
packaged guidance, and five-scenario behavior fixture now use the ordered
Direct-first matrix. Contract tests and the full repository suite pass.

**Promotion status**: complete. The authorized live paid-model run
`2026-08-14T13-08-30.935Z` executed all five scenarios with
`antigravity/gemini-3.6-flash`; every scenario completed with
`question_count=0`. For `low-risk-direct-path`, the host transcript recorded
five calls (`read`, `read`, `edit`, `edit`, `bash`) in 10.346 seconds. A
machine assertion proved that its only edit targets were the fixture README and
focused Bun test, with zero workflow-state calls; the child verifier passed all
four fixture tests and `test ! -d upstreams`.

The repository `.imm` structure and content digests were identical before and
after the run (`84689f825c779435...` and `1f04e1fb5d8d7f55...`, respectively),
proving zero workflow-state mutation. Runtime advisory token/cost evidence was
unavailable (`runtime_advisory_metrics_unavailable`), so no provider cost or
precise token claim is made. Generated usage logs remain uncommitted per the
benchmark policy; this behavior observation is the R2 promotion evidence.

- Freeze the risk matrix and confirmation matrix in spec.
- Default eligible work to Direct Path: zero Plan/TaskIntent/TaskRecord, zero
  `.imm` writes, zero mandatory subagents, zero confirmations.
- Guard: managed lifecycle stays available on explicit request or risk
  escalation.
- Acceptance evidence: a real low-risk task completed with zero `.imm`
  mutations and zero confirmations.

### R3 — Managed final-only assurance

**Goal**: one managed task = one verification batch + one review. Zero routine
confirmations remains the product target; it is not the current behavior.

#### R3-A — Scope-isolated task snapshots

**Status**: complete in Task
`2026-08-14-007-managed-task-snapshot-isolation`. Task 006 stopped after its
scope omitted one required reducer contract consumer; successor 007 completed
with 5/5 fresh acceptance evidence, deterministic QA, and Native Review pass.

- Promote canonical TaskIntent `scope_hint` to the Managed ownership envelope;
  every scope change is a breaking revision.
- Bind evidence, QA, Review, authorization, and completion to one canonical
  `HEAD -> Git index` task snapshot. Explicit exact-path staging declares the
  task-owned bytes.
- Exclude out-of-scope dirty or staged paths from task identity and Review
  inputs. Reject in-scope unstaged/untracked drift, unsupported
  modes, ambiguous paths, sparse indexes, and capture races before authority
  writes or Review spawn.
- Read Review current content from captured index blob OIDs, never from the live
  parent worktree.

#### R3-B1 — Standard Agent Review dispatch

**Status**: completed in Task
`2026-08-14-009-standard-agent-review-dispatch` (`dcbebc4`). Does not change
Review authority.

- Dispatch Review through the parent Agent's standard `Agent` tool.
- Immune-Brain must not import `pi-subagents`, call cross-extension RPC, or
  encode a provider registry.
- Review JSON remains advisory. Keep `record-review-verdict` literal-user
  confirmation, snapshot isolation, CAS, and reviewer independence.
- Stale, cancelled, duplicate, and late results write nothing to Kernel.

#### R3-B2 — Automatic Review authority

**Status**: blocked product requirement. No active TaskIntent.

- Task `2026-08-14-008` was stopped before implementation because its
  `pi-subagents` manager-port premise violated the host-native boundary.
- Current Pi lifecycle events cannot bind final post-middleware arguments and
  the final result. Do not fork Pi, pin a custom host build, or treat existing
  `tool_execution_*` events as authority receipts.
- When official Pi publishes a package-independent, single-use terminal receipt,
  enroll a new TaskIntent to consume it. Until then Rule #1437 stays unchanged.

#### R3-C — Review round cap

**Status**: completed in Task
`2026-08-14-010-review-round-replan-boundary` (`53b5296`). See
[`review-round-replan-boundary.spec.md`](review-round-replan-boundary.spec.md).

- Keep the final deterministic verification batch. Do not delete QA approval
  for critical tasks.
- A second Review-authority rework stays in `review`, writes `replan_required`,
  and must not create `unresolved_user_decision` or ask the user whether to
  continue.
- Do not pretend ordinary `working` is a replan state.

#### R3-D1 — Host-native UI convergence

**Status**: completed in Task
`2026-08-14-011-host-native-assurance-ui` (`2334e5c`). See
[`host-native-assurance-ui.spec.md`](host-native-assurance-ui.spec.md).

- Delete custom assurance Footer/Widget; add `renderCall`/`renderResult` to
  `imm_kernel_canary`; keep followUp, notify, and privileged confirm.

#### R3-D2 — Optional non-blocking Compounder

**Status**: verified; no code change. Kernel `complete` depends only on fresh
acceptance evidence, required approvals, independence, and the absence of
open blocking / user-decision / `replan_required` findings. Compounder is a
v3 Plan-profile handoff after `imm-finish`, not a Kernel completion gate.

### R4 — Legacy deletion

**Status**: in progress. First slice
`2026-08-14-012-retire-unreachable-progress-extension` completed on 2026-08-15
and removed only the Pi progress UI factory closure proven absent from the
explicit extension manifest. Second slice
`2026-08-15-013-retire-legacy-progress-projection` is completed; it retired only
the now-consumerless v3 `imm-work progress` projection while preserving
`imm-work status` and `imm-kernel audit --legacy`. Third slice
`2026-08-15-014-retire-repo-legacy-runtime-launchers` completed on 2026-08-15;
it removed repository-owned launchers and current architecture text that
selected the legacy dispatcher. Fourth slice
`2026-08-15-015-retire-packaged-legacy-cli-fallbacks` was stopped after the
shipped-contract edits landed: `acc-activation-reference` incorrectly required
byte-identical source/packaged activation-policy copies, which conflicts with
the existing adapted `dist/docs` generator. Successor
`2026-08-15-016-retire-packaged-legacy-cli-fallbacks` completed on 2026-08-15;
it restated that assertion against the generated adapted form and retired the
shipped legacy CLI fallbacks. Fifth slice
`2026-08-15-017-retire-code-review-activation-cli-fallback` completed on
2026-08-15; it removed the retired `imm-activation-plan` ladder from shipped
`imm-code-review` contracts. The next executable slice
`2026-08-15-018-reconcile-v4-plan-control-plane` completed on 2026-08-15;
it restored genuine `imm-plan --routing-status --json` routing-policy
projections and explicit read-only Plan validation in the shipped v4 router
before further deletion. The next executable slice
`2026-08-15-019-shrink-kernel-cli-surface` completed on 2026-08-15;
it removed the retired `migrate/readiness/journal` CLI branches from
`commands/kernel.ts` and made `status`/`audit` strictly read-only. The next
executable slice `2026-08-15-020-drain-legacy-runtime-test-callers`
implemented the drain (30 test files deleted, 3 trimmed, 4 subprocess tests
migrated to `v4_runtime.ts`) on 2026-08-15 but was stopped: its enrolled
acceptance assertions under-listed the migration targets and reference
inventory, and the TUI breaking-revision payload path cannot correct them.
Successor `2026-08-15-021-drain-legacy-runtime-test-callers` restates the
same shipped state with corrected assertions and completed on 2026-08-15.
`2026-08-15-022-retire-legacy-v3-dispatcher` completed on 2026-08-15: it
deleted the retired v3 dispatcher and its five v3 command modules, flipped
the six remaining existence assertions to absence assertions, and updated
the benchmark fixture literals to the v4 router.
`2026-08-15-023-retire-public-skill-aliases` completed on 2026-08-15: it
retired the four public Skill compatibility entries
(`debug-investigator`, `imm-page-design`, `imm-party`,
`imm-preplan-review`) by migrating their remaining behavior contracts into
the canonical skills and removing the registry entries and packaged alias
docs. The Phase 5 R4 deletion line is complete; remaining work is R3-B2
automatic Review authority, blocked on an official Pi terminal receipt.

**Goal**: delete code whose callers disappeared in R2/R3.

- v3 runtime/command layer remnants and retired routing shims, after callers
  disappear.
- Session-local pending-verdict machinery and `/imm-canary-authorize` for
  routine Review verdicts only after R3-B2. Until then those paths remain
  load-bearing.
- Custom assurance Footer/Widget only after R3-D1.
- Any other abstraction failing the deletion test after R2/R3.

Rule: product semantics change first; deletion follows proven-unused callers,
never the reverse.

## 5. Exit Metrics

- Direct task: 0 Plan, 0 TaskRecord, 0 QA, 0 review confirmation.
- Managed task, current: at most one verification batch and one Review; Review
  verdict still requires literal-user confirmation.
- Managed task, target after R3-B2: normal completion needs 0 manual
  confirmations.
- Privileged operation: exactly one host confirmation.
- Out-of-scope dirty files never stale task evidence.
- Production contains no `AgentSession`, no private credential or model
  runtime.
- Normal flow requires no typed `/imm-*` command.
- Workflow state is always recoverable from disk without session memory.

## 6. Explicit Non-goals

- Cross-session subagent reconnection or durable job queues (former Phase 3).
- Consuming native fine-grained activity telemetry (former Phase 2) until the
  host publishes a stable progress event available to RPC-spawned children.
- A target Direct-Path percentage.
- Removing Kernel snapshot/CAS/authority semantics.

## 7. Devil's Advocate Audit

- **Auto-recorded review pass** is the highest-risk item; it must not ship
  without the receipt binding and adversarial review of §3.3. If the binding
  cannot be proven, keep literal-user confirmation and accept the friction.
- **Direct-first routing** must fail closed: ambiguous risk routes to Managed,
  never Direct.
- **UI deletion** before Review uses the standard `Agent` tool would hide the
  reviewer again. R1 is released in `0.16.0`; R3-D1 still waits for R3-B1.
- **Metrics are for observation.** Hitting "80% Direct" by reclassifying risk
  is a failure mode, not a success.
