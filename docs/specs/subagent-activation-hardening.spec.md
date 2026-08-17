# Spec: Subagent Activation Hardening

## Summary

The current Skill and subagent implementation has a solid host-bound shape:
`imm-code-review` builds an Activation Plan from
`docs/reference/subagent-trigger-catalog.yaml`, then uses a Delegation Packet to
optionally dispatch bounded reviewer Skills. The review found three practical
drift points that can cause missed coverage or misleading runtime guidance:
root-level risk paths miss catalog triggers, Codex model-tier guidance no longer
matches the current `spawn_agent` capability, and the newer cataloged reviewer
lenses do not expose the same Delegation Packet contract as the first reviewer
pair.

## Goal

Harden the Activation Plan and subagent contracts so cataloged reviewer
activation is deterministic, current with Codex runtime capability, and
consistent across all cataloged child reviewer Skills.

## Scope

### In scope

- `.imm/activation_plan.py` path matching behavior for catalog `path_globs`
- `tests/test_activation_plan.py` golden coverage for root-level and nested
  trigger paths
- `docs/reference/subagent-dispatch-protocol.md` Codex model resolution wording
- `.imm/specs/subagent-runtime-mvp.spec.md` runtime truth for cataloged child
  reviewers
- `imm-advisory-reviewer` `data_integrity` lens Delegation Packet input contract
- `imm-advisory-reviewer` `reliability` lens Delegation Packet input contract
- Focused contract tests in `tests/test_skill_contracts.py`

### Out of scope

- Adding a shared runtime registry or background scheduler
- Expanding activation beyond the existing `imm-code-review` host
- Adding new child reviewers to the catalog
- Changing reviewer authority beyond advisory-only
- Implementing an end-to-end mocked `spawn_agent` harness

## Requirements

R1. The Activation Plan triggers the correct reviewer for both root-level and
nested risk paths such as `auth/session.py`, `api/users.ts`, `jobs/send.py`,
and existing nested path examples.

R2. The Activation Plan keeps deterministic ordering and max parallel behavior
after path matching is corrected.

R3. Dispatch protocol documentation reflects the current Codex `spawn_agent`
schema: model tier resolution may pass a concrete `model` when available, while
readonly posture still comes from the Delegation Packet boundary.

R4. Runtime MVP truth no longer contradicts the accepted catalog state:
`security`, `api_contract`, `data_integrity`, and `reliability` are the current
cataloged `imm-advisory-reviewer` lenses under the single `imm-code-review` host.

R5. `data_integrity` and `reliability` require the same runtime-hosted
Delegation Packet inputs as `security` and `api_contract`: `shared_context_summary`, `focus_delta`,
`tool_policy`, `fallback_reasons`, and `output_expectation`.

R6. Tests lock the corrected behavior and contract text.

## Acceptance checklist

- [ ] R1/R2: `python3 -m unittest tests.test_activation_plan` exits zero with
      root-level trigger coverage.
- [ ] R3/R4/R5/R6: `python3 -m unittest tests.test_skill_contracts` exits zero.
- [ ] Manual spot check: `imm-activation-plan --changed-path auth/session.py`
      returns `security-reviewer`.
- [ ] Manual spot check: `imm-activation-plan --changed-path jobs/send.py`
      returns `reliability-reviewer`.
