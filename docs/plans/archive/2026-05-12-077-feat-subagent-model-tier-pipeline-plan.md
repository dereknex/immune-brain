---
title: "feat: subagent model tier pipeline"
type: feat
status: active
date: 2026-05-12
origin: analysis session (transcript f3b0dce8) — three structural gaps in subagent dispatch model control
---

# Iteration Plan

## Task
- Summary: Add a model tier layer from Trigger Catalog through Activation Plan output, with a self-documenting user config template and dispatch protocol documentation
- Origin: Brainstorm analysis identified three gaps: no `model_tier` in Trigger Catalog, no model information in Activation Plan output, no `[subagent_models]` section in user config
- Research: `subagent-trigger-catalog.yaml` v1 has 4 children with no `model_tier` field; `policy_ref`/`spec_ref` in catalog are not consumed by any tool; `activation_plan.py` output shape carries no model fields; `~/.immune-brain/config.toml` only has `[dev_insights]`; dispatch protocol Phase 4 Task call has no `model` parameter; all four current children are advisory-only readonly and do not require full host-model inheritance
- Decisions: D1 `model_tier` default is `inherit` so no behavior change when field is absent; D2 advisory tier assignments are security/api-contract/data-integrity → `mid`, reliability → `fast`; D3 `policy_ref`/`spec_ref` made functional (path existence check) rather than removed; D4 config template uses commented-out section so fresh install is visible but inactive; D5 `activation_plan.py` remains a pure function and does not read `config.toml`
- Assumptions: TOML config parsing for `[subagent_models]` is the responsibility of dispatch callers (Skills), not `activation_plan.py`; `model_tiers` is an additive output field so callers ignoring it continue to work
- Scope Mode: Hold Scope
- Engineering Closure Check:
    - architecture_surface: `docs/reference/subagent-trigger-catalog.yaml`, `.imm/activation_plan.py`, `tests/test_activation_plan.py`, `scripts/legacy-installer.sh`, `docs/reference/subagent-dispatch-protocol.md`, `tests/test_install_local.py`
    - dependencies_known: true
    - verification_path:
        - target: catalog carries model_tier; Activation Plan output carries model_tiers; fresh config.toml includes subagent_models template; protocol Phase 4 documents model resolution
        - method: `python3 -m pytest tests/test_activation_plan.py tests/test_install_local.py -v`
    - blockers: none
    - replan_condition: if model_tier needs runtime resolution in activation_plan.py (reading config.toml), or if Codex TOML generation is required, stop and open a new slice

## Steps

### Step 1
- Step ID: U1
- Result: The model tier layer is established from Trigger Catalog fields through Activation Plan output with validated catalog metadata
- Verification: `python3 -m pytest tests/test_activation_plan.py -v` exits zero with new model_tier contract tests included
- Agent Hint: imm-executor
- Test scenarios: catalog child with explicit `model_tier` is parsed correctly; child without `model_tier` defaults to `"inherit"`; `model_tiers` appears in Activation Plan output for all triggered candidates; `policy_ref` pointing to a missing file raises a clear error; existing security/api/data/reliability trigger tests continue to pass
- Depends on: none
- Scope: `docs/reference/subagent-trigger-catalog.yaml`, `.imm/activation_plan.py`, `tests/test_activation_plan.py`
- Replan condition: If adding `model_tiers` to the output breaks `test_skill_contracts.py` or `test_install_local.py` activation probe assertions, stop and assess whether a broader output schema migration is needed.

### Step 2
- Step ID: U2
- Result: The model tier resolution path from dispatch to user config is fully documented in config template plus protocol Phase 4
- Verification: `python3 -m pytest tests/test_install_local.py -v` exits zero with new assertion for `[subagent_models]` block; `bash scripts/legacy-installer.sh --check` exits zero; Phase 4 in protocol doc matches Spec R5
- Agent Hint: imm-executor
- Test scenarios: fresh config.toml created by `enable_dev_insights()` contains `[subagent_models]` section as comments; existing config.toml is not overwritten; `--check` passes after install; protocol Phase 4 describes tier → model resolution
- Depends on: 1
- Scope: `scripts/legacy-installer.sh`, `docs/reference/subagent-dispatch-protocol.md`, `tests/test_install_local.py`
- Replan condition: If adding the `[subagent_models]` section to config.toml requires a versioning or migration mechanism for existing installs, stop and replan.

## Notes
- This plan intentionally keeps `activation_plan.py` as a pure function. Tier-to-model-ID resolution via config.toml is documented in the dispatch protocol and performed by the calling Skill at dispatch time, not by the Activation Plan itself.
- `docs/reference/` partitioning (installable vs docs-only subdirectory) is explicitly out of scope — tracked as a separate follow-up slice.
