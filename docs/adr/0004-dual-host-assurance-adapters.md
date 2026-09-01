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
  boundary and the Pi regression suite pass.
- ADR-0002 still owns self-contained distribution and distinct consumer paths.
