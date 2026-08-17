# Spec: Subagent Remaining Wiring and Hardening

**Task ID**: IMM-SUB-WIRING-001
**Owner**: Planner
**Status**: Draft

## 1. Goal

Address the remaining gaps identified in the subagent orchestration system:
1. Wire `imm-party` and `imm-ui-review` into the subagent trigger catalog.
2. Harden the `solo_fallback` observability to prevent silent degradation.
3. Document Codex platform limitations regarding soft constraints for `readonly` execution.

## 2. Rationale

The brainstorm phase identified that while the subagent dispatch protocol is robust, the deferred catalog wiring for `imm-party` and `imm-ui-review` prevents them from participating in automated workflows. Additionally, silent fallbacks when subagents fail can lead to unobserved drops in review quality.

## 3. Requirements

### R1. Catalog Wiring
- Extend `docs/reference/subagent-trigger-catalog.yaml` to include `imm-party` and `imm-ui-review`.
- Maintain host-bound, trigger-based, advisory-only boundaries.

### R2. Fallback Observability
- Update `docs/reference/subagent-dispatch-protocol.md` Phase 6 to require explicit standard error logging or warnings in the host artifact when a solo fallback occurs.

### R3. Platform Constraint Documentation
- Document in `docs/reference/subagent-dispatch-protocol.md` that Codex `spawn_agent` relies on prompt-based soft constraints for `readonly` and cannot enforce it via the tool schema.
