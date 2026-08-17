# Iteration Plan: Subagent Telemetry and Arbitration Integration Follow-up

## Task
- Summary: Wire subagent telemetry and arbitration helpers into executable host-facing paths so the previous slice is not test-only.
- Origin: Follow-up from `imm-code-review` findings on the completed subagent telemetry and arbitration slice.
- Spec: `.imm/specs/subagent-telemetry-arbitration-integration.spec.md`

## Research
- Existing `.imm/activation_plan.py` can record telemetry only when `record_telemetry=True` or the CLI is called with `--record-dispatch-telemetry`.
- Existing `.imm/review_arbitration.py` is currently referenced only by `tests/test_imm_review.py`.
- The prior plan `docs/plans/2026-05-14-080-feat-subagent-telemetry-and-arbitration-plan.md` is completed, so this follow-up uses `new_slice` instead of append.

## Decisions
- Use `new_slice`; do not mutate the completed `080` plan.
- Keep telemetry local in `.imm/memory/dispatch_telemetry.jsonl`.
- Integrate arbitration through a host-facing synthesis function or adapter, not through real subagent dispatch.
- Preserve existing non-goals: no remote telemetry, no dashboard, no shared runtime registry.

## Assumptions
- Python `unittest` remains the verification runner for `.imm` helper behavior.
- The executable host-facing path can be represented by local Python helpers because current host skills are documentation-driven rather than a long-running service.

---

### Step 1
- Step ID: U1
- Result: Activation planning records dispatch telemetry through the host-facing execution path
- Verification: `python3 -m unittest tests.test_activation_plan tests.test_telemetry_trace` exits zero
- Execution note: test-first
- Depends on: None

### Step 2
- Step ID: U2
- Result: Host-facing review synthesis follows arbitration helper behavior
- Verification: `python3 -m unittest tests.test_imm_review` exits zero
- Execution note: test-first
- Depends on: 1
