---
title: "fix: subagent activation install runtime"
type: fix
status: active
date: 2026-05-12
origin: imm-brainstorm diagnosis — installed subagent activation lacks reference artifacts and Codex dispatch docs mismatch current spawn_agent schema
---

# Iteration Plan

## Task
- Summary: Fix managed install gaps that prevent subagent activation from running outside the source checkout
- Origin: `imm-brainstorm` analysis found source-tree activation tests pass, but installed runtime lacks `docs/reference` artifacts and Codex dispatch guidance names unavailable `spawn_agent` parameters
- Research: Source `.imm/activation_plan.py` builds candidates correctly against repo-local `docs/reference/subagent-trigger-catalog.yaml`; installed `/Users/derek/.immune-brain/runtime/agent-skills/.imm/activation_plan.py` raises `FileNotFoundError` for runtime `docs/reference/subagent-trigger-catalog.yaml`; installed skills under `/Users/derek/agent-plugin-skills` match source SKILL.md files but `/Users/derek/.agents/docs/reference` is absent; `scripts/legacy-installer.sh` copies skill directories, `BASELINE.md`, `.imm/*.py`, and templates only; `legacy-installer --check` passes despite missing reference artifacts; dispatch protocol Codex sample still uses abstract `role` / `prompt` / `read_only` fields instead of the available `agent_type` / `message` shape
- Decisions: D1 keep the fix host-bound and deterministic; D2 install only the subagent reference artifacts needed by existing SKILL.md links and activation planning; D3 add a managed activation CLI entry rather than asking hosts to import Python with ad hoc one-liners; D4 treat Codex readonly as delegation-packet policy because current `spawn_agent` has no `read_only` parameter; D5 do not alter `imm-work` or introduce shared registry behavior
- Assumptions: `~/.agents/docs/reference` is safe for this installer to own because `plugin skill registry` is already the managed skill root; adding one narrow CLI wrapper does not change workflow authority because it only prints an `Activation Plan`
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `scripts/legacy-installer.sh`, `.imm/activation_plan.py`, `tests/test_install_local.py`, `tests/test_activation_plan.py`, `docs/reference/subagent-dispatch-protocol.md`, `tests/test_skill_contracts.py`
  - dependencies_known: true
  - verification_path:
      - target: temporary managed install exposes reference artifacts and can produce a deterministic activation plan from installed runtime
      - method: `python3 -m unittest tests.test_install_local tests.test_activation_plan tests.test_skill_contracts`
  - blockers: none
  - replan_condition: if the Codex runtime later exposes a first-class read-only spawn flag or if `~/.agents/docs/reference` conflicts with another managed installer

## Steps

### Step 1
- Step ID: U1
- Result: Managed installs expose runnable subagent activation planning
- Verification type: automated
- Verification: `python3 -m unittest tests.test_install_local tests.test_activation_plan` exits zero and includes a temporary HOME assertion that installed activation planning returns `security-reviewer` for `app/auth/session.py`
- Agent Hint: imm-executor
- Test scenarios: install copies subagent reference artifacts under the skill root; install copies trigger catalog under the CLI runtime root; check fails when a required reference artifact is missing; managed activation entrypoint returns a deterministic security reviewer candidate
- Depends on: none
- Scope: `scripts/legacy-installer.sh`, `.imm/activation_plan.py`, `tests/test_install_local.py`, `tests/test_activation_plan.py`
- Replan condition: If adding an activation CLI wrapper requires broader command-discovery changes beyond `legacy-installer.sh`, stop and re-scope the entrypoint design.

### Step 2
- Step ID: U2
- Result: Codex dispatch protocol matches current spawn_agent schema
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero with assertions that Codex dispatch guidance uses `agent_type` and `message` while avoiding `read_only` as a tool parameter
- Agent Hint: imm-executor
- Test scenarios: protocol Codex sample uses current spawn_agent field names; readonly is expressed through tool_policy in the Delegation Packet; host wording avoids nonexistent Codex spawn parameters; contract tests preserve the provider-agnostic dispatch lifecycle
- Depends on: 1
- Scope: `docs/reference/subagent-dispatch-protocol.md`, `skills/imm-code-review/SKILL.md`, `tests/test_skill_contracts.py`
- Replan condition: If tool discovery exposes a different canonical Codex spawn contract before execution, update the protocol target schema first.

## Notes
- This plan intentionally does not implement a shared subagent registry, a background dispatcher, or automatic fan-out from `imm-work`.
- `Activation Plan` remains deterministic selection evidence for a host skill; real subagent spawning still follows the user-visible delegation rules of the active runtime.
