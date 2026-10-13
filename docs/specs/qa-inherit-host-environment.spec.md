# Deterministic QA inherits the host process environment

**Status**: Candidate; not enrolled.
**Design risk**: Medium — one module (`runtime/assurance`) changes what a QA child process can read. No TaskRecord, authority, descriptor format or persisted state changes, but the isolation boundary of QA moves, so it is not Low.
**Execution posture**: test-first.
**Document language**: English, following the Planner document-language default.
**Source**: Direct Planner entry on 2026-10-12, after the r647 retro (a consumer-repository `pnpm install --frozen-lockfile` prepare that could not finish inside QA). User-owned decisions are `U1`–`U4`; everything else is repository evidence or a delegated technical choice.

## Outcome

A deterministic QA command runs with the environment of the process that hosts the Kernel instead of a rebuilt five-variable one. The user's development environment decides where dependency caches, registries and tool configuration come from; the Kernel stops creating a throwaway home for QA and stops telling the Planner how preparation may obtain dependencies.

QA still runs in the disposable delivery materialization. That is unchanged here.

## User decisions

| ID | Decision | Source |
|---|---|---|
| U1 | The Kernel makes no special requirement on dependency caches; the user's development environment decides. The development environment is user-controlled and already isolated by the worktree. | User messages "考虑不对依赖缓存做特别要求，由用户开发环境自行决定" and "开发环境用户自身控制，大部分已经由worktree做了隔离", 2026-10-12. |
| U2 | Remove the environment override as its own task, separate from and before any change to where QA runs. QA keeps running in the materialized delivery; `environment.prepare` and the 600 s descriptor bound stay as they are. | User accepted the two-step proposal by choosing its order, 2026-10-12. |
| U3 | This task lands before `ceremony-trim-r647` S1. | User answer "排在 S1 之前", 2026-10-12. |
| U4 | The Planner contract stops forbidding a download or credential use during preparation. | Part of the proposal accepted under U2. |

## User scenarios

| ID | Mode | Scenario | Acceptance |
|---|---|---|---|
| SCN-1 | automated | Given a user whose shell sets a package-store location and whose home holds a warm store, when QA runs a `prepare` or check command, then that command sees the same `HOME` and the same variables as the process hosting the Kernel. | AC1 |
| SCN-2 | automated | Given a Kernel process that carries a Git repository-binding variable such as `GIT_DIR`, when QA runs a command that calls Git inside the materialized delivery, then the command does not see that variable. | AC1 |

Both scenarios were raised in the 2026-10-12 conversation: SCN-1 is the r647 failure, SCN-2 is the condition the user accepted with the feasibility analysis.

## Decision trace

| ID | Decision | Source |
|---|---|---|
| D1 | The child environment is the hosting process's environment, with `PATH` still replaced by the absolute-entry `PATH` QA already resolves commands against, and `IMM_VERIFICATION_PROCESS_TOKEN` added. `HOME`, `TMPDIR` and `XDG_CACHE_HOME` are no longer set by the Kernel. | U1. Repository evidence: `plugins/immune-brain/runtime/assurance/verification.ts:136` (current five-variable environment), `:53` (`verificationPath`). |
| D2 | A fixed list of eight Git repository-binding variables is removed from the child environment: `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_NAMESPACE` and `GIT_PREFIX`. The list is a constant in the runtime; Git is not asked for it at run time. Every other `GIT_*` variable (identity, SSH command, injected configuration) passes through as user environment. | Delegated technical choice. Repository evidence: `plugins/immune-brain/runtime/assurance/delivery_workspace.ts:43-45` already deletes the first three for the Kernel's own Git calls; a QA command runs in a materialization that is not the user's repository, so an inherited binding would point its Git calls at the real one. |
| D3 | `runFixedVerification` loses its `home` option, and `runDeterministicQa` no longer creates or removes an `imm-qa-home-*` directory. Temporary files a command writes go to the user's `TMPDIR` and are not cleaned by the Kernel. | Follows from D1. Repository evidence: `plugins/immune-brain/runtime/assurance/qa.ts:76-83`, `:103`, `:155`. |
| D4 | The process-token cleanup is unchanged. It reads the token from the child's environment and does not depend on the other variables. | Repository evidence: `verification.ts:131-137`, `:186-207`. |
| D5 | In `dist/imm-planner.md`, the sentence "Preparation must not hide a download, credential use, production write, or system change" becomes a rule about production writes and system changes only, preceded by one sentence stating that QA commands run with the host process environment and that the Kernel does not judge how dependencies are obtained. The acceptance-command rules ("Never hide package installation inside an acceptance command", no network access as acceptance) stay. | U4. Repository evidence: `plugins/immune-brain/dist/imm-planner.md:414-418`, `:383-391`; asserted by `tests/workflow-verification-invariants.test.ts:159`. |
| D6 | No ADR. No existing ADR records the environment override; this Spec is the decision record. | Repository evidence: `docs/adr/` has no match for the override; it arrived with commit `ea5c6b6` without a stated reason. |
| D7 | The changeset is `minor`. | Delegated technical choice: no stored record, descriptor or Tool schema changes, and a descriptor that passed before still passes. |

## Out of scope

- Running QA inside the worktree, removing the materialization, `environment.prepare`, or the literal-argv command form.
- The 600 s descriptor bound and the identical-failure counter.
- The diagnostics text of `ceremony-trim-r647` S1. That Spec is owned by another session; it must drop "fresh home" from its execution conditions and depend on this task, because both edit `qa.ts` and `verification.ts`.
- `tests/fixtures/workflow-decision-closure-sources/imm-planner.md`, a frozen historical copy of the contract.

## Discovery evidence and reference closure

- Producer: `plugins/immune-brain/runtime/assurance/verification.ts:111-140` (`runFixedVerification`, the `spawn` environment).
- Only runtime caller: `plugins/immune-brain/runtime/assurance/qa.ts:103`; home lifecycle at `:76-83` and `:155`. `plugins/immune-brain/.pi-extension/pi-canary-verification.ts:12` re-exports the function and passes nothing.
- Tests that pass `home`: `tests/pi-canary-verification-descriptor.test.ts` (ten call sites, helper at `:23`). `tests/pi-canary-assurance-authority.test.ts:327` and `tests/shared-deterministic-qa.test.ts` go through `runDeterministicQa` and name no `home`; they need no edit.
- Test comments that describe the override: `tests/dual-host-assurance-conformance.test.ts:345-346`, `tests/unattended-contracts.test.ts:324-327`. The stub the second comment justifies stays valid, because the materialization still has no `node_modules`.
- Contract: `plugins/immune-brain/dist/imm-planner.md:414-418`, its own authoring source; the fragment is asserted at `tests/workflow-verification-invariants.test.ts:159`.
- Generated mirror: `plugins/immune-brain/dist/claude/mcp-server.mjs` inlines the runtime (one `XDG_CACHE_HOME` occurrence today); rebuilt with `bun scripts/build-claude-plugin.ts`, drift checked by `tests/claude-host-package.test.ts`.
- Release: one file under `.changeset/`.

## Technical Design

**Design views**: service/component interfaces (the `runFixedVerification` options and the child-process environment it produces) and data flow (which host variables reach a QA command). State transitions and temporal sequence are untouched: no outcome, stage or cleanup step is added or reordered.
**Diagram decision**: not_required
**Diagram reason**: the change is one mapping from the host environment to the child environment; a table states it completely.

| Variable | Before | After |
|---|---|---|
| `PATH` | absolute entries of the host `PATH` | unchanged |
| `HOME`, `TMPDIR`, `XDG_CACHE_HOME` | a fresh `imm-qa-home-*` directory | host value, or absent when the host has none |
| Git repository-binding variables (D2) | absent | absent |
| every other host variable | absent | host value |
| `IMM_VERIFICATION_PROCESS_TOKEN` | per-run token | unchanged |

### Invariants

- I1: a QA command never sees a Git repository-binding variable of the hosting process (D2).
- I2: every QA command carries the per-run process token, and timeout or abort cleanup still finds its processes (D4).
- I3: a QA command resolves executables only through the absolute-entry `PATH` (D1).
- I4: the Kernel creates no directory outside the delivery materialization for a QA run (D3).

### Interface

`runFixedVerification(cwd, command, frozen, options)`: `options` becomes `{ signal?, path, _processScanner?, _procRoot? }`. Callers that still pass `home` fail type checking; there is one runtime caller. Inputs, result shape and error classes are unchanged.

### Failure behavior

Unchanged outcomes. A missing host `HOME` is passed through as missing; the Kernel does not substitute one. The materialization failure path keeps `delivery_unavailable` and `delivery_cleanup_failed` for the delivery itself.

### Alternatives rejected

- Inheriting only `XDG_CACHE_HOME` and `XDG_DATA_HOME`: tools that derive their cache from `HOME` or their own variables stay cold, and the Kernel keeps a list of variable names.
- A user-set allowlist of variable names: contradicts `plugins/immune-brain/dist/docs/reference/immune-brain-config.md:3`, which rules out Immune-Brain-specific environment overrides.
- A Kernel-owned persistent cache directory: the Kernel would own tool state the user already manages (U1).
- Removing every `GIT_*` variable: it also drops user identity and transport settings that have nothing to do with which repository a command acts on (D2).

### Compatibility, interruption, rollback

- Compatibility: enrolled tasks and stored records are unaffected; descriptors need no revision. A check that passed only because the home was empty would now see the user's home.
- Interruption: no new state. A run interrupted mid-command is cleaned up by the unchanged token path.
- Rollback: one commit. Reverting restores the five-variable environment; nothing persisted refers to either form.

## Verification and acceptance mapping

| Acceptance | Agreed seam | Controls |
|---|---|---|
| AC1 the child environment is the host's, minus Git bindings, plus the token | `tests/pi-canary-verification-descriptor.test.ts` through `runFixedVerification`, with a real child that reports what it sees | positive: a variable set on the test process and the test process's `HOME` reach the child, the token is present; negative: each D2 variable set on the test process is absent in the child, while a non-binding `GIT_*` variable still arrives; bound: `PATH` in the child equals the `path` option, not the host `PATH`, and a host with `HOME` unset yields a child with `HOME` unset |
| AC2 a QA run creates no throwaway home | `tests/pi-canary-assurance-authority.test.ts` through `runDeterministicQa` with the real `runFixedVerification` (prior art at `:316-331`) | positive: a check that exits zero only when its `HOME` equals the test process's `HOME` passes; negative: the same check fails when the expected value is a different path; bound: the existing token-cleanup tests in `tests/pi-canary-verification-descriptor.test.ts` keep passing without the `home` option |
| AC3 the contract and the bundle say the same thing | `tests/workflow-verification-invariants.test.ts`, `tests/claude-host-package.test.ts` | positive: the new environment sentence and the narrowed preparation rule are present; negative: "hide a download" is absent from `dist/imm-planner.md`; bound: the Claude bundle matches the runtime source |

AC1 catches the regression this task exists for (a rebuilt environment hides the user's home) and the one it could introduce (a leaked `GIT_DIR`). AC2 proves the QA entry point, not only the function under it, stopped supplying a home.

## Devil's Advocate Audit

- **Rollback resilience**: the change is one runtime mapping, one option removed, one contract sentence, one regenerated bundle. A half-applied state (runtime changed, bundle not rebuilt) fails `tests/claude-host-package.test.ts`; a half-applied option removal fails type checking at the single caller.
- **Verification vanity**: asserting that `spawn` receives `process.env` would mirror the implementation, so AC1 runs a real child and reads what it reports. The negative control names every D2 variable, because a filter that drops only `GIT_DIR` would pass a single-variable test and still let `GIT_INDEX_FILE` redirect a command's index. The contract acceptance proves wording only; AC1 and AC2 carry the behavior.
- **Spec dilution**: the user asked for the Kernel to stop making requirements on dependency caches. This delivers that for the environment and the Planner rule. It does not make a cold materialization fast for tools whose state is bound to the worktree path, and it does not touch the 600 s bound; both are stated in Out of scope rather than implied as solved. The earlier chat wording "filter `GIT_*`" is narrowed to the repository-binding set in D2, with the reason given there.
