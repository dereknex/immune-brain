---
name: imm-init
description: The host invokes this automatically before the first repository-mutating Managed Path request to ensure project bootstrap state; it is idempotent for complete state and fail-closed for partial or incompatible state.
---

# Immune-Brain: Init

This skill adheres to the **[BASELINE.md](BASELINE.md)**.

## Core Responsibilities

- **Automatic Bootstrap**: The host invokes this contract before a repository-mutating Managed Path request; users do not need a separate setup command.
- **Minimum Bootstrap**: Create only the required Immune-Brain directories and files (memory, specs, brainstorms, plans, etc.).
- **Engine Hygiene**: Keep target repository free of retired local Python runtime engine files (`.imm/imm-*.py`).
- **Create-Missing**: Create the complete manifest only when the Immune-Brain state is wholly absent.
- **Fail Closed**: Partial or schema-incompatible state is rejected before any write; complete state remains byte-for-byte untouched.

## Workflow Rules

- **Project Root**: Confirm target project root before execution.
- **Idempotency**: Leave complete existing files intact. Do not patch an existing `AGENTS.md` or fill a partial manifest.
- **Execution Script**: The canonical route is `imm-route --json <request>`; direct bootstrap diagnostics use `bun skills/imm-init/scripts/init_project.ts --root <target-project-root>`.

## Boundary

- **Allowed**: same shared baseline, plus create minimum bootstrap artifacts and explain result.
- **Blocked**: same shared baseline, plus runtime engine copies, and unrelated project scaffolding. Only expand into raw path-by-path detail when the user asks for debug output.
- **Workflow guard**: after bootstrap, reapply the BASELINE route matrix. Read-only, explanation, review-only, Plan-only, and explicit no-modification requests stay host-native without Enrollment. Ambiguous mutations go to `imm-brainstorm`; clear mutations go to `imm-planner`; existing Assurance projections resume through `imm-loop`. Planner artifacts are never enrolled unconditionally.

## Output artifact

`bootstrap_report` including: `target_root`, `bootstrap`, `created_directories`, `created_files`, `updated_files`, and `skipped_files`. A partial or incompatible state returns `bootstrap_rejected` and no write is attempted.

## Next Action

Next Action: specify next skill, reason, and user confirmation needs.

## Output style

Default user-facing output: what was initialized, what was intentionally skipped,
and that the project is ready for `imm-brainstorm`, `imm-planner`, and `imm-loop`.
Read-only requests do not invoke this bootstrap contract.
