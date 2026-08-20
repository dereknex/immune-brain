---
title: "feat: analyze gstack skills and derive borrow insights"
type: feat
status: planned
date: 2026-05-24
origin: user asked to evaluate the gstack borrow spec and then route the stable framing to imm-planner
---

# Iteration Plan

## Task
- Summary: Produce an evidence-backed Learning that analyzes gstack Skill patterns and maps which ideas agent-skills should borrow, defer, or reject.
- Origin: User asked whether `docs/specs/archive/analyze-gstack-skills-borrow-insights.spec.md` and the current Plan were reasonable; brainstorm concluded the spec direction is useful but the existing Plan was too thin and the referenced data-integrity Plan was unrelated.
- Spec: docs/specs/archive/analyze-gstack-skills-borrow-insights.spec.md
- Research: `CONTEXT.md` defines Plan, Spec, Step, Skill, Learning, Activation Plan, and State Ledger. `upstreams/gstack/CLAUDE.md` documents generated `SKILL.md.tmpl` workflow and conflict handling. `upstreams/gstack/BROWSER.md` documents the persistent browser daemon, browser-skill codification, accessibility refs, staleness detection, and layered prompt-injection defense. `README.md` records current gstack borrowing posture. `docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md` rejects a third memory store that would duplicate gstack-style learnings. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects shared registry or generic dispatcher expansion without stronger host drift evidence.
- Decisions: D1 keep this slice docs-only and produce one durable Learning under `docs/solutions/`; D2 use existing repository vocabulary and avoid adding root `CLAUDE.md`; D3 classify each gstack idea as P1 direct borrow, P2 design follow-up, P3 infrastructure-dependent, or rejected/deferred; D4 explicitly preserve the rejected boundaries around SQLite/FTS memory layers, shared registry, browser daemon implementation, and runtime prompt-injection infrastructure.
- Assumptions: `upstreams/gstack` remains readable locally. The final Learning can cite source paths instead of importing gstack code. Mermaid text review is sufficient because this slice does not render a site or app.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: docs/specs/archive/analyze-gstack-skills-borrow-insights.spec.md, docs/plans/2026-05-24-003-analyze-gstack-skills-borrow-insights-plan.md, docs/solutions/gstack-skills-borrow-insights.md
  - dependencies_known: true
  - verification_path:
      - target: `docs/solutions/gstack-skills-borrow-insights.md` is a durable Learning with evidence-backed sections and a phased borrow decision table.
      - method: file/path checks, text coverage checks, Mermaid fence checks, and `python3 .imm/imm-plan.py docs/plans/2026-05-24-003-analyze-gstack-skills-borrow-insights-plan.md --json`
  - blockers: If upstream evidence for any of the five dimensions is missing or contradictory, narrow that dimension to "defer pending evidence" instead of inventing a local adoption plan.
  - replan_condition: If execution needs code migration, browser daemon runtime work, new memory storage, shared registry, or root host-document creation, stop and replan.

## Steps

### Step 1
- Step ID: U1
- Result: gstack source evidence index covers the five borrow dimensions
- Verification: `test -f docs/solutions/gstack-skills-borrow-insights.md && rg -n "Evidence Index|SKILL.md.tmpl|Operational Learner|Accessibility Ref|Canary Token|Skill Routing" docs/solutions/gstack-skills-borrow-insights.md`
- Verification type: automated
- Test scenarios: Confirm every dimension has at least one concrete upstream path and no section relies only on summary prose.
- Discovery cache: upstreams/gstack/CLAUDE.md (SKILL template workflow and conflict guidance); upstreams/gstack/BROWSER.md (browser daemon, refs, browser-skills, and security stack); upstreams/gstack/*/SKILL.md.tmpl (template source examples)
- Parallel probes: [{"scope":"upstreams/gstack/CLAUDE.md and upstreams/gstack/*/SKILL.md.tmpl","output":"Template generation, conflict, and routing evidence with exact paths","readonly":true},{"scope":"upstreams/gstack/BROWSER.md and upstreams/gstack/browse/src","output":"Browser daemon, accessibility ref, staleness, and security evidence with exact paths","readonly":true},{"scope":"README.md docs/solutions docs/reference","output":"Local borrow boundaries, rejected decisions, and matching Immune-Brain vocabulary","readonly":true}]
- Depends on: none

### Step 2
- Step ID: U2
- Result: local adaptation matrix classifies gstack ideas by adoption tier
- Verification: `rg -n "P1|P2|P3|Rejected|Deferred|FileSystem-as-Brain|shared registry|browser daemon|CLAUDE.md" docs/solutions/gstack-skills-borrow-insights.md`
- Verification type: automated
- Test scenarios: Confirm P1 items are docs or contract improvements only, while runtime-heavy ideas are P2/P3/deferred and rejected boundaries cite existing Learning files.
- Discovery cache: CONTEXT.md (canonical vocabulary); README.md (current upstream borrowing posture); docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md (memory boundary); docs/solutions/rejected-shared-registry-generic-dispatcher.md (dispatch boundary)
- Depends on: 1

### Step 3
- Step ID: U3
- Result: gstack borrow insights Learning is complete
- Verification: `test -f docs/solutions/gstack-skills-borrow-insights.md && rg -n "Abstract|Mermaid Context Map|The Five Golden Ore|Action Roadmap|Evidence Index|Local Schema Sketches" docs/solutions/gstack-skills-borrow-insights.md && rg -n "BASELINE|allowed-tools|Preamble|Quirks|count\\(\\)|Deterministic BLOCK|L5" docs/solutions/gstack-skills-borrow-insights.md && rg -n '```mermaid' docs/solutions/gstack-skills-borrow-insights.md`
- Verification type: automated
- Test scenarios: Confirm the Learning has Abstract, Mermaid Context Map, five dimension sections, roadmap, evidence index, schema snippets, detailed mechanism coverage for BASELINE/allowed-tools, Preamble/Quirks, count() staleness, L5 Deterministic BLOCK, and clear "borrow/defer/reject" decisions.
- Discovery cache: docs/specs/archive/analyze-gstack-skills-borrow-insights.spec.md (accepted content contract); docs/solutions/gstack-skills-borrow-insights.md (Learning artifact)
- Depends on: 2

### Step 4
- Step ID: U4
- Result: final validation passes for the gstack borrow Plan
- Verification: `python3 .imm/imm-plan.py docs/plans/2026-05-24-003-analyze-gstack-skills-borrow-insights-plan.md --json && test -f docs/solutions/gstack-skills-borrow-insights.md && rg -n "P1|P2|P3|Evidence Index|Mermaid Context Map|Local Schema Sketches" docs/solutions/gstack-skills-borrow-insights.md && rg -n "BASELINE|allowed-tools|Preamble|Quirks|count\\(\\)|Deterministic BLOCK|L5" docs/solutions/gstack-skills-borrow-insights.md`
- Verification type: automated
- Test scenarios: Confirm `imm-plan` parses the revised Plan, the final Learning exists, the roadmap is phased, the report covers the Accepted spec's detailed dimension requirements, and it does not claim implementation of non-goal runtime systems.
- Discovery cache: .imm/imm-plan.py (Plan validator); docs/plans/2026-05-24-003-analyze-gstack-skills-borrow-insights-plan.md (validation target); docs/specs/archive/analyze-gstack-skills-borrow-insights.spec.md (acceptance criteria)
- Depends on: 3

## Notes
- This Plan intentionally replaces the unrelated `2026-05-09` data-integrity reviewer slice for this request.
- `docs/solutions/gstack-skills-borrow-insights.md` is the only new durable output expected from execution.
- Any desire to implement a browser daemon, prompt-injection classifier, shared registry, or new memory store must become a separate Spec and Plan.
