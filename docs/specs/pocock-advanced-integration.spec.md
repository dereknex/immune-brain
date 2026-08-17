# Pocock Advanced Integration

## Origin

Brainstorm: Further analysis of mattpocock/skills identified 5 advanced execution-phase practices (micro-disciplines) missing from the initial Pocock-inspired improvements, which focused mainly on artifacts (CONTEXT.md, ADRs, etc.). The goal is to bring Pocock's "slow down to speed up" execution discipline into Immune-Brain.

## Accepted Behaviors

### 1. Strict Diagnostic Loop (Diagnose)
- **Target**: `skills/debug-investigator/SKILL.md` and `skills/imm-executor/SKILL.md`
- **Behavior**: When tackling a bug, the system must first build a fast, deterministic, runnable feedback loop (e.g., failing test, curl script) BEFORE attempting to hypothesize or fix. 
- **Rule**: Force the generation of 3-5 falsifiable hypotheses. Only test one variable at a time. Do not proceed to fix without a reproducible loop.

### 2. Active Architecture Deepening (Improve Codebase Architecture)
- **Target**: `skills/imm-arch-explorer/SKILL.md` (New Skill)
- **Behavior**: An independent, user-initiated entry point for global codebase exploration. When requested, it actively searches for "shallow modules" using `CONTEXT.md` vocabulary and proposes consolidations that increase leverage at the seams. Once the user selects a deepening opportunity, it acts like a specialized brainstormer and hands off to `imm-planner`.
- **Rule**: Frame architecture suggestions strictly using domain language and assess against existing ADRs. Do not automatically rewrite code; propose 3-5 candidates for the user to choose from.

### 3. Strict TDD Sequence (Red-Green-Refactor)
- **Target**: `skills/imm-executor/SKILL.md`
- **Behavior**: Enhance the existing `verification_type: automated` to enforce a strict temporal sequence during execution.
- **Rule**: The executor must first write a failing test (RED), capture the failure log, then write the minimal production code to pass it (GREEN), and finally refactor.

### 4. High-Risk Deep Grilling (Relentless Grilling)
- **Target**: `skills/imm-preplan-review/SKILL.md`
- **Behavior**: For high-risk, multi-domain, or highly ambiguous tasks, escalate from lightweight inline probes to a relentless decision-tree expansion.
- **Rule**: Force resolution of every edge case before allowing the task to proceed to `imm-planner`. Update `CONTEXT.md` and ADRs interactively during this grilling phase.

### 5. Zoom-Out Perspective 
- **Target**: `skills/imm-qa/SKILL.md` and `skills/imm-code-review/SKILL.md`
- **Behavior**: Counteract the "tunnel vision" caused by atomic step execution. 
- **Rule**: QA and Code Review must include a mandatory "zoom-out" check. The reviewer must step back and evaluate if the local fix degrades the global architecture or violates the domain model, rejecting the step even if local tests pass.

## Out of Scope
- Creating exact clones of Pocock's CLI commands (`/tdd`, `/diagnose`). Instead, we are integrating the *disciplines* into existing `imm-*` roles, with the exception of the new `imm-arch-explorer` which warrants a standalone entry point to avoid polluting `imm-compounder`'s state.
- Python state-machine (`imm-work.py`) changes. All enforcement is via skill instructions and LLM behavioral prompting.
