# Iteration Plan

## Task
- Summary: Wire deferred subagents into the catalog and harden dispatch protocol observability.
- Origin: Brainstorm gap analysis of current skills and subagents implementation.
- Research: `imm-party` and `imm-ui-review` currently lack entries in `docs/reference/subagent-trigger-catalog.yaml`. Codex platform limits are known but should be explicitly documented in the protocol.
- Decisions: Update `subagent-trigger-catalog.yaml` to include the missing subagents. Update `subagent-dispatch-protocol.md` to harden fallback visibility and document Codex limits.
- Assumptions: The host skills can parse the new catalog entries without code changes to their core parsing logic.

## Steps

### Step 1
- Step ID: U1
- Result: `docs/reference/subagent-trigger-catalog.yaml` contains configuration blocks for `imm-party` and `imm-ui-review` matching the existing schema.
- Verification: `python3 .imm/activation_plan.py --help` runs without YAML parsing errors.
- Depends on: none

### Step 2
- Step ID: U2
- Result: `docs/reference/subagent-dispatch-protocol.md` explicitly mentions Codex `spawn_agent` soft constraints and requires explicit warnings on solo fallback.
- Verification: The `subagent-dispatch-protocol.md` document contains the specified updates.
- Depends on: 1