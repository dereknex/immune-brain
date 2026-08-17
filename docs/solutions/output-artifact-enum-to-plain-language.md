---
title: "Output Artifact Enum Values Must Use User-Facing Language"
reusability: high
next_reuse_scenarios:
  - Adding new enum-valued fields to output artifact definitions
  - Reviewing existing output artifacts for jargon leakage
  - Adding new fallback reason codes to dispatch protocol
date: 2026-05-14
origin: user-facing-code-replacement (plan 080)
---

## Pattern

When a skill's output artifact definition contains internal enum codes
(`direct_fix`, `cost_scope_mismatch`, etc.), these codes leak into
user-facing output. Replace them with plain-language descriptions in the
artifact definition while keeping the precise codes in machine-facing
and reference docs.

## Evidence

`imm-code-review` and `imm-ui-review` output artifacts exposed
`recommended_route: direct_fix | new_slice | defer` — values that a user
cannot understand without reading skill docs. The same problem existed
for `solo_fallback_reason` codes in dispatch summaries and delegation
gate prose.

The fix followed a three-layer split:

| Layer | Treatment | Examples |
|-------|-----------|----------|
| Output artifact (user-facing) | Replace codes with natural language | `recommended_route: direct_fix` → "fits within current step boundary" |
| Narrative prose (skill docs) | Keep codes + explanation | "name why solo fallback occurred: boundary too unclear to delegate" |
| Machine schemas (protocols, CLI) | Preserve codes unchanged | `activation_plan.solo_fallback_reason`, delegation packet `fallback_reasons` |

This split preserves machine-to-machine contracts (needed by
`imm-compounder` dispatch metrics, activation plan CLI, delegation
packets) while making user-facing output comprehensible without
cross-referencing.

## Rejected Alternative

**rejected: true**
**rejection_reason: Renaming internal enum values everywhere (output, narrative, protocol, code) would create unnecessary churn for zero benefit on the machine side. The real problem is only the user-facing surface. A full rename would require updating specs, validator regexes, protocol docs, test assertions — without changing the user experience beyond what the narrower fix achieves.**

The alternative of renaming all internal codes (e.g., `direct_fix` →
`same_boundary_fix`, `cost_scope_mismatch` → `cost_benefit`) was
considered and rejected during planning (D4). It would create
unnecessary churn in specs, validators, protocol docs, and test
assertions without changing the user experience beyond what the
narrower fix achieves.

## Reusable Guidance

- **Output artifact fields are user-facing by default**: If an artifact
  field uses internal jargon, it will appear in agent output. Treat
  artifact field names and values as part of the user interface.
- **Machine codes belong in machine docs**: Protocol schemas, delegation
  packets, and CLI output schemas keep precise codes. Skill narrative
  prose may reference them but should pair each code with a
  plain-language explanation.
- **Don't rename internals just to fix output**: Renaming an internal
  enum everywhere (specs, validator regex, protocol docs, test
  assertions) creates churn. Target only the output artifact definition.
- **Related to all-skills-natural-output-contract**: This pattern extends
  the existing baseline by handling the specific case of *field-level
  enum values* within output artifacts, which the high-level principle
  ("artifact 留给 traceability") covers in theory but not in detail.

## Verification

- `skills/imm-code-review/SKILL.md:62` no longer shows
  `recommended_route: direct_fix | new_slice | defer`
- `skills/imm-ui-review/SKILL.md:56` no longer shows raw enum codes
- `docs/reference/subagent-dispatch-protocol.md:160-166` still lists all
  fallback reason codes (machine reference preserved)
- `python3 -m unittest tests.test_skill_contracts` passes
