---
title: fix: workflow friction retrospective followup
type: fix
status: planned
date: 2026-05-09
origin: user asked to turn the session retrospective into a concrete improvement plan based on the identified workflow friction points
---

# Iteration Plan

## Task
- Summary: Reduce high-signal workflow friction exposed by the telemetry session by tightening review-to-repair routing, compressing default status output, stabilizing durable summary closure, and reducing focused verification noise.
- Origin: After the telemetry implementation and follow-up fix slices completed, the user asked for a retrospective analysis of the session problems. That retrospective identified planning churn, status noise, durable-summary drift, and evidence-output clutter as the highest-value friction points to address next.
- Research: Reviewed `IMMUNE.md`, `.imm/specs/workflow-friction-reduction.spec.md`, `.imm/specs/workflow-friction-review-followup.spec.md`, `README.md`, `.imm/memory/MEMORY.md`, `.imm/imm-work.py`, `skills/imm-code-review/SKILL.md`, and the previously compounded workflow friction / durable summary solutions. Conclusion: the repo already has partial fixes for entry routing and summary hotfixes, but still lacks a compact default status surface, stronger repairability routing in code review, and a consistent low-noise evidence path.
- Decisions: D1 use Scope Reduction and prioritize the four highest-return friction fixes instead of reopening all retrospective complaints; D2 keep authority boundaries unchanged and improve only contracts, status surfaces, and focused evidence paths; D3 treat automatic skill routing and broad context-reading optimization as explicit follow-up topics, not first-slice requirements; D4 require every step to produce a directly verifiable user-visible workflow improvement rather than a broad retrospective rewrite.
- Assumptions: `imm-work status` can grow a concise default path without breaking existing JSON consumers; skill contracts and focused tests are the right enforcement point for code-review routing clarity; durable summary sync can be tightened without redesigning `current_iteration.json`; focused CLI noise can be reduced in targeted tests without destabilizing unrelated test suites.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/workflow-friction-retrospective-followup.spec.md`, `docs/plans/2026-05-09-020-fix-workflow-friction-retrospective-followup-plan.md`, `.imm/imm-work.py`, `skills/imm-code-review/SKILL.md`, `README.md`, `.imm/memory/MEMORY.md`, relevant focused tests, and any touched workflow helper tests
  - dependencies_known: true
  - verification_path:
      - target: default workflow surfaces become shorter and clearer, review follow-up routing becomes explicit, durable summary aligns with closure, and focused evidence output gets quieter without breaking runtime truth
      - method: focused unittest coverage plus direct command checks such as `python3 .imm/imm-work.py status`, targeted contract tests, and summary/top-of-file checks against completed workflow state
  - blockers: none
  - replan_condition: if implementation starts requiring new orchestration modes, automatic skill routing, a redesign of canonical runtime state ownership, or a repo-wide testing style rewrite, stop and replan as a broader workflow ergonomics initiative

## Steps

### Step 1
- Step ID: U1
- Result: `imm-code-review` explicitly distinguishes “fix inside current boundary” from “requires follow-up plan”.
- Verification: focused contract coverage passes and a representative review output path clearly routes structural follow-ups to a new fix slice instead of a generic `fix` instruction.
- Test scenarios: Covers `imm-code-review` structured output and default wording for follow-up planning; Covers repo-facing docs or contract surfaces citing the new routing rule; Covers no authority escalation into auto-fix behavior
- Depends on: none
- Scope: `skills/imm-code-review/SKILL.md`, `README.md`, relevant contract tests, and the retrospective follow-up spec only
- Replan condition: If explicit repairability routing starts requiring new workflow roles, automatic planner invocation, or state mutations from review mode, stop and return to planner.

### Step 2
- Step ID: U2
- Result: `imm-work status` default output becomes a compact high-signal summary.
- Verification: direct status command checks and focused tests confirm the default human-readable path emphasizes current plan/step, completed progress, latest review, and next action without dumping long history.
- Test scenarios: Covers default status summary shape; Covers debug or JSON path preserving full detail; Covers no regression to canonical runtime-state truth
- Depends on: 1
- Scope: `.imm/imm-work.py`, related status tests, and README or skill docs only if status invocation behavior changes need explanation
- Replan condition: If concise status requires changing the canonical runtime state schema or removing data needed by existing JSON consumers, stop and return to planner.

### Step 3
- Step ID: U3
- Result: `MEMORY.md` top summary reliably reflects completed workflow state after closure instead of lingering in stale execute/planned wording.
- Verification: focused summary-sync coverage plus top-of-file checks confirm a completed plan routes durable summary to closed/compound wording in sync with runtime completion state.
- Test scenarios: Covers plan-complete summary alignment; Covers no edits to canonical runtime-state ownership; Covers compatibility with existing finish/compound closure path
- Depends on: 2
- Scope: closure/summary path code and tests, `.imm/memory/MEMORY.md` contract docs where necessary, and the retrospective follow-up spec only
- Replan condition: If reliable summary sync cannot be achieved without redesigning `current_iteration.json`, finish semantics, or compound state ownership, stop and return to planner.

### Step 4
- Step ID: U4
- Result: focused workflow/telemetry verification paths stop polluting evidence with routine success-path CLI noise.
- Verification: focused tests pass while success-path stdout clutter is reduced, and execution evidence for touched workflow commands becomes easier to scan without changing the underlying contract being tested.
- Test scenarios: Covers targeted workflow or telemetry tests that currently leak routine success prints; Covers preserving stdout assertions when output itself is the contract; Covers no repo-wide testing style rewrite
- Depends on: 3
- Scope: targeted touched tests and minimal helper adjustments only; no global test harness rewrite
- Replan condition: If noise reduction requires a broad unittest harness redesign or suppression patterns across unrelated suites, stop and return to planner.

## Notes
- This plan intentionally leaves automatic skill switching and general context-read minimization out of scope; those are broader ergonomics topics that should only be reopened after the current friction surfaces are tightened.
- The order is deliberate: review routing clarity should come before status compression, status compression before durable-summary sync, and evidence-noise cleanup last so it can reuse the narrower workflow surfaces.
