# Spec: Host-Bound Probe Contract Helper

**Task ID**: IMM-PROBE-CONTRACT-001
**Owner**: Planner
**Status**: Proposed
**Date**: 2026-06-05

## 1. Goal

Reduce drift across Immune-Brain's probe-style subagent helpers by introducing
a narrow shared contract helper for readonly probe payloads, fallback handling,
and child outcome normalization. The implementation must preserve host-bound
ownership: each host still decides when to build envelopes, what shard or probe
means, and how synthesis feeds the parent Skill.

## 2. Background

The architecture exploration found repeated shapes across these helper modules:

- `.imm/imm_core/work_probes.py`
- `.imm/imm_core/domain_mapper_dispatch.py`
- `.imm/imm_core/brainstorm_research.py`
- `.imm/imm_core/planner_research.py`

They repeat readonly boundaries, no-tools policy, runtime call-shape fragments,
fallback status handling, and child-attempt normalization. The existing
`dispatch_contracts.py` centralizes vocabulary, but the probe-style helpers
still each hand-roll enough contract scaffolding that future drift is likely.

This slice is intentionally narrower than a shared registry or generic
dispatcher. Existing rejected learning in
`docs/solutions/rejected-shared-registry-generic-dispatcher.md` remains binding.

## 3. Requirements

### R1. Shared helper stays pure and host-bound

Add or extend a runtime helper that provides only pure contract primitives for
probe-style hosts. It may help build readonly focus payload fragments, standard
Codex/Cursor dispatch-call fragments, fallback summaries, and normalized child
attempt outcomes.

It must not select subagents, fan out work, read local activation config,
record workflow state, write telemetry by default, or own host synthesis.

### R2. Probe-style hosts preserve public behavior

`work_probes`, `domain_mapper_dispatch`, `brainstorm_research`, and
`planner_research` should consume the shared helper where it removes real
duplication. Their public helper outputs must remain semantically stable:

- `tool_policy` remains `no tools`;
- messages still carry readonly advisory or evidence-only boundaries;
- fallback reasons remain host-visible;
- child timeouts still normalize to `timed_out` with the correct fallback;
- host-specific evidence and synthesis fields remain owned by the host module.

### R3. No generic dispatcher expansion

The slice must not introduce a shared subagent registry, background scheduler,
automatic dispatcher, model router, or cross-host launch primitive. Runtime
dispatch remains host-facing and deterministic.

### R4. Verification uses focused behavioral tests

Verification must prove behavior through focused tests, not by checking that a
new file exists. Existing helper tests should continue to validate message
shape, fallback behavior, runtime call shape, and synthesis fields after the
helpers consume shared primitives.

### R5. Plugin runtime parity is preserved

Any touched repo-local runtime file must be mirrored into
`plugins/immune-brain/dist/.imm/`, and package parity tests must cover the new
or changed runtime surface.

## 4. Non-goals

- Do not build a shared registry, generic dispatcher, scheduler, or model
  routing layer.
- Do not change activation policy or local `[subagent_activation]` handling.
- Do not make real `spawn_agent`, Cursor `Task`, or Claude Code subagent calls
  from unit tests.
- Do not migrate State Ledger shape or rewrite `.imm/memory/` history.
- Do not broaden the slice to party, code-review, or preplan helpers unless a
  focused test shows the same probe contract is required there.

## 5. Acceptance Criteria

- A shared pure helper exists for probe-style contract primitives and is covered
  by focused tests.
- Existing helper tests for work probes, Domain Mapper, Brainstorm Research,
  and Planner Research still pass after migration.
- Tests prove host helpers still own envelope construction and synthesis.
- Tests prove no-tools policy, readonly boundary text, fallback reasons, and
  timeout normalization remain stable.
- Plugin package parity includes every touched runtime file or a documented
  host-specific exception.
- The executable Plan validates with `imm-plan --json`.

## 6. Verification Path

Primary verification:

```bash
python3 -m unittest tests.test_probe_contracts tests.test_work_probes tests.test_domain_mapper_dispatch tests.test_brainstorm_research tests.test_planner_research
python3 -m unittest tests.test_immune_brain_plugin_package
python3 .imm/imm-plan.py docs/plans/2026-06-05-001-feat-host-bound-probe-contract-helper-plan.md --json
```

Focused review:

- confirm no helper can dispatch by itself;
- confirm no helper reads or writes workflow state;
- confirm host-specific synthesis fields stay in their original host modules.
