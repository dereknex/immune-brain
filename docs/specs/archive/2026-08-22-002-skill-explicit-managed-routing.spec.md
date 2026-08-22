---
status: candidate
---

# Skill-Explicit Managed Path Routing

## Goal

Remove automatic Managed Path routing from ordinary Pi host input while preserving active Assurance recovery. Immune-Brain workflow entry is explicit through the public `imm-brainstorm`, `imm-planner`, and `imm-loop` Skills.

## Decisions

- Ordinary host input is host-native and is never classified by Managed Path text heuristics.
- An active backend claim remains authoritative and resumes through `imm-loop` regardless of request origin.
- Explicit Immune-Brain Skill commands remain the only path that may initialize or use Managed bootstrap for a new workflow.
- `inspectManagedBootstrap` and `ensureManagedBootstrap` remain available to explicit initialization/Skill paths; they are removed from ordinary input routing.
- The old managed-default routing contract and its text-classification tests are retired, not preserved as compatibility behavior.

## Acceptance

1. Ordinary `pi.on("input")` events do not call `routeManagedRequest` or transform into an Immune-Brain Skill command when no active Assurance claim exists.
2. Active Assurance and repairable stale-claim projections still produce the existing owner instruction and resume behavior.
3. Explicit `imm-brainstorm`, `imm-planner`, and `imm-loop` entry remains available and bootstrap behavior remains explicit and idempotent.
4. Active documentation, packaged documentation, and tests describe Skill-explicit entry rather than Managed-by-default text routing.
5. Focused routing and extension tests pass, followed by the canonical `bun test` suite and `git diff --check`.
