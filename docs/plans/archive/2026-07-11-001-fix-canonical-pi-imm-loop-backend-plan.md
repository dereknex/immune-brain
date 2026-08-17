---
title: "fix: canonical Pi imm-loop execution backend"
type: fix
status: active
date: 2026-07-11
origin: imm-code-review findings after the prior Pi autorun Plan had already closed
spec: docs/specs/canonical-pi-imm-loop-backend.spec.md
---

# Iteration Plan

## Task

## Output Language

- Spec and Plan prose: English.
- User-facing replies: Chinese per project instructions.
- CLI flags, JSON keys, State Ledger fields, file paths, API names, and canonical workflow terms remain literal.

- Summary: Make the host-callable `imm-loop` CLI use Pi as one observable and internally consistent canonical execution backend.
- Origin: `imm-code-review` found four issues after the previous Plan and review gate were closed: child invocation reused the Bun runtime script, execution failures returned process success, isolated reviewers promised unavailable nested dispatch, and active docs/tests still described conflicting architectures. Runtime correctly rejected reopening these findings as a same-boundary follow-up because no pending review gate remained, so this is a new slice.
- Research: `runner.ts` already separates the shared loop through `LoopDependencies`; production `defaultDependencies` intentionally selects Pi config and `runPiChild`. `child-agent.ts` owns Pi CLI arguments, role tool isolation, output parsing, cancellation, and process-group cleanup. `cli.ts` owns process exit semantics. Existing focused tests cover authority transitions, cancellation, recovery, follow-up, review gates, and package loading. The implementation is already present in the working tree but lacks a valid current execution target and therefore still requires recorded execution evidence and independent QA.
- Decisions: D1 use one canonical Pi backend rather than multiple host adapters; D2 accept explicit `--backend=pi` and reject unsupported values; D3 return nonzero for execution/contract/transition failures and `130` for cancellation; D4 keep canonical reviewer children isolated, read-only, and solo; D5 preserve State Ledger, QA, review-gate, budget, and Compounder handoff behavior; D6 use a new slice because the previous Plan is historically closed.
- Assumptions: Pi and Bun are installed and authenticated in environments that run autorun; hosts without Pi can still use non-loop Immune-Brain workflow commands but cannot run this backend; no persisted-state migration is required.
- Scope Mode: Hold Scope.
- Design baseline: [canonical-pi-imm-loop-backend.spec.md](../specs/canonical-pi-imm-loop-backend.spec.md), especially D1-D4 and invariants in §3.
- Planning quality gate:
  - contract_surface: CLI wrapper, runtime command manifest, Pi child transport, Skill/dist contract, active docs, focused tests
  - compatibility: calls without `--backend` remain Pi-backed; existing budget flags and JSON fields remain stable
  - interruption_recovery: State Ledger remains at the last committed checkpoint; cancellation and failed children cannot fabricate state
  - rollback_path: revert the eleven implementation/doc/test files as one coherent backend-contract change; no state rollback
  - verification_strength: executable unit/contract tests, Plan validation, active-doc stale-term search, and `git diff --check`
  - design_conformance: QA must compare the implementation with Spec D1-D4 and classify any deviation as rework or replan
- Planner research dispatch: solo; this is a bounded one-outcome repair with concrete files and executable verification, so ensemble cost exceeds benefit.

## Devil's Advocate Audit

- **Rollback resilience**: The step changes no persisted schema. If execution fails midway, uncommitted source/docs/tests can be reverted together and State Ledger remains at its last committed checkpoint. The smallest coherent rollback is the canonical backend CLI/child contract plus matching docs/tests.
- **Verification vanity**: Assertions exercise actual Pi invocation selection, unsupported backend parsing, failure exit mapping, unavailable backend behavior, reviewer tool isolation, package loading, transition safety, and complete focused workflow regressions. Text checks supplement but do not replace behavioral tests.
- **Spec dilution detection**: The Plan retains all accepted review findings: observable failures, honest reviewer capability, consistent active docs, and contract-test closure. It explicitly does not broaden into native multi-host runtimes or a generic dispatcher.

## Steps

### Step 1

- Step ID: U1
- Result: The host-callable completion loop uses a truthful Pi execution backend
- Verification type: automated
- Verification: `bun test tests/pi-imm-loop-recovery-package.test.ts tests/pi-imm-loop-step-autorun.test.ts tests/pi-imm-loop-review-follow-up.test.ts tests/imm-follow-up-runtime.test.ts tests/imm-autowork-continuation-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-11-001-fix-canonical-pi-imm-loop-backend-plan.md --json && ! rg -n "Pi extension|coordination-only" README.md docs/user_manual.md plugins/immune-brain/USER_GUIDE.md && git diff --check`
- Agent Hint: imm-executor
- Test scenarios: Pi children invoke `pi` instead of the Bun runtime entry; `--backend=pi` is accepted and unsupported values fail; execution/contract/transition failures return nonzero while cancellation returns 130; failed children do not fabricate State Ledger transitions; reviewer children remain read-only and explicitly solo; active docs describe the canonical backend consistently; existing QA, review, follow-up, recovery, package, and Compounder handoff behavior remains green
- Depends on: none
- Scope: `README.md`, `docs/user_manual.md`, `plugins/immune-brain/USER_GUIDE.md`, `plugins/immune-brain/dist/imm-loop.md`, `plugins/immune-brain/extensions/imm-loop/child-agent.ts`, `plugins/immune-brain/extensions/imm-loop/cli.ts`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/skills/imm-loop/SKILL.md`, `tests/imm-loop-review-orchestration-contract.test.ts`, `tests/pi-imm-loop-recovery-package.test.ts`, `tests/pi-imm-loop-step-autorun.test.ts`
- Discovery cache: `plugins/immune-brain/extensions/imm-loop/child-agent.ts` (Pi transport and role isolation); `plugins/immune-brain/extensions/imm-loop/cli.ts` (backend parsing and exit semantics); `plugins/immune-brain/extensions/imm-loop/runner.ts` (safe-stop reasons and authority transitions); `tests/pi-imm-loop-step-autorun.test.ts` (CLI and transition behavior); `tests/pi-imm-loop-recovery-package.test.ts` (process lifecycle, package, and docs contract)
- Failure behavior: Stop without recording execution evidence if the focused suite fails, Pi invocation cannot be proven, or active docs retain conflicting architecture claims. Route structural changes to backend ownership or State Ledger semantics back to Planner.
- Security considerations: Preserve role tool allowlists and do not broaden reviewer/QA shell or edit permissions.
- Replan condition: If closure requires another execution backend, State Ledger schema changes, nested reviewer dispatch, or altered QA/review authority, stop and return to Planner.

## Notes

- The existing working-tree implementation is candidate execution output, not closure evidence. `imm-work` must activate U1, record the declared verification, and route closure through `imm-qa`.
- No `parallel_probes` are needed; the files form one causal contract surface rather than three independent discovery domains.
