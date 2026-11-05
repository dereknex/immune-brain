---
status: accepted
---

# Dual-Host Assurance Adapters

## Context

Kernel authority is host-neutral, but foreground Enrollment, QA sequencing,
Review observation, and package contracts were Pi-only. ADR-0002 recorded that
non-Pi adapters were retired. A second first-class Host needs a shared
Assurance boundary without copying the Kernel or weakening attestation.

## Decision

1. Keep one Kernel and one persisted authority protocol. Hosts consume
   TaskRecord, claims, and Assurance Projection; they do not own a second
   workflow state machine.
2. Extract a narrow host-neutral Assurance coordinator and Host Port under
   `plugins/immune-brain/runtime/assurance/`. Host adapters supply native
   confirmation, Review observation, progress, and cancellation transport.
3. Preserve existing Pi public Tool schemas, preparation contract bytes,
   cancellation linearization, and Review receipt ordering through compatibility
   re-exports. Temporary `.pi-extension` shims exit after both active adapters
   import the neutral modules; owner: runtime maintainer; milestone: the next
   major release after both adapters and package consumers import the new paths.
4. Root `package.json` remains the sole version manifest. It may ship more than
   one first-class Host artifact at that version. Retired hosts stay rejected.
5. Do not introduce a generic host registry, automatic dispatcher, or handoff
   TaskRecord schema.

## Rejected Alternatives

- A Claude-only bridge that leaves Enrollment, QA, Review, and settlement on Pi.
- Renaming `assurance_kernel/pi_canary_preparation/v1` for aesthetic neutrality.
- A generic multi-host dispatcher or shared agent registry.

## Consequences

- Pi behavior is the characterization oracle for the extracted coordinator.
- A later Host adapter can complete the same Managed Path only after this
  boundary and the Pi regression suite pass. The Claude Code adapter consumes
  this coordinator through `plugins/immune-brain/runtime/claude/` and ships as
  one versioned plugin next to Pi.
- ADR-0002 still owns self-contained distribution and distinct consumer paths.

## Amendment: Antigravity as Third First-Class Host (2026-11-05)

### Context

Issue #397 introduces Google Antigravity (CLI `agy` and Antigravity 2.0 Desktop/IDE) as the third first-class host harness alongside Pi and Claude Code.

### Decision

1. The architectural invariant of ADR-0004 stands: **one Kernel, one persisted authority protocol, no generic Host registry or autonomous dispatcher**.
2. Antigravity integrates as a first-class adapter under `plugins/immune-brain/runtime/antigravity/` and collocated plugin manifests (`plugin.json`, `mcp_config.json`, `hooks.json`).
3. Host-specific governance leverages native Antigravity lifecycle hooks:
   - `PreInvocation` monitors explicit `/drive` user prompts to establish session-bound Run Entry tokens.
   - `PreToolUse` enforces native enrollment gates via `force_ask` and restricts file modifications to active Lane boundaries.
   - Read-only Reviewer subagents are dispatched natively via `define_subagent` (disabling write tools) and `invoke_subagent`.
   - `Stop` lifecycle hook drives run continuation for active claims and unattended lanes.
4. Conformance verification expands from dual-host parity to tri-host assurance parity across Pi, Claude Code, and Antigravity.
