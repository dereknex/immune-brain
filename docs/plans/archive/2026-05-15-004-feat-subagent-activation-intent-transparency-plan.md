# Plan: Subagent Activation Intent Refinement and Transparency

- Summary: Refine subagent activation intent detection and improve transparency of solo fallback decisions.
- Origin: User inquiry regarding false-positive `user_requested` fallback reasons.
- Research: `imm-code-review` and `imm-ui-review` current instructions allow aggressive `explicit_solo` usage for brief tasks. `activation_plan.py` correctly handles the flag, but host guidance is too loose.
- Decisions:
  - D1: Update host SKILL.md files to restrict `explicit_solo` to explicit user negation only.
  - D2: Promote `solo_fallback_meaning` to a required field in review summaries when fallback occurs.
- Brainstorm Trace: N/A

---

### Step 1
- Step ID: U1
- Result: `skills/imm-code-review/SKILL.md` restricts `explicit_solo` usage to explicit user negation
- Verification: `grep "explicit_solo" skills/imm-code-review/SKILL.md`
- Depends on: None

### Step 2
- Step ID: U2
- Result: `skills/imm-code-review/SKILL.md` requires `solo_fallback_meaning` in review output
- Verification: `grep "solo_fallback_meaning" skills/imm-code-review/SKILL.md`
- Depends on: None

### Step 3
- Step ID: U3
- Result: `skills/imm-ui-review/SKILL.md` restricts `explicit_solo` usage to explicit user negation
- Verification: `grep "explicit_solo" skills/imm-ui-review/SKILL.md`
- Depends on: None

### Step 4
- Step ID: U4
- Result: `skills/imm-ui-review/SKILL.md` requires `solo_fallback_meaning` in review output
- Verification: `grep "solo_fallback_meaning" skills/imm-ui-review/SKILL.md`
- Depends on: None

### Step 5
- Step ID: U5
- Result: `tests/test_skill_contracts.py` asserts existence of `solo_fallback_meaning`
- Verification: `python3 -m unittest tests/test_skill_contracts.py`
- Depends on: 1, 2, 3, 4
