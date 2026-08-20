# Spec: Subagent Evolution - Durable Evidence & Specialized Execution

## Context
The subagent architecture has stabilized around a host-driven dispatch protocol with deterministic activation (`activation_plan.py`) and conditional risk routing (`imm-advisory-reviewer`). Currently, all subagents operate strictly in `advisory` mode (read-only), and their findings are merged by the host but not persisted as first-class evidence in the step lifecycle.

## Goals
1. **Durable Evidence**: Extend the `current_iteration.json` (v2 schema) so `imm-qa` can directly verify `child_evidence` produced by subagents, reducing the reliance on host synthesis for closure.
2. **Specialized Execution**: Break the read-only barrier by introducing an `active-step-bounded-executor` subagent role.
3. **Context Optimization**: Implement Context Sharding in delegation packets to reduce token overhead.

## Non-Goals
- Global Subagent Registry or independent scheduling platform.
- Agent-to-Agent direct communication.
- Cross-session persistent memory for individual subagents.

## Core Requirements

### 1. State Ledger Extension
- **Schema Update**: Update the step schema in `.imm/memory/current_iteration.json` to support a `child_evidence` list.
- **API Update**: Update `imm_core.current_iteration_state` (LedgerManager) and `imm_core.state_machine` to accept and serialize `child_evidence` alongside `execution_evidence`.

### 2. First Bounded Executor Subagent
- **Skill Creation**: Introduce `test-fixer` (or similar bounded executor) under `skills/`.
- **Authority**: Define its authority class as `active-step-bounded-executor`.
- **Constraint**: It must only modify files explicitly passed in its `focus_delta` (e.g., test files) and must not mutate the plan or ledger directly.

### 3. Context Sharding in Delegation Packets
- **Packet Structure**: Refine the `focus_delta` layer in the `docs/reference/subagent-dispatch-protocol.md` to mandate strict file-level sharding (passing only related diffs/files to specific subagents).
- **Host Update**: Update `imm-code-review` and `imm-work` to dynamically shard the context when constructing the delegation packet.

## Validation Strategy
- `tests.test_current_iteration_state`: Add tests for `child_evidence` persistence.
- `tests.test_skill_contracts`: Add tests to verify the `active-step-bounded-executor` constraint logic for the new skill.
- End-to-end trace: Verify that a host can dispatch the bounded executor, collect its `child_evidence`, and that `imm-qa` can read it from the ledger.
