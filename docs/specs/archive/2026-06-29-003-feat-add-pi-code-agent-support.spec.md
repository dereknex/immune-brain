---
title: "feat: add pi code agent support"
type: feat
status: proposed
date: 2026-06-29
origin: imm-brainstorm framing - add pi code agent packages support and configure context-mode
---

# Spec: Pi Code Agent Support

## Goal

Configure the project as a local Pi package and define project-level settings to automatically load and activate the local package skills along with the `context-mode` package.

## Problem

The Immune-Brain agent skill system is structured to run inside an agent environment. Currently, there is no package declaration or project settings in the workspace root to register and load the project's custom skills under the new `pi code agent` package architecture. 

In order for the `pi` agent to automatically load and activate these custom skills and tools, the project root needs a valid `package.json` that declares a `pi` manifest, and a `.pi/settings.json` file to manage project-scoped packages.

## Accepted Behavior

### R1. Root package.json defines the Pi manifest

A `package.json` must be created in the project root containing the following configuration:
- `name` is `@immune-brain/agent-skills`
- `keywords` contains `"pi-package"`
- `pi` manifest is declared with:
  ```json
  "pi": {
    "skills": ["./skills"]
  }
  ```

### R2. Project settings file configures active packages

A `.pi/settings.json` file must be created at the project root to manage project-scoped configurations.
It must declare a `packages` list containing the `context-mode` package and the local directory:
```json
{
  "packages": [
    "npm:context-mode",
    "./"
  ]
}
```

### R3. Verification of active packages and skills

Running `pi list` at the project root must successfully list:
- `./` as a project package.
- `npm:context-mode` as a project package.
Additionally, the local skills (such as `imm-brainstorm`, `imm-planner`, etc.) must be successfully resolved and loaded by the pi code agent.

### R4. Adherence to context-mode Tool Hierarchy

All tools and agents running within this project must adhere to the `context-mode` tool hierarchy:
- High-level wrappers (`ctx_batch_execute`, `ctx_execute`, `ctx_execute_file`, `ctx_search`) are preferred over low-level direct tools (like `bash`).

## Acceptance Criteria

- [ ] A `package.json` exists in the root directory and contains the `pi` config pointing to `./skills`.
- [ ] A `.pi/settings.json` exists in the root directory and includes `./` and `npm:context-mode` in the `packages` list.
- [ ] Running `pi list` lists `./` and `npm:context-mode` under `Project packages`.

## Non-goals

- Publishing the package to npm.
- Modifying the internal logic of existing skills.
- Creating global configuration settings that affect other workspaces.
