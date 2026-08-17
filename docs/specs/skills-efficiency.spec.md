# Spec: Skills & Subagents Efficiency

## Goal
Reduce the context overhead of Immune-Brain skills by 30-50% while maintaining operational integrity. Standardize subagent delegation to a structured packet format.

## Success Criteria
- [ ] `skills/BASELINE.md` exists and contains centralized workflow logic.
- [ ] Core skills (`imm-work`, `imm-planner`) are reduced in size by at least 30%.
- [ ] Skills reference `BASELINE.md` for shared guards/styles.
- [ ] Subagent delegation packets follow the `shared_context_summary + focus_delta` pattern.
- [ ] `tests/test_skill_contracts.py` passes with updated contract expectations.

## Implementation Details
- **Baseline Components**:
    - **Output Style**: Centralize "Conclusion -> Evidence -> Next Action" pattern.
    - **Shared Guards**: Centralize "Think before coding", "Simplicity first", "Surgical changes", and "Goal-driven execution" explanations.
    - **Workflow Rules**: Move generic step activation and evidence collection rules to baseline.
- **Role Delta Pattern**:
    - Skills should focus on: Role name, Specific responsibilities, Role-specific boundary (e.g., what it can/cannot write), and Role-specific output artifact.
- **Delegation Packet**:
    - Standardize the JSON structure for subagent calls to minimize context repetition when spawning multiple agents.

## Verification Scenarios
- **Scenario 1: Token Compression**: Measure byte size of `skills/` before and after.
- **Scenario 2: Contract Integrity**: Ensure that even with compressed prompts, the agent still respects `Workflow guard` and `Authority boundary` (verified via contract tests and manual simulation).
- **Scenario 3: Delegation Packet Structure**: Confirm `imm-party` output contains the分层 (layered) packet fields.
