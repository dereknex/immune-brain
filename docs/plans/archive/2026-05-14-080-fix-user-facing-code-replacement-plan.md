# Iteration Plan: Replace internal codes with user-facing language in output artifacts

## Task

- Summary: Replace internal enum codes with plain-language descriptions in output artifact definitions so users do not need to know system jargon to understand review results and dispatch outcomes
- Origin: imm-brainstorm -> imm-planner
- Spec: `.imm/specs/user-facing-code-replacement.spec.md`

## Research

- `skills/imm-code-review/SKILL.md` line 62 defines `follow_up` handoff with `recommended_route: direct_fix | new_slice | defer` — this appears in user-facing output
- `skills/imm-code-review/SKILL.md` line 64 defines `solo_fallback_reason` in dispatch summary — also user-facing
- `skills/imm-code-review/SKILL.md` line 26 names raw fallback codes as part of delegation gate prose
- `skills/imm-ui-review/SKILL.md` line 56 defines `recommended_route: direct_fix | new_slice | defer` in output artifact
- `docs/reference/automatic-subagent-activation-policy.md` line 56 uses `solo_fallback_reason` codes in machine-facing schema
- `docs/reference/subagent-dispatch-protocol.md` lines 160-166 list fallback reason codes with explanations
- `README.md` line ~505 exposes raw codes in Chinese prose
- `tests/test_skill_contracts.py` has assertions checking output artifact language
- Review follow-up: `skills/imm-code-review/SKILL.md` removed the machine-readable `solo_fallback_reason` field from the optional dispatch summary, but `skills/imm-compounder/SKILL.md` still expects reason-code distributions for dispatch metrics
- Review follow-up: `docs/reference/automatic-subagent-activation-policy.md` placed `solo_fallback_reason_meaning` inside the `activation_plan` output schema, but `.imm/activation_plan.py` only emits `solo_fallback_reason`

## Decisions

- D1: Output artifact field definitions change from raw enum to natural language description. Agent still routes internally the same way but surfaces plain language to the user.
- D2: Reference docs keep internal codes for machine reference but pair them with self-explanatory prose.
- D3: Test assertions update to match new language.
- D4: Do not rename internal enum values — these are stable machine-to-machine identifiers.
- D5: Dispatch summaries must keep machine-readable fallback reason codes for downstream metrics while adding a user-readable meaning alongside them.
- D6: `activation_plan` schema must describe only emitted fields; human-readable meanings belong in surrounding prose or tables unless the CLI output is intentionally changed.

## Assumptions

- Agent can interpret routing intent from natural-language artifact descriptions
- imm-compounder dispatch metrics use semantic grouping, not exact string matching against artifact output codes

---

### Step 1

- Step ID: U1
- Result: Plain-language output artifact replaces internal enum codes across all skill definitions
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero
- Depends on: None

### Step 2

- Step ID: U2
- Result: Reference docs pair internal codes with plain-language descriptions
- Verification: `grep 'cost_scope_mismatch' docs/reference/subagent-dispatch-protocol.md | head -3` returns at least one line (codes preserved with explanations)
- Depends on: 1

### Step 3

- Step ID: U3
- Result: Fallback artifacts keep machine reason codes with user-facing meanings
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` exits zero and `python3 .imm/activation_plan.py --host imm-code-review --task-summary 'plain docs change' --changed-path docs/reference/subagent-dispatch-protocol.md` emits `solo_fallback_reason` without emitting `solo_fallback_reason_meaning`
- Depends on: 2
