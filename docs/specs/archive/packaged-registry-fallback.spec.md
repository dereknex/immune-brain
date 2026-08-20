# Spec: Packaged Registry Fallback

**Task ID**: IMM-PACKAGED-REGISTRY-FALLBACK-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Immune-Brain workflow tools must activate and autowork in business repositories that do not carry a local `skills/registry.yaml`.

Business repositories, such as `/Users/derek/workspaces/refine`, should provide product context, specs, plans, and `.imm/memory/` state. They should not be required to vendor the full Immune-Brain Skill registry. The Skill registry is part of the Immune-Brain runtime/plugin package and should be resolved from the packaged registry when the target project has no local registry.

## 2. Context & Boundaries

- `CONTEXT.md` defines Skill contracts and `skills/registry.yaml` as the machine-readable Skill registry for the Immune-Brain project itself.
- Packaged plugin surfaces already include `plugins/immune-brain/skills/registry.yaml` and `plugins/immune-brain/dist/registry.yaml`.
- `.imm/imm-work.py` currently tries a target project registry first and then a repo-local source registry. In plugin/runtime contexts this can still surface a target-business-repo missing-registry blocker instead of using packaged Skill metadata.
- `refine` is a business repository and must not be asked to add or maintain a full `skills/registry.yaml`.

This slice changes runtime registry resolution and focused contract tests only. It does not modify business repository files, plan content in `refine`, or Skill registry schema.

## 3. Requirements

### R1. Business Repository Compatibility

- Workflow entrypoints that need Skill constraints must continue when the target project lacks `skills/registry.yaml`.
- Missing target-project registry must be treated as normal for business repositories, not as a terminal blocker.
- The runtime must still fail clearly if no usable packaged/source registry can be found.

### R2. Source/Dist Registry Resolution

- Registry lookup must use Immune-Brain packaged/source registry surfaces owned by the plugin/runtime.
- Target business repository `skills/registry.yaml` must not participate in Skill registry resolution, even if present.
- Plugin command dispatch must prefer the packaged runtime over a target business repository `.imm` runtime, while keeping the target repository as the working directory and State Ledger owner.
- Error messages must point at the missing required Immune-Brain registry source, not at a target business repository registry.

### R3. Scope Discipline

- Do not create `skills/registry.yaml` in `refine`.
- Do not require business repositories to copy Immune-Brain Skill contracts.
- Do not change the registry YAML schema or Skill metadata content unless required by the fallback resolver.

### R4. Contract Verification

- Add focused regression coverage showing registry resolution works when a project root has no `skills/registry.yaml`.
- Add or update packaged runtime coverage if the packaged `dist` entrypoint owns a separate registry resolver path.
- Keep existing SkillRuntime parsing and validation failures intact for malformed or genuinely missing Immune-Brain-owned registries.

## 4. Acceptance Criteria

- `imm_work_activate` and `imm_autowork` registry setup no longer terminate solely because a business repository lacks `skills/registry.yaml`.
- A test fixture or temporary project root without `skills/registry.yaml` resolves Skill constraints from the Immune-Brain packaged/source registry.
- A test fixture or temporary project root with a fake business `skills/registry.yaml` still resolves Skill constraints from the Immune-Brain packaged/source registry.
- Plugin runtime resolution ignores a stale target business repository `.imm` runtime when a packaged Immune-Brain runtime is available.
- If Immune-Brain packaged/source registries are unavailable, the error points at the required Immune-Brain registry source rather than telling the user to add a business-repo registry.
- No file is added under `/Users/derek/workspaces/refine/skills/`.
- Focused tests pass for Skill registry fallback behavior and existing packaged runtime contracts.
