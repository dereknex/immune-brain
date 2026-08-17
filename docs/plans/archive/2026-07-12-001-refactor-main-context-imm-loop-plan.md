---
title: "refactor: run imm-loop in the main conversation"
type: refactor
status: active
date: 2026-07-12
origin: user-confirmed imm-brainstorm framing that rejects the Pi child backend
spec: docs/specs/2026-07-12-main-context-imm-loop.spec.md
---

# Iteration Plan

## Task

- Summary: Replace the external Pi-backed `imm-loop` process runner with a visible checkpoint loop in the current host conversation, using host `Agent` subagents only for independent QA and required review gates.

## Output Language

- Spec and Plan prose: English.
- User-facing replies: Chinese per project instructions.
- CLI flags, JSON keys, State Ledger fields, file paths, API names, Skill names, and canonical workflow terms remain literal.

- Origin: The user reported that the completed `imm-loop` produced no useful conversational output or observation, rejected the Pi child design, and confirmed that implementation should remain in the current conversation while isolated authorities use host subagents. This intentionally supersedes the active architecture established by the historically closed `2026-07-10` and `2026-07-11` Pi autorun Plans; their records remain unchanged.
- Research: Pi's extension and SDK documentation confirms that the current conversation already provides the tool loop and visible tool execution, while the host `Agent` primitive provides isolated subagents. The current external implementation adds `bin/imm-loop`, a 523-line runner, a Pi child backend, process locking, CLI argument and exit contracts, and dedicated tests. Existing `imm-autowork`, `imm-work`, `imm-review`, review-gate, and follow-up runtime commands already provide the durable checkpoint and transition surface needed by a Skill-driven loop. `docs/solutions/rejected-autowork-driver-default-pass.md` rejects both another runtime driver and converting Executor verification into QA pass.
- Decisions: D1 keep `imm-loop` as an installable Skill and remove its shell/runtime execution surface; D2 let the current conversation perform active Step implementation under Executor boundaries; D3 require host `Agent` isolation for QA and pending review gates; D4 fail closed when required subagent authority is unavailable or malformed; D5 keep State Ledger snapshots and existing runtime commands authoritative; D6 make ordinary conversation progress and a mandatory terminal summary the correctness-level observability contract; D7 do not add an extension, UI widget, generic dispatcher, backend registry, or replacement runner.
- Assumptions: The host exposes its documented subagent primitive when independent QA or review is required; host-specific primitive names may differ but the child authority contract is shared; existing State Ledger write safety is sufficient without a separate run lock; historical docs under `docs/plans/`, `docs/specs/`, and `docs/solutions/` remain immutable evidence.
- Scope Mode: New executable slice; the previous Pi backend Plan is closed and this change reverses its architecture rather than appending to its closure facts.
- Design baseline: [2026-07-12-main-context-imm-loop.spec.md](../specs/2026-07-12-main-context-imm-loop.spec.md), especially R1-R5 and authority invariants in §3.2.
- Planning quality gate:
  - contract_surface: `imm-loop` Skill/dist contracts, CLI command manifest, runtime bridge, package command tests, active README/user guides, reviewer orchestration contract, and removed Pi runner files/tests
  - compatibility: `imm-loop` shell compatibility is intentionally removed; the Skill and existing `imm-autowork`/`imm-work`/`imm-review` commands remain; State Ledger and Plan schemas do not change
  - interruption_recovery: every continuation starts from a fresh checkpoint; committed evidence and decisions survive conversation interruption; unavailable child authority stops fail-closed
  - rollback_path: restore the removed CLI/runner/backend files and matching manifest/docs/tests as one coherent revert; no State Ledger rollback
  - verification_strength: behavioral runtime regressions plus contract assertions that reject obsolete `backend=pi`, `runPiChild`, `runImmLoop`, and `bin/imm-loop` references while allowing generic Pi `Agent` subagent protocol language; positive assertions require main-context execution, Agent isolation, fail-closed behavior, and terminal-output language
  - design_conformance: QA compares implementation with Spec R1-R5; local wording or test omissions route to rework, while any replacement runner, schema change, or weakened authority boundary routes to replan
- Planner research dispatch: solo. Prior brainstorm used three advisory children for minimality, authority/recovery, and observability; all supported the main-context Skill loop with State Ledger and isolated QA/Review. Repository evidence is sufficient for one executable outcome, so another planner ensemble would add cost without changing decomposition.

## Devil's Advocate Audit

- **Rollback resilience**: This removes a public CLI surface and many dedicated files, so partial implementation may temporarily leave stale imports, manifest entries, or docs. The Step verifies package loading and a repo-wide active-surface stale-reference search before closure. The previous runner can be restored as one coherent source/docs/tests revert; persisted State Ledger data requires no rollback.
- **Verification vanity**: Contract checks alone could prove words while leaving broken transitions. Verification therefore retains executable `imm-autowork`, follow-up, review lifecycle, State Ledger, package, and skill-registry regressions. Negative assertions target only obsolete backend identifiers instead of generic `Pi child` prose, while positive assertions lock observable main-context behavior and fail-closed subagent boundaries.
- **Spec dilution detection**: The Plan retains all confirmed goals: current-conversation implementation, independent QA/Review, State Ledger recovery, same-boundary follow-up, visible progress, mandatory final output, and maximal deletion of Pi child machinery. It does not silently preserve the old CLI for compatibility, add a new extension, or let the parent self-approve when subagents are unavailable.

## Steps

### Step 1

- Step ID: U1
- Result: `imm-loop` completes validated Plans through an observable main-context protocol
- Verification type: automated
- Verification: `bun test tests/imm-autowork-continuation-runtime.test.ts tests/imm-follow-up-runtime.test.ts tests/imm-loop-completion-gate.test.ts tests/imm-loop-review-lifecycle-state.test.ts tests/imm-loop-review-orchestration-contract.test.ts tests/plugin-package-runtime.test.ts plugins/immune-brain/tests/skill-registry-consistency.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-12-001-refactor-main-context-imm-loop-plan.md --json && test ! -e plugins/immune-brain/bin/imm-loop && test ! -e plugins/immune-brain/extensions/imm-loop && ! rg -n --glob '!docs/plans/**' --glob '!docs/specs/**' --glob '!docs/solutions/**' --glob '!upstreams/**' --glob '!node_modules/**' 'backend=pi|Pi canonical execution backend|runPiChild|runImmLoop|bin/imm-loop' README.md IMMUNE.md docs plugins/immune-brain tests && git diff --check`
- Agent Hint: imm-executor
- Test scenarios: The Skill starts from `imm-autowork` in the current conversation; active Step implementation defaults to the parent context; QA and `pending_review_gate` use host `Agent` subagents; unavailable, failed, or malformed child judgment stops without pass state; every checkpoint action has a compact progress contract; every exit has Plan, completed Steps, QA, Review, stop reason, and next action; same-boundary follow-up repeats execution, QA, and review; `replan_needed` and Compounder handoff remain explicit stops; CLI manifest and package tests no longer expose `imm-loop` as a command; State Ledger, review-gate, and follow-up regressions remain green
- Depends on: none
- Scope: `README.md`, `IMMUNE.md`, `docs/user_manual.md`, `docs/patterns/l2s-workflow.md`, `plugins/immune-brain/USER_GUIDE.md`, `plugins/immune-brain/bin/imm-loop`, `plugins/immune-brain/dist/imm-loop.md`, `plugins/immune-brain/extensions/imm-loop/`, `plugins/immune-brain/runtime/immune_brain_runtime.ts`, `plugins/immune-brain/skills/imm-loop/SKILL.md`, `tests/imm-loop-review-orchestration-contract.test.ts`, `tests/pi-imm-loop-recovery-package.test.ts`, `tests/pi-imm-loop-review-follow-up.test.ts`, `tests/pi-imm-loop-step-autorun.test.ts`, `tests/plugin-package-runtime.test.ts`
- Discovery cache: `plugins/immune-brain/dist/imm-loop.md` (main-context loop and observable output contract); `plugins/immune-brain/skills/imm-loop/SKILL.md` (installable entry); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (command manifest and obsolete bridge); `tests/imm-loop-review-orchestration-contract.test.ts` (Skill/runtime authority contract); `tests/plugin-package-runtime.test.ts` (packaged command and Skill exposure); `tests/imm-autowork-continuation-runtime.test.ts` (checkpoint transitions); `tests/imm-follow-up-runtime.test.ts` (durable same-boundary follow-up)
- Failure behavior: Stop without recording execution evidence if remaining active references require the removed CLI, runtime regressions fail, or the main-context contract cannot enforce independent QA/review fail-closed behavior. Restore deleted files only as a coherent rollback, not as a second supported path.
- Security considerations: QA and reviewer Agent prompts must explicitly prohibit edits and workflow-state mutation; child outputs are untrusted until structurally validated; the parent must never synthesize a pass when required isolation is unavailable.
- Replan condition: If implementation requires a new extension/SDK loop, State Ledger schema changes, retained Pi child execution, another public runner, or relaxed QA/reviewer authority, stop and return to Planner.

## Notes

- This is one outcome Step rather than separate delete/docs/test Steps because all surfaces describe one user-visible completion protocol and cannot close independently without temporary contract drift.
- No `parallel_probes` are needed. The deletion and replacement surfaces are causally coupled, and the discovery cache already identifies the relevant files.
- Replan correction: QA found the original `Pi child` stale-reference pattern structurally over-broad because it matched legitimate generic Pi subagent lifecycle documentation. The revised Verification targets only identifiers unique to the retired `imm-loop` backend; Spec scope and Step Result are unchanged.
