---
title: "fix: Pocock ripple doc alignment"
type: fix
status: active
date: 2026-05-12
origin: brainstorm ripple analysis after plans 064-066 and mattpocock-skills submodule
---

# Iteration Plan

## Task
- Summary: Align IMMUNE.md plus BASELINE.md plus two reference docs to reflect new system artifacts introduced by Pocock-inspired improvements
- Origin: Brainstorm ripple analysis identified 5 gaps where governance documents lag behind skill text changes from plans 064-066
- Research: IMMUNE.md §2 missing CONTEXT.md/HANDOFF.md/docs/adr/ from directory listing; IMMUNE.md §3 compounder boundary missing docs/adr/ causing contradiction with imm-compounder/SKILL.md; BASELINE.md has no CONTEXT.md pointer; addy-contrast and mattpocock-contrast docs lack cross-links; dispatch protocol Phase 3 shared_context_summary has no domain vocabulary field
- Decisions: D1 update IMMUNE.md §2 and §3 only; D2 add thin Repo Vocabulary section to BASELINE.md; D3 add reciprocal cross-links to both contrast docs; D4 add optional domain_vocabulary field to dispatch protocol Phase 3
- Assumptions: All text-only edits; no Python tooling changes; no contract tests needed (governance docs only, not skill contracts)
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `IMMUNE.md`, `skills/BASELINE.md`, `docs/reference/addy-agent-skills-contrast.md`, `docs/reference/mattpocock-skills-contrast.md`, `docs/reference/subagent-dispatch-protocol.md`
  - dependencies_known: true
  - verification_path:
      - target: IMMUNE.md lists CONTEXT.md plus HANDOFF.md plus docs/adr/ in §2; §3 compounder entry includes docs/adr/; BASELINE.md has CONTEXT.md pointer; both contrast docs cross-link each other; dispatch protocol Phase 3 has domain_vocabulary field
      - method: grep checks on changed files plus manual spot-check; python3 -m unittest tests.test_skill_contracts (no regression)
  - blockers: none
  - replan_condition: none expected

## Steps

### Step 1
- Step ID: U1
- Result: IMMUNE.md plus BASELINE.md plus addy-contrast plus mattpocock-contrast plus dispatch-protocol are updated to acknowledge CONTEXT.md plus HANDOFF.md plus docs/adr/ plus cross-links plus domain vocabulary field
- Verification: `grep -n "CONTEXT.md" IMMUNE.md` shows hit in §2; `grep -n "docs/adr" IMMUNE.md` shows hit in §2 plus §3; `grep -n "CONTEXT.md" skills/BASELINE.md` shows hit; `grep "mattpocock" docs/reference/addy-agent-skills-contrast.md` shows cross-link; `grep "addy" docs/reference/mattpocock-skills-contrast.md` shows cross-link; `grep "domain_vocabulary" docs/reference/subagent-dispatch-protocol.md` shows hit; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers IMMUNE §2 directory list; Covers IMMUNE §3 compounder write boundary; Covers BASELINE CONTEXT.md pointer; Covers addy-contrast mattpocock cross-link; Covers mattpocock-contrast addy cross-link; Covers dispatch protocol domain_vocabulary field; Covers no skill contract regression
- Depends on: none
- Scope: `IMMUNE.md`, `skills/BASELINE.md`, `docs/reference/addy-agent-skills-contrast.md`, `docs/reference/mattpocock-skills-contrast.md`, `docs/reference/subagent-dispatch-protocol.md`
