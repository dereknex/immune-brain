---
title: Subagent Execution Truth MVP
type: feat
status: planned
date: 2026-05-17
---

# Spec: Subagent Execution Truth MVP

## 1. Goal

Harden the runtime path for a single host (`imm-code-review`) to prove the end-to-end delegation loop works beyond contracts. This moves the system from "contract truth" to "execution truth" by ensuring the agent actually follows the deterministic steps for subagent dispatch using the built-in CLI helpers, resolves model tiers locally, and feeds telemetry into the compounder.

## 2. Requirements

- **R1. Host Dispatch Hardening**: `imm-code-review` must use `.imm/imm_core/activation_plan.py` or the `imm-activation-plan` CLI wrapper to build the activation plan, and use the `.imm/imm_core/delegation_packet.py` helper to shard files and build the exact delegation packets.
- **R2. Model Tier Resolution**: The execution environment must resolve the `model_tier` output (e.g., `mid`, `fast`) from the activation plan to concrete, non-`inherit` model IDs before calling `invoke_agent` or `spawn_agent`. This maps through `~/.immune-brain/config.toml` ideally, but with a local fallback mechanism.
- **R3. Compounder Telemetry Integration**: `imm-compounder` must consume the `dispatch_telemetry.jsonl` produced by `activation_plan.py` and report on subagent efficiency (e.g., counts of split vs solo, lenses used) in the final learning artifacts.
- **R4. Partial Failure Handling**: If `imm-code-review` dispatches multiple lenses and one fails (after 1 retry), it must merge the successful ones, note the fallback reason for the failed one, and continue the review without failing the whole process.
- **R5. Scope Constraints**: Do not build a centralized dispatcher. Dispatch remains host-driven. Keep the target as `imm-advisory-reviewer`.

## 3. Boundary

- **Allowed**: Updates to `skills/imm-code-review/SKILL.md` (to clarify execution sequencing and partial failure), `skills/imm-compounder/SKILL.md` (for telemetry ingestion), and potentially a small CLI helper for model tier resolution if needed.
- **Blocked**: Centralized dispatcher daemons, changes to `imm-work` execution loop for parallel execution.

## 4. Verification

- Focused regression/unit tests confirming `imm-compounder` can parse `dispatch_telemetry.jsonl` and summarize it.
- Manual/CLI test that `imm-code-review` properly outlines the `run_shell_command` -> `invoke_agent` flow.
