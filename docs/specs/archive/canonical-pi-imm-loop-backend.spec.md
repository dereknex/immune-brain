# Spec: Canonical Pi imm-loop execution backend

**Task ID**: IMM-LOOP-BACKEND-001  
**Owner**: Planner  
**Status**: Proposed  
**Design risk**: High — cross-host CLI contract, child-process lifecycle, reviewer authority boundary, and packaged Skill behavior

## 1. Goal

Make `imm-loop` callable from any shell-capable host while using one explicit, truthful execution backend: Pi. The packaged CLI must expose backend failures to its caller, keep reviewer capabilities consistent with the runtime sandbox, and describe the same architecture across active user and Skill documentation.

## 2. Problem

The portable CLI initially reused the Bun runtime entry as though it were the Pi CLI, causing executor children to exit immediately. After fixing that transport bug, the product surface still had three inconsistencies:

1. Backend, child, transition, and contract failures could return process exit code `0`.
2. The reviewer contract promised nested advisory subagents while isolated reviewer children disabled Skills, extensions, context files, and dispatch tools.
3. Active documentation mixed the removed Pi-extension architecture, coordination-only fallbacks, and the new host-callable canonical-backend architecture.

The prior Pi autorun Plan is historically closed, so these repairs require a new executable slice rather than mutation of old closure history.

## 3. Technical Design

### 3.1 Boundaries

- `plugins/immune-brain/bin/imm-loop` remains the host-callable shell entry.
- `plugins/immune-brain/extensions/imm-loop/cli.ts` owns CLI argument validation, signals, JSON output, and process exit semantics.
- `plugins/immune-brain/extensions/imm-loop/runner.ts` remains the shared completion-loop state machine.
- `plugins/immune-brain/extensions/imm-loop/child-agent.ts` is the Pi execution backend and always launches `pi` for Executor, QA, and reviewer children.
- Canonical reviewer children run a solo broad-baseline review with read-only tools. Nested advisory activation remains available only when a dispatch-capable review host is invoked directly.

### 3.2 Decisions

- **D1 — One backend**: `--backend=pi` is the only accepted backend. Unsupported backend values fail argument validation; the CLI does not probe or emulate other host runtimes.
- **D2 — Observable failure**: `user_cancelled` exits `130`; backend, child, runtime, malformed-output, contract, and transition failures exit nonzero; normal completion and explicit safe workflow stops remain zero.
- **D3 — Honest reviewer capability**: The isolated Pi reviewer does not claim nested subagent activation it cannot perform.
- **D4 — Shared state authority**: `imm-autowork`, State Ledger transitions, QA decisions, review gates, and Compounder handoff semantics remain unchanged.

### 3.3 Invariants

- Executor evidence cannot become a QA decision.
- A failed child cannot mutate workflow state or be reported as successful process completion.
- Reviewer children remain read-only.
- `imm-compounder` remains an explicit handoff and is never invoked automatically.
- Existing Plan and State Ledger formats require no migration.

### 3.4 Failure and interruption behavior

- Missing, unauthenticated, or nonzero Pi backend execution stops the loop with a stable failure reason and nonzero process status.
- Cancellation terminates the process group and returns `130` without fabricating authority output.
- A mid-run interruption leaves State Ledger state at the last committed checkpoint; a later run recomputes from that ledger.

### 3.5 Compatibility and rollback

- Existing calls without `--backend` continue to use Pi for compatibility; documentation uses the explicit flag.
- Existing budget flags and JSON result shape remain unchanged.
- Rollback is the coherent revert of CLI exit mapping, Pi invocation selection, isolated-review wording, and their tests/docs. No persisted-state rollback is required.

## 4. Requirements

### R1. Canonical backend selection

- `imm-loop --backend=pi` must be accepted.
- Any unsupported backend value must return exit code `2` and usage text.
- Pi children must launch through the `pi` executable, not the current Bun host script.

### R2. Failure observability

- Backend, child, runtime, output-contract, checkpoint-contract, and transition failures must return a nonzero process exit.
- `user_cancelled` must return `130`.
- Successful completion, explicit Compounder handoff, and intentional budget stops may return zero while retaining their JSON `stopReason`.

### R3. Reviewer capability honesty

- Isolated reviewer children must remain read-only and solo.
- The Skill contract and active docs must not promise nested subagent activation from that isolated child.
- Direct dispatch-capable invocation of `imm-code-review` or `imm-ui-review` remains outside this backend and may use its existing activation protocol.

### R4. Contract consistency

- `README.md`, `docs/user_manual.md`, `plugins/immune-brain/USER_GUIDE.md`, `plugins/immune-brain/skills/imm-loop/SKILL.md`, and `plugins/immune-brain/dist/imm-loop.md` must describe one architecture: host-callable CLI with Pi as canonical execution backend.
- Active docs must not describe the deleted Pi extension or other hosts as coordination-only.

## 5. Acceptance Criteria

- [ ] Pi child invocation cannot resolve to `immune_brain_runtime.ts --mode json`.
- [ ] Unsupported backends and execution failures return nonzero process status.
- [ ] Cancellation returns `130` and preserves state authority.
- [ ] Isolated reviewer tests prove read-only solo behavior.
- [ ] Active documentation has no stale `Pi extension` or `coordination-only` architecture claims.
- [ ] The complete focused imm-loop regression set passes.
- [ ] Plan validation reports no warnings and `git diff --check` passes.

## 6. Non-goals

- No Codex, Claude Code, Cursor, or OpenCode execution adapter.
- No generic provider registry or backend auto-detection.
- No State Ledger schema change.
- No automatic Compounder invocation.
- No nested reviewer dispatch inside isolated canonical-backend children.
