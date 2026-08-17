# Iteration Plan: Subagent Telemetry and Arbitration

## Task
- Summary: Provide observability into the subagent dispatch mechanism through local telemetry and harden the conflict arbitration logic through stress testing.
- Origin: Derived from the `imm-brainstorm` session analyzing the current subagent implementation state and upstream capabilities.
- Spec: `.imm/specs/subagent-telemetry-and-arbitration.spec.md`

## Research
- Dispatch protocol is mature and deterministic but lacks observability.
- Telemetry must remain local (`.imm/` state). 
- Arbitration logic must strictly enforce `security > performance > compatibility > readability` without silently dropping unresolvable conflicts.

## Decisions
- Use `new_slice`.
- Store dispatch telemetry in `.imm/memory/dispatch_telemetry.jsonl` to allow easy appending without complex file locking.
- Create specific test fixtures injecting conflicting subagent outputs to verify the synthesis behavior of `imm-code-review` and `imm-ui-review`.

## Assumptions
- Python test runner (`pytest` or `unittest`) is available for running the arbitration stress tests in the `tests/` directory.

---

### Step 1
- Step ID: U1
- Result: Planning artifacts established
- Verification: `python3 .imm/imm-plan.py docs/plans/2026-05-14-080-feat-subagent-telemetry-and-arbitration-plan.md --json` exits zero
- Depends on: None

### Step 2
- Step ID: U2
- Result: Local telemetry recording added to subagent dispatch implementation
- Verification: `python3 -m unittest tests.test_telemetry_trace` exits zero
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Conflict arbitration stress tests verify priority order enforcement
- Verification: `python3 -m unittest tests.test_imm_review` exits zero
- Depends on: 2
