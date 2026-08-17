---
title: "Execution Truth Protocol MVP for Subagents"
reusability: high
next_reuse_scenarios: "Any future expansion of subagent dispatch hosts beyond imm-code-review, or when debugging dispatch sequences."
key_files:
  - ".imm/imm_core/activation_plan.py"
  - ".imm/imm_core/delegation_packet.py"
  - ".imm/imm_core/domain_mapper_dispatch.py"
  - "skills/imm-code-review/SKILL.md"
  - "skills/imm-arch-explorer/SKILL.md"
  - "skills/imm-compounder/SKILL.md"
---

# Execution Truth Protocol MVP for Subagents

## Premise
The repository's subagent integration has moved from prose-based "contract truth" to verifiable "execution truth." A dispatch host cannot manually author packets or informally dispatch agents. It must follow a deterministic, automated CLI execution sequence that enforces model tier resolution and telemetry tracking.

## Solution

1. **Deterministic Dispatch Sequence**: Host skills (like `imm-code-review` and `imm-arch-explorer`) must follow a deterministic path. While `imm-code-review` uses `imm-activation-plan`, the newer `imm-arch-explorer` (Domain Mapper mode) uses a specialized `domain_mapper_dispatch.py` helper to ensure deterministic envelopes and normalized child outcomes.
2. **Context Sharding via Packet Helper**: Host skills must slice file contexts precisely for each reviewer lens or domain shard. `imm-arch-explorer` uses top-level directory or domain surface sharding for its parallel survey.
3. **Graceful Partial Failures**: If multiple subagents (lenses or shards) are dispatched, failure of one does not fail the entire step. Successful outcomes are merged, and the failed ones are noted with explicit fallback reasons.
4. **Telemetry Ingestion Loop**: All dispatch activities produce structured logs. `imm-compounder` parses `dispatch_telemetry.jsonl` (when available) upon iteration closure to report `dispatch_efficiency`.
5. **No Centralized Dispatcher**: Dispatch remains host-driven. Each capable host implements its own sequence according to the shared dispatch protocol, ensuring host-bound authority.

## Why it works
- **Execution Truth**: Testable assertions (via `tests/test_skill_contracts.py` and `tests/test_domain_mapper_dispatch.py`) mandate that the SKILL document specifies the exact dispatch protocol.
- **Data-Driven Feedback**: `imm-compounder` can trace actual subagent invocation counts and fallback causes (e.g. `unavailable_environment`).
- **Resilience**: Review and exploration processes continue even if a specific API contract or security check times out.

## How to reuse
- If `imm-ui-review` or other explorers become active execution truth hosts, they must copy this deterministic sequence.
- Do not construct delegation JSON by hand. Always use the established host-bound helpers.
