---
title: "refactor: public release sync refactor and user reference purification"
type: refactor
status: proposed
date: 2026-05-24
origin: BR-REQ-1, BR-REQ-2, BR-REQ-3
---

# Iteration Plan

## Task
- Summary: Refactor public repository synchronization logic to strictly include plugin packages and user manuals, remove private core implementation details and internal specs, and align README validation commands.
- Origin: User requested to refactor the sync script to include only plugins and user guides, and explicitly requested to update README.md templates.
- Spec: docs/specs/archive/public-release-sync-refactor.spec.md
- Research: `CONTEXT.md` defines plugin-local runtimes and documents. `scripts/sync-to-public.sh` maps `KEEP_PATHS` and `PUBLIC_REFERENCE_PATHS`. `public-release/templates/README.md` serves as the template for public repository readme. The plugin's runtime self-contains in `plugins/immune-brain/dist/.imm`.
- Decisions:
    - D1: Rely completely on the plugin's self-contained `plugins/immune-brain/dist/.imm` folder for the public release's runtime, discarding the root `.imm/` sync.
    - D2: Eliminate all spec files (empty `PUBLIC_SPEC_PATHS`) and private protocol files from sync whitelist to prevent implementation leak.
    - D3: Align README validation commands with the absolute plugin directory paths since root `.imm` is absent.
- Assumptions:
    - MCP tools loading on user sides does not rely on root `.imm` script presence.
    - The output directory target marker file checking works fine.
- Scope Mode: Two-step refactor slice
- Engineering Closure Check:
  - architecture_surface: `scripts/sync-to-public.sh`, `public-release/templates/README.md`
  - dependencies_known: yes
  - verification_path: dry-run paths checks, local execution sync tree analysis, and plan validation via `imm-plan`
  - blockers: none
  - replan_condition: If plugin execution fails without root `.imm/` folder context.

### Brainstorm manifest
| ID | Type | Description |
|:---|:---|:---|
| **BR-REQ-1** | Requirement | `sync-to-public.sh` must remove root `.imm/` path from `KEEP_PATHS`, keeping only plugin and IDE configs. |
| **BR-REQ-2** | Requirement | `sync-to-public.sh` must remove all docs/specs files and private protocol documents. |
| **BR-REQ-3** | Requirement | `sync-to-public.sh` must include user guides: `immune-brain-skills-guide.md`, `immune-brain-config.md`, `workflow-and-subagents.md`. |
| **BR-DEC-1** | Decision | Rely entirely on plugin `dist/.imm` for runtime tools, no outer `.imm/` folder inside public release. |
| **BR-OUT-1** | Out of Scope | Do not change CLI arguments or sync execution safeguards inside `sync-to-public.sh`. |
| **BR-Q-1** | Open Question | Check if templates/README.md has broken links referencing deleted specs and fix them. |

### Brainstorm Trace
| ID | Status | Description |
|:---|:---|:---|
| **BR-REQ-1** | covered_by_step | Addressed in Step 1 (U1). |
| **BR-REQ-2** | covered_by_step | Addressed in Step 1 (U1). |
| **BR-REQ-3** | covered_by_step | Addressed in Step 1 (U1). |
| **BR-DEC-1** | captured_as_decision | Mapped to Decision D1. |
| **BR-OUT-1** | out_of_scope | No command line or execution logic changes are planned for the synchronization shell engine. |
| **BR-Q-1** | covered_by_step | Solved in Step 2 (U2) by updating validation paths and pruning references. |

## Steps

### Step 1
- Step ID: U1
- Result: Public release sync whitelist is refactored
- Verification type: automated
- Verification: `bash scripts/sync-to-public.sh --dry-run | tee /tmp/sync-dry-run.log && ! grep -E -q "keep \.imm/" /tmp/sync-dry-run.log && ! grep -E -q "keep docs/specs" /tmp/sync-dry-run.log && grep -q "keep docs/reference/immune-brain-skills-guide.md" /tmp/sync-dry-run.log && grep -q "keep docs/reference/immune-brain-config.md" /tmp/sync-dry-run.log && grep -q "keep docs/reference/workflow-and-subagents.md" /tmp/sync-dry-run.log`
- Test scenarios: Dry-run path synchronization whitelist validation. Ensure root `.imm/` and specs are completely dropped, while the three user manual documents are correctly whitelisted and mapped.
- Discovery cache: scripts/sync-to-public.sh (Sync Script)
- Agent Hint: imm-executor
- failure_behavior: If the helper functions inside sync script fail to clean empty parent paths of excluded files, trace custom glob matching patterns.
- security_considerations: Check dry-run logs thoroughly to ensure no other private directories (like `upstreams/` or `.imm/memory/`) are accidentally whitelisted.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Public README validation commands are aligned
- Verification type: automated
- Verification: `python3 -c "readme = open('public-release/templates/README.md').read(); mise = open('public-release/templates/mise.toml').read(); assert 'plugins/immune-brain/dist/immune_brain_runtime.py list-tools' in readme; assert 'plugins/immune-brain/dist/.imm/activation_plan.py --validate-refs' in readme; assert 'plugins/immune-brain/dist/immune_brain_runtime.py list-tools' in mise; assert 'plugins/immune-brain/dist/.imm/activation_plan.py --validate-refs' in mise" && bash scripts/sync-to-public.sh --force --output-dir /tmp/test-pub-release && test -f /tmp/test-pub-release/README.md && test -f /tmp/test-pub-release/mise.toml && grep -q "plugins/immune-brain/dist/immune_brain_runtime.py" /tmp/test-pub-release/README.md && grep -q "plugins/immune-brain/dist/.imm/activation_plan.py --validate-refs" /tmp/test-pub-release/mise.toml`
- Test scenarios: Validate actual release file trees and public README template accuracy.
- Discovery cache: public-release/templates/README.md (README Template); public-release/templates/mise.toml (Task Template)
- Agent Hint: imm-executor
- failure_behavior: If `/tmp/test-pub-release` checks fail, re-verify manual template mapping lists.
- security_considerations: Make sure the final synced README.md contains no dead links pointing to dropped specs.
- Depends on: 1

## Notes
- Execute via `imm-work` to activate Step 1 after plan validation.
