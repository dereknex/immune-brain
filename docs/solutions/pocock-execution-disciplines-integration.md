# Pocock Execution Disciplines Integration

## Reusable Premise
Integrating advanced execution-phase disciplines from Matt Pocock's skills into Immune-Brain to move from "vibe coding" to disciplined engineering. The focus is on slowing down to speed up by enforcing feedback loops, TDD, and global architecture awareness.

## Evidence
- **Strict Diagnostic Loop**: Implemented in `debug-investigator` and `imm-executor`. Requires a feedback-loop-first path, 3-5 falsifiable hypotheses, and testing one variable at a time before any fix.
- **Strict TDD Sequence**: Implemented in `imm-executor`. Enforces the temporal RED-GREEN-REFACTOR sequence with explicit RED failure log capture.
- **High-Risk Deep Grilling**: Implemented in `imm-preplan-review`. Scales from lightweight probes to relentless decision-tree expansion for multi-domain or ambiguous tasks.
- **Zoom-Out Perspective**: Implemented in `imm-qa` and `imm-code-review`. Mandates a global architectural and domain-model check to prevent tunnel vision in atomic steps.
- **Active Architecture Deepening**: Separated into a dedicated `imm-arch-explorer` skill to maintain the Active vs Passive boundary.

## Next Reuse Scenarios
- When a codebase becomes a "ball of mud" (shallow modules), use `imm-arch-explorer` to find deepening opportunities.
- When debugging "sometimes wrong" or hard-to-reproduce bugs, use the `imm-executor` diagnostic discipline.
- When planning high-stakes architectural changes, use the `imm-preplan-review` relentless grilling.

---
reusability: high
next_reuse_scenarios:
  - Improving debugging quality for non-deterministic bugs
  - Preventing architectural degradation during atomic step execution
  - Active codebase refactoring using domain language
