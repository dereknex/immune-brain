---
title: Imm-code-review subagent closure
type: feat
status: planned
date: 2026-05-17
---

# Spec: Imm-code-review subagent closure

## 1. Goal

Finish the `imm-code-review` subagent path so it is no longer only contract
truth. A delegated code review round must have a repo-owned host path for
turning an Activation Plan and Delegation Packets into concrete runtime
invocations, collecting child reviewer outcomes, handling retry and fallback,
and producing a dispatch summary that the parent review can synthesize.

This slice completes `imm-code-review` first. Other hosts may reuse the lessons
later, but this work must not become a shared registry or generic dispatcher.

## 2. Requirements

### R1. Host-facing invocation adapter

`imm-code-review` must have a host-facing execution adapter that consumes:

- an Activation Plan from `imm-activation-plan` or `.imm/activation_plan.py`
- Delegation Packets from `imm_core.delegation_packet.build_delegation_packets`
- optional model tier resolution metadata

The adapter must produce one invocation envelope per triggered lens. Each
envelope must include the candidate skill, lens, assembled child message,
resolved model behavior, retry budget, and advisory boundary. The adapter may
use injected runtime callables in tests; it must not call provider tools from a
pure helper by default.

### R2. Child outcome collection

`imm-code-review` must have a deterministic collector for child outcomes. The
collector must normalize:

- successful child findings
- first failure followed by retry success
- failure after retry
- timeout or unavailable runtime fallback
- partial success across multiple lenses

The normalized result must preserve enough source information for parent review
synthesis: candidate, lens, status, fallback reason when present, findings, and
plain-language summary.

### R3. Parent synthesis summary

The parent `code_review` artifact must expose dispatch results consistently:

- dispatched candidates
- dispatched lenses
- merged lens finding count
- failed or timed-out lenses
- solo fallback reason and meaning when no dispatch happened
- degraded dispatch note when only some lenses returned

Actionable child findings must not be hidden behind a passing parent summary.

### R4. Telemetry stays local and execution-aware

Dispatch telemetry remains local under `.imm/memory/dispatch_telemetry.jsonl`.
Telemetry should distinguish planned dispatch from actual child execution
outcomes where the host path has that information.

### R5. Boundary and deferred platform work

This slice must stay host-bound to `imm-code-review`. It may introduce
host-facing helpers for invocation envelopes or result collection, but it must
not introduce:

- shared runtime registry
- generic dispatcher
- background scheduler
- cross-session dispatch queue
- agent-to-agent communication
- long-lived subagent memory
- default fan-out across all review skills

Shared registry or generic dispatcher work remains deferred behind readiness
gates: three or more hosts must show repeated dispatch drift or telemetry-backed
maintenance pain before replanning that platform layer.

## 3. Acceptance Criteria

- `imm-code-review` has a tested host-facing path from Activation Plan to
  invocation envelopes.
- Child reviewer outcomes are normalized through a tested collector.
- Partial failure keeps successful lens results and records the failed lens.
- Parent dispatch summary cannot report a clean pass while actionable child
  findings remain.
- `skills/imm-code-review/SKILL.md` points to the finished host path instead of
  relying on hand-authored packets.
- Regression tests cover split dispatch, retry success, retry failure, timeout
  fallback, partial success, and no-trigger solo fallback.
- The plan validates with `imm-plan <plan> --json`.

## 4. Non-goals

- No implementation for `imm-ui-review` or `imm-party`.
- No shared registry or generic dispatcher.
- No provider SDK wrapper that directly owns Codex or Cursor tool invocation.
- No changes to `imm-work` active Step execution authority.
- No changes to QA closure authority.
