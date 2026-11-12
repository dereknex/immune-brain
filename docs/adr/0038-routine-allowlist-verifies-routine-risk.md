---
status: accepted
---

# A Project-Declared Allowlist Verifies The Routine Risk Declaration

Accepted on 2026-11-10 by the repository owner, for Issue #420 (revised
proposal). It extends [ADR 0023](0023-project-declared-risk-floor.md) and
applies decision 3 of [ADR 0028](0028-scope-as-estimate.md).

## Context

A TaskIntent declaring `risk: "routine"` needs only a QA attestation and
completes right after deterministic QA, without Review. That is already the
lightweight managed speed Issue #420 asked for. Its weakness is that
`routine` is a Planner judgment: the risk floor is a denylist and raises a task
only when it reaches a declared risky path, so any other change the Planner
calls `routine` settles unreviewed. Classifying at draw-up cannot help, because
no diff exists before execution and `scope_hint` is only an estimate.

## Decision

1. **No new lane.** `routine` stays the lightweight speed; Enrollment, QA,
   settlement and the terminal record are unchanged.
2. **The project declares where `routine` may stand**, in one tracked file,
   `.imm/routine-classes.json` (contract `assurance_kernel/routine_classes/v1`,
   owned by `runtime/kernel/routine_classes.ts`): named classes of literal path
   prefixes.
3. **Checked on the actual diff.** `changedPathRiskFloor` raises a task to
   `material` when the allowlist is declared and a changed path (own planning
   sidecars excluded by `resolveProjectedRisk`) lies outside every class. The
   raise requires Review and opens no gate; nothing is refused.
4. **One-way ratchet.** The allowlist only raises. A missing file means no
   allowlist. An untrusted file (the ADR 0023 trust rules, shared through
   `runtime/kernel/tracked_declaration.ts`) makes every task `critical`, and the
   file's own path is always `critical`.
5. **Visible.** `imm-kernel inspect --json` reports `risk.routine_classes` and
   `risk.outside_routine_allowlist`; the Review manifest and each child of a
   batch final report carry `outside_routine_allowlist` only when it is
   non-empty, so other manifests and reports keep their bytes.
6. **Planner advice only.** The draw-up contract tells the Planner to declare
   `routine` only inside the allowlist; the settlement check decides.
7. **Pilot.** This repository lists one class, `docs-only`: `README.md`,
   `README.zh-CN.md`, `CHANGELOG.md` and `docs/solutions`. Agent instructions
   (`docs/agents`, `docs/reference` checklists, `dist/` prompts, `AGENTS.md`,
   `CLAUDE.md`), decisions (`docs/adr`) and planning artifacts stay out. A
   further class needs its own definition, path check and a round of
   observation.

## Consequences

- A project without the file behaves exactly as before.
- A `routine` task that strays outside the list gains Review automatically;
  Review sees why.
- Changing the allowlist is a `critical` task, so it always carries a human
  approval.
- The routing policy, the risk floor contract and Fast-Track are unchanged.

## Rejected

- **A separate trivial lane or lightweight TaskIntent variant**: it duplicates
  `routine` and would keep a Review round `routine` does not need.
- **Classifying at draw-up**: no diff exists there; a declared class is a
  judgment, not a check.
- **Refusing a diff outside its class**: ADR 0028 made scope an estimate;
  raising risk is the existing response to a larger delivery.
- **A `routine` tier in `.imm/risk-floor.json` (risk_floor v2)**: ADR 0029
  requires a contract bump for the meaning change, and the floor stays a
  denylist with one purpose.
- **Comment-only, string-only and config-range classes for now**: they need
  token- or schema-level checks, and prompt text in this repository is
  behavior.
