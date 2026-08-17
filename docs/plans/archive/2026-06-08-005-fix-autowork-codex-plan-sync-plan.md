---
title: "fix(autowork): return Codex plan snapshot"
type: fix
status: proposed
date: 2026-06-08
origin: imm-brainstorm framing - autowork completion can leave Codex task display stale
---

# Iteration Plan

## Task

- Summary: Make `imm-autowork` return the latest display-ready `codex_plan.tasks` so Codex can refresh task status after an autowork run changes workflow state.
- Spec: docs/specs/autowork-codex-plan-sync.spec.md
- Origin: User requested planner follow-up after brainstorm analysis found two distinct states: `.imm` State Ledger closure is controlled by `imm-review pass`, while the user-visible Codex task panel can remain stale when the autowork host does not refresh `codex_plan.tasks`.
- Research: `CONTEXT.md` defines the State Ledger as the authority for Step lifecycle and identifies `.imm/imm-autowork.py`, `.imm/imm-work.py`, plugin-local runtime, and MCP surfaces as workflow runtime. `docs/solutions/codex-plan-task-snapshot.md` says Codex task display must be a read-only snapshot derived from the V2 ledger. `docs/solutions/rejected-autowork-driver-default-pass.md` rejects runtime default QA pass and a second autowork driver surface. Current `.imm/imm-autowork.py` returns only a standardized run snapshot; `.imm/imm-work.py` already builds `codex_plan.tasks` from ledger states; `plugins/immune-brain/dist/immune_brain_runtime.py` maps the `imm_autowork` MCP tool directly to `imm-autowork --json`.
- Decisions: D1 add `codex_plan` to the existing autowork run snapshot instead of adding a new tool or driver. D2 keep `codex_plan.tasks` read-only and derived from `imm-work status`. D3 preserve QA authority: execution evidence may show `in_review`, but only `imm-review pass` may produce `completed`. D4 update source and packaged runtime surfaces together. D5 update skill contract wording so Codex syncs from `run_snapshot.codex_plan.tasks` when present, with `imm-work status` as fallback.
- Assumptions: A final display refresh after each autowork invocation is sufficient for the current symptom; streaming task updates during a single tool call are out of scope. The host can consume an additive `codex_plan` field without breaking existing callers.
- Scope Mode: New narrow one-step runtime/display sync slice.
- Planner research dispatch: solo; this is a small single-domain workflow runtime slice and local evidence is sufficient.

## Devil's Advocate Audit

1. **Rollback Resilience**: This slice should touch only autowork snapshot construction, packaged copies, host-facing skill contract text, focused tests, this Spec, and this Plan. Reverting those together restores the previous snapshot shape without State Ledger migration.
2. **Verification Vanity**: String checks for `codex_plan` would be weak. Verification must exercise real autowork transitions: execution evidence without QA returns `in_review`, QA `pass` returns `completed`, and completed handoff still remains handoff-only.
3. **Spec Dilution Detection**: The accepted requirement is task status refresh, not looser workflow closure. The plan explicitly excludes default QA pass, reverse Codex sync, new MCP tools, and background update protocols.

## Planning Quality Gate

- contract surface: `.imm/imm-autowork.py`, `plugins/immune-brain/dist/.imm/imm-autowork.py`, `.imm/imm-work.py`, `plugins/immune-brain/dist/immune_brain_runtime.py`, `plugins/immune-brain/skills/imm-autowork/SKILL.md`, `plugins/immune-brain/dist/imm-autowork.md`, `tests/test_imm_autowork.py`, `tests/test_immune_brain_mcp_runtime.py`, `tests/test_immune_brain_plugin_package.py`, `tests/test_skill_contracts.py`, and this Spec.
- compatibility: `run_snapshot` fields remain additive; State Ledger schema and existing plans do not need migration.
- interruption recovery: If execution stops after source runtime changes but before packaged copy or skill contract updates, focused tests should reveal source/dist drift. Existing State Ledger reads remain valid because the change is display-only.
- rollback path: Revert runtime snapshot, packaged copy, skill contract, focused tests, Spec, and Plan as one coherent slice. No `.imm/memory/current_iteration.json` surgery is required beyond normal plan sync.
- verification strength: Use unit tests that drive autowork state transitions and inspect returned task statuses, plus MCP/package/contract regressions.
- Brainstorm traceability: No formal `BR-*` manifest was supplied in the brainstorm output; the Origin and Decisions above preserve the confirmed findings and non-goals.

## Steps

### Step 1

- Step ID: U1
- Result: Autowork returns display-ready Codex task status
- Verification: `python3 -m unittest tests.test_imm_autowork tests.test_immune_brain_mcp_runtime tests.test_immune_brain_plugin_package tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-06-08-005-fix-autowork-codex-plan-sync-plan.md --json`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Missing QA packet after execution evidence returns a snapshot whose `codex_plan.tasks` marks the active Step `in_review`; QA pass returns a snapshot whose closed Step is `completed`; budget stop after pass preserves completed prior Step and pending next Step in `codex_plan.tasks`; completed Plan handoff includes task statuses and remains `handoff_only`; source and packaged autowork runtimes expose the same additive snapshot shape; skill contract keeps sync read-only and continues rejecting runtime default-pass behavior.
- Discovery cache: .imm/imm-autowork.py (run snapshot construction); plugins/immune-brain/dist/.imm/imm-autowork.py (packaged run snapshot construction); .imm/imm-work.py (`codex_plan.tasks` builder and ledger status mapping); plugins/immune-brain/dist/immune_brain_runtime.py (MCP autowork adapter); plugins/immune-brain/skills/imm-autowork/SKILL.md (source host loop contract); plugins/immune-brain/dist/imm-autowork.md (packaged host loop contract); tests/test_imm_autowork.py (autowork transition regressions); tests/test_immune_brain_mcp_runtime.py (MCP runtime surface); tests/test_immune_brain_plugin_package.py (packaged plugin regression); tests/test_skill_contracts.py (skill contract assertions); docs/solutions/codex-plan-task-snapshot.md (read-only task snapshot pattern); docs/solutions/rejected-autowork-driver-default-pass.md (rejected default pass and driver expansion); docs/specs/autowork-codex-plan-sync.spec.md (accepted behavior)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If the host cannot consume an additive `codex_plan` field reliably, stop and replan a host contract-only fallback that requires an explicit post-autowork `imm-work status` call.
- security_considerations: The snapshot must contain display status only and must not expose extra State Ledger history, secrets, or new write channels.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-08-005-fix-autowork-codex-plan-sync-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-08-005-fix-autowork-codex-plan-sync-plan.md --sync`

## Notes

- This Plan intentionally preserves the rejected decision against runtime default QA pass.
- After validation and runtime sync, continue through `imm-work` for Step 1.
