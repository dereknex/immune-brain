---
name: imm-init
description: Use when bootstrapping projects.
---

# Immune-Brain: Init

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Core Responsibilities

- **Minimum Bootstrap**: Create only the required Immune-Brain directories and files (memory, specs, brainstorms, plans, etc.).
- **Engine Hygiene**: Keep target repository free of retired local Python runtime engine files (`.imm/imm-*.py`).
- **Create-Missing**: Prefer creating missing artifacts over broad scaffolding.

## Workflow Rules

- **Project Root**: Confirm target project root before execution.
- **Idempotency**: Leave existing files intact. `AGENTS.md` may receive one bounded section.
- **Execution Script**: Run `bun skills/imm-init/scripts/init_project.ts --root <target-project-root>`.

## Boundary

- **Allowed**: same shared baseline, plus create minimum bootstrap artifacts and explain result.
- **Blocked**: same shared baseline, plus runtime engine copies, and unrelated project scaffolding. Only expand into raw path-by-path detail when the user asks for debug output.
- **Workflow guard**: after bootstrap, reapply the BASELINE route matrix. When no Managed trigger applies, continue directly with the ordinary host agent. Use `imm-brainstorm` or `imm-planner` only for ambiguity or a Managed trigger.

## Output artifact

`bootstrap_report` including: `target_root`, `created_directories`, `created_files`, and `updated_files`.

## Next Action

Next Action: specify next skill, reason, and user confirmation needs.

## Output style

Default user-facing output: what was initialized, what was intentionally skipped,
and that the project is ready for Direct work plus conditional Managed entrypoints.
