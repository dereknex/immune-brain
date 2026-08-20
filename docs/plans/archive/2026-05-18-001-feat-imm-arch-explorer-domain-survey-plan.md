---
title: "feat: add domain survey dispatch to imm-arch-explorer"
type: feat
status: planned
date: 2026-05-18
origin: user request under imm-planner
---

# Iteration Plan

## Task
- Summary: Add Parallel Domain Survey capability to imm-arch-explorer via subagent dispatch protocol.
- Origin: User requested extending subagents capability for imm-arch-explorer.
- Spec: docs/specs/archive/imm-arch-explorer-domain-survey.spec.md
- Research: Checked `imm-arch-explorer` skill and discovered no python runtime components. Dispatch can be added purely at the prompt contract level, similar to `imm-brainstorm` and `imm-planner`.
- Decisions: Use `generalPurpose` subagents with `readonly: true`. No new python shims. Add contract coverage to ensure the policy remains stable.
- Assumptions: The runtime LLM orchestrator (Cursor/Codex) supports subagent dispatch natively.

## Steps

### Step 1
- Step ID: U1
- Result: imm-arch-explorer contract includes Dispatch Protocol for Parallel Domain Survey
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: test_arch_explorer_has_dispatch_protocol passes, checking for 'Dispatch Protocol', 'readonly: true', and 'generalPurpose'
- Discovery cache: skills/imm-arch-explorer/SKILL.md (add dispatch rules); tests/test_skill_contracts.py (add contract assertion)
- Execution note: test-first
- failure_behavior: If dispatch test fails, review protocol wording to ensure it matches the `docs/reference/subagent-dispatch-protocol.md` reference.
- security_considerations: Dispatched survey subagents must be strongly constrained with `readonly: true` and `tool_policy: no tools` to prevent unauthorized codebase mutations during exploration.
- Depends on: None
