# Spec: Subagent Model Tier Pipeline

**Task ID**: IMM-MODEL-TIER-001
**Owner**: Planner
**Status**: Accepted

## 1. Goal

Add an explicit model tier layer to the subagent dispatch pipeline so that:

1. Each child in the Trigger Catalog declares a `model_tier` (`fast` | `mid` | `strong` | `inherit`).
2. The Activation Plan output carries `model_tiers` per candidate.
3. `~/.immune-brain/config.toml` has a self-documenting `[subagent_models]` section where users can map tiers to concrete model IDs.
4. Dispatch protocol Phase 4 documents how to resolve tier → model ID → Task `model` parameter.
5. Catalog metadata fields (`policy_ref`, `spec_ref`) can be validated opt-in via `load_trigger_catalog(..., validate_refs=True)` or CLI `--validate-refs`.

## 2. Background

Current state: all child reviewers fully inherit the host model. No cost lever exists. As
IMM-SUBAGENT-PLAN-001 (Draft) expands dispatch into brainstorm/planner/work phases, cost will
compound without any override path.

Three structural gaps identified in analysis session (see transcript f3b0dce8):

- Trigger Catalog has no `model_tier` field per child.
- `activation_plan.py` output carries no model information for the dispatch layer.
- `~/.immune-brain/config.toml` has no `[subagent_models]` section.

Secondary gap: catalog `policy_ref` and `spec_ref` fields were not validated by default and could drift without detection when opt-in validation is skipped.

## 3. Requirements

### R1. Catalog `model_tier` field

- Each child entry in `subagent-trigger-catalog.yaml` gets an optional `model_tier: fast | mid | strong | inherit` (default: `inherit` when absent).
- Advisory tier assignments for the four current children:
  - `security-reviewer`: `mid`
  - `api-contract-reviewer`: `mid`
  - `data-integrity-reviewer`: `mid`
  - `reliability-reviewer`: `fast`

### R2. Activation Plan `model_tiers` output

- `build_activation_plan()` includes `model_tiers: {child_name: tier}` in its output dict for all triggered candidates.
- `load_trigger_catalog()` reads `model_tier` from each child entry; defaults to `"inherit"` when the field is absent.
- New contract tests cover model_tier field parsing and plan output shape.

### R3. Catalog metadata validation

- `load_trigger_catalog(..., validate_refs=True)` validates `policy_ref` and `spec_ref` when present: paths are resolved relative to the catalog file's repo root (three parents up from `docs/reference/`); missing files raise `FileNotFoundError`.
- Default activation planning uses `validate_refs=False` so managed CLI runtimes that ship only a subset of repo files (reference YAML + policy doc, without `.imm/specs/`) continue to work.
- The `imm-activation-plan` / `activation_plan.py` CLI accepts `--validate-refs` to run ref checks explicitly from a full checkout.

### R4. `config.toml` `[subagent_models]` template

- `enable_dev_insights()` in `legacy-installer.sh` writes a full self-documenting config template that includes a commented-out `[subagent_models]` section listing all four tiers with example values.
- Existing config files are never overwritten (the existing guard in `enable_dev_insights()` is preserved).
- `test_install_local.py` asserts the `[subagent_models]` commented section appears in a freshly created config file.

### R5. Dispatch protocol Phase 4 model resolution note

`subagent-dispatch-protocol.md` Phase 4 (Cursor dispatch) is extended with a model resolution step:

1. Read `model_tiers[child_name]` from the Activation Plan output (default: `inherit`).
2. If `tier != inherit`: look up `[subagent_models][tier]` from `~/.immune-brain/config.toml`.
3. If `resolved_model_id != inherit`: pass `model: resolved_model_id` to the Task tool call.
4. If `tier == inherit` or no config entry: omit the `model` parameter (host model inherits as before).

## 4. Invariants

- Default behavior (inherit) is unchanged; if no config exists or tier is `inherit`, all children continue to inherit the host model.
- `subagent-trigger-catalog.yaml` remains project-owned and git-managed.
- `~/.immune-brain/config.toml` remains user-owned and outside git.
- No changes to authority classes, Activation Plan structure (beyond adding `model_tiers`), or existing fallback semantics.
- `activation_plan.py` remains a pure function; it does not read `config.toml` at this stage. Config resolution happens in the dispatch layer at runtime.

## 5. Acceptance Criteria

- [x] Each catalog child has a `model_tier` field.
- [x] `activation_plan.py` outputs `model_tiers` dict in every Activation Plan result.
- [x] `policy_ref` / `spec_ref` can be validated via `--validate-refs` or `validate_refs=True` (default off for managed runtime compatibility).
- [x] `legacy-installer.sh` writes `[subagent_models]` commented section in fresh config.
- [x] `subagent-dispatch-protocol.md` Phase 4 documents model resolution.
- [x] All existing tests continue to pass; new model_tier contract tests pass.

## 6. Non-Goals

- Not implementing `config.toml` reads in `activation_plan.py` (config resolution stays in the dispatch layer).
- Not generating Codex agent TOML files (separate slice).
- Not reorganizing `docs/reference/` into installable vs. docs-only subdirectories (separate slice).
- Not adding `model_tier` support to `imm-party` or `imm-ui-review` catalogs.
- Not changing dispatch frequency or trigger rules.
