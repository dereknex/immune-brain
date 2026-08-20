---
title: "feat: add pi code agent support"
type: feat
status: proposed
date: 2026-06-29
origin: imm-brainstorm framing - add pi code agent packages support and configure context-mode
---

# Iteration Plan

## Task

- Summary: Configure the project as a local Pi package and define project-level settings to automatically load the local skills and `context-mode` package.
- Spec: docs/specs/archive/2026-06-29-003-feat-add-pi-code-agent-support.spec.md
- Origin: User requested adding pi code agent packages support and activating `context-mode`.
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-DEC-1; BR-OUT-1
- Research: Reference docs at `https://pi.dev/docs/latest/packages` (indexed as `pi-packages-docs`). The root folder does not contain a `package.json` or `.pi/settings.json`. `skills` is a symlink pointing to `plugins/immune-brain/skills` containing the skill definitions.
- Decisions: D1 The project root is defined as a pi-package. D2 A project-scoped `.pi/settings.json` is used to activate the package and configure `context-mode` tool hierarchy.
- Assumptions: The local `pi` binary is available and behaves as documented, supporting project-scoped configuration via `.pi/settings.json`.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; the package structure and local configuration are standard.

## Output Language

- Human-readable prose: English for new Spec and Plan documents; Chinese for user-facing replies in this workspace
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Manifest

| ID | Description |
|----|-------------|
| BR-REQ-1 | Create `package.json` in project root with `"keywords": ["pi-package"]` and `"pi": {"skills": ["./skills"]}`. |
| BR-REQ-2 | Create `.pi/settings.json` in project root with `"packages": ["npm:context-mode", "./"]`. |
| BR-DEC-1 | Adhere to `context-mode` tool usage hierarchy (`ctx_batch_execute` > `ctx_execute` > `ctx_execute_file` > `ctx_search`). |
| BR-OUT-1 | Exclude publishing the package to npm. |

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-1 | covered_by_step | U1 | Step U1 creates `package.json` with the required Pi manifest configuration. |
| BR-REQ-2 | covered_by_step | U1 | Step U1 creates `.pi/settings.json` and populates the packages list. |
| BR-DEC-1 | captured_as_decision | D2 | Decisions list defines compliance with context-mode tool usage hierarchy. |
| BR-OUT-1 | out_of_scope | D1 | NPM publishing is explicitly excluded. |

## Devil's Advocate Audit

1. **Rollback Resilience**: Creating new config files (`package.json`, `.pi/settings.json`) does not modify any source code or core logic. If the configuration fails, deleting these files fully restores the repository to its exact prior state.
2. **Verification Vanity**: Simply checking if the files exist is a vanity check. The validation must run `pi list` and assert that the project is recognized as a local package and that active packages contain `./` and `npm:context-mode`.
3. **Spec Dilution Detection**: No requirement was diluted. Both package definition and local project settings activation are fully addressed.

## Planning Quality Gate

- contract surface: `package.json`, `.pi/settings.json`.
- compatibility: The local agent environment configuration does not break existing global `pi` configurations. The global configuration acts as a fallback if the project-level settings are not loaded.
- interruption recovery: If step fails, deleting the created files resets the state.
- rollback path: Revert changes via git or manual deletion of `package.json` and `.pi/settings.json`.
- verification strength: Use `pi list` command execution to check active package status.
- Brainstorm traceability: All `BR-*` items are fully trace-mapped.

## Steps

### Step 1

- Step ID: U1
- Result: Project package activation is complete
- Verification type: automated
- Verification: `./plugins/immune-brain/bin/imm-plan docs/plans/2026-06-29-003-feat-add-pi-code-agent-support-plan.md --json && pi list | grep -q "@immune-brain/agent-skills" && pi list | grep -q "npm:context-mode"`
- Test scenarios: Validates that `package.json` contains correct `pi` configuration; Validates that `.pi/settings.json` activates local package `./` and `npm:context-mode`.
- Discovery cache: package.json (package config); .pi/settings.json (project settings)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If the local `pi` environment fails to pick up the project settings, check settings file location and verify if the project is trusted.
- security_considerations: The new files must not include credentials or local private paths that should not be committed.

## Validation

- Plan validator: `./plugins/immune-brain/bin/imm-plan docs/plans/2026-06-29-003-feat-add-pi-code-agent-support-plan.md --json`
- Runtime sync: MCP `imm_plan_validate(sync=true)`
