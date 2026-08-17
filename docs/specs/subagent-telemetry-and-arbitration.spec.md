# Spec: Subagent Telemetry and Conflict Arbitration

**Task ID**: IMM-SUBAGENTS-002
**Owner**: Planner
**Status**: Draft

## 1. Goal
Provide observability into the subagent dispatch mechanism and harden the conflict arbitration logic through stress testing. This addresses the "Day 2" operational needs of the subagent system.

## 2. Context
We have successfully deployed the first and second wave of subagents with a host-bound, advisory-only dispatch protocol. However, we lack visibility into how often these agents are actually triggered versus falling back to solo mode (`trigger_not_hit`, `unavailable_environment`, etc.). Additionally, the conflict arbitration order (`security > performance > compatibility > readability`) is documented but needs explicit, adversarial stress testing to ensure the parent host (`imm-code-review`) correctly converges findings.

## 3. Requirements

### R1. Dispatch Telemetry
- The system must record dispatch attempts, outcomes (split vs. solo), and fallback reasons.
- Telemetry should be appended to a local JSON lines file or an aggregated metrics file (e.g., `.imm/memory/dispatch_telemetry.jsonl`).
- The recorded metrics must include: `timestamp`, `host_skill`, `split_decision`, `solo_fallback_reason`, `triggered_children`, and `execution_status`.
- This provides the data needed to evaluate whether the deterministic trigger catalogs are effective.

### R2. Conflict Arbitration Stress Testing
- Create a dedicated test suite (e.g., `tests/test_subagent_arbitration.py`) that simulates conflicting findings from multiple subagents (e.g., `security-reviewer` says "block due to data exposure" while `performance-reviewer` says "implement caching here").
- Ensure the synthesis logic strictly follows the `security > performance > compatibility > readability` hierarchy.
- Ensure that unresolvable conflicts correctly trigger an escalation signal (e.g., returning `unresolved_conflict: true`), rather than silently failing.

## 4. Non-Goals
- Do not build a remote telemetry server, dashboard, or UI. All metrics remain local.
- Do not change the core dispatch protocol or trigger conditions; only observe them.
