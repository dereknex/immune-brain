# Replace internal codes with user-facing language in output artifacts

## Problem

Output artifacts from `imm-code-review` and `imm-ui-review` expose internal enum
codes (`direct_fix`, `new_slice`, `defer`, `cost_scope_mismatch`, `trigger_not_hit`,
etc.) that are system jargon, not user-comprehensible terms. Users should not need
to know the internal routing vocabulary to understand review results or dispatch
outcomes.

## Scope

**Affected user-facing surfaces:**

| Surface | Current code | File | Line |
|---------|-------------|------|------|
| code-review output: follow_up handoff | `recommended_route: direct_fix \| new_slice \| defer` | `skills/imm-code-review/SKILL.md` | 62 |
| code-review output: dispatch summary | `solo_fallback_reason: <code>` | `skills/imm-code-review/SKILL.md` | 64 |
| code-review: delegation gate prose | "name the fallback reason: `unclear_boundary`, `trigger_not_hit`, ..." | `skills/imm-code-review/SKILL.md` | 26 |
| ui-review output: follow_up handoff | `recommended_route: direct_fix \| new_slice \| defer` | `skills/imm-ui-review/SKILL.md` | 56 |
| activation policy: output schema | `solo_fallback_reason: <codes>` | `docs/reference/automatic-subagent-activation-policy.md` | 56 |
| dispatch protocol: solo fallback codes | `cost_scope_mismatch`, `trigger_not_hit`, etc. | `docs/reference/subagent-dispatch-protocol.md` | 160-166 |
| README: Chinese prose | `cost_scope_mismatch`, `unclear_boundary` | `README.md` | ~505 |

## Principle

- **Output artifact field names**: Replace internal enum codes with user-friendly
  natural language that a user can understand without reading skill docs.
- **Machine-facing traceability**: Preserve stable reason-code fields when another
  workflow component consumes them for metrics or routing.
- **Narrative prose in reference docs**: Keep internal codes as precise references,
  but pair them with plain-language explanations so readers can understand without
  cross-referencing.
- **Test assertions**: Update to match new output artifact language.

## Proposed replacement

### follow_up handoff (code-review + ui-review output artifact)

Before:
```
follow_up handoff: recommended_route: direct_fix | new_slice | defer
```

After:
```
follow_up handoff describing whether the finding:
- fits within the current step boundary as a same-boundary follow-up candidate
- requires a new follow-up plan (new_slice)
- should be deferred to later
```

The agent is instructed to describe the route in natural language rather than
outputting the raw enum code.

### dispatch summary (code-review output artifact)

Before:
```
solo_fallback_reason (if dispatch fell back)
```

After:
```
solo_fallback_reason: <stable reason code>
solo_fallback_meaning: why dispatch fell back to solo, in plain language
```

The code remains available for `imm-compounder` metrics; user-facing summaries use
the plain-language meaning.

### delegation gate prose (code-review)

Before:
```
name the fallback reason: unclear_boundary, trigger_not_hit, unavailable_environment, or cost_scope_mismatch
```

After:
```
name why solo fallback occurred: boundary too unclear to delegate, no trigger surface matched,
runtime environment unsupported, or dispatch cost exceeds expected benefit
```

### activation policy output schema

This is a machine-facing schema. Keep the emitted codes in the schema. Put
plain-language descriptions near the schema rather than inside `activation_plan`
unless `.imm/activation_plan.py` is intentionally changed to emit that field.

Review follow-up: do not document `solo_fallback_reason_meaning` as an emitted
`activation_plan` field unless the CLI output and tests are updated accordingly.

### dispatch protocol fallback reasons

Before:
```
- cost_scope_mismatch — delegation cost exceeds expected benefit
```

Change to: keep the code for precise machine reference, ensure the prose
description is clear enough to be the primary meaning for human readers.

## Non-goals

- Do not rename the internal enum values in code, protocol docs, or specs.
  These are stable machine-to-machine identifiers.
- Do not change machine-only surfaces (delegation packet `fallback_reasons`,
  `activation_plan` field names in validation scripts).

## Verification

- Contract test `test_code_review_defines_repairability_routing` passes with
  new output artifact language.
- Contract test `test_review_followup_handoff_contract_is_shared` passes.
- Contract test `test_runtime_mvp_host_contracts_are_explicit_and_non_platform`
  passes.
- Activation-plan tests keep CLI output and schema documentation aligned.
- `python3 -m unittest tests.test_skill_contracts` exits 0.
