---
title: "feat: Pocock-inspired improvements for Immune-Brain skills"
type: feat
status: active
date: 2026-05-12
origin: brainstorm — deep study of mattpocock/skills repo identifying 7 improvement directions (CONTEXT.md, feedback loop quality, prototype steps, fast-track, handoff doc, rejected decisions, ADR mechanism)
---

# Iteration Plan

## Task
- Summary: Add seven Pocock-inspired capabilities to Immune-Brain skills across domain language awareness, verification quality annotations, prototype step support, small-task fast-track, cross-session handoff document, rejected-decision records, and lightweight ADR mechanism
- Origin: User-directed comparison of mattpocock/skills against Immune-Brain identifying CONTEXT.md shared vocabulary, feedback-loop-first diagnosis, prototype-as-design-tool, composable small skills, handoff documents, out-of-scope knowledge base, and ADR discipline as transferable improvements
- Research: Pocock CONTEXT.md defines domain terms with avoid-lists and relationships reducing agent verbosity and improving naming consistency; /diagnose mandates feedback loop before hypothesis; /prototype splits logic vs UI with throwaway-first principle; /handoff compresses session into one markdown for fresh agent; .out-of-scope/ records rejected features to prevent re-litigation; ADR format is minimal one-paragraph with three-criteria trigger gate; /caveman demonstrates mode-switching for ceremony reduction
- Decisions: D1 CONTEXT.md lives at repo root not under .imm/ for universal agent access; D2 fast-track threshold is plans with two or fewer steps; D3 all seven directions included as four independently closable outcome steps grouped by change surface; D4 changes are skill text and contract tests only with no Python tooling modifications; D5 HANDOFF.md at repo root as convenience artifact not source of truth; D6 rejected decisions use existing docs/solutions/ with a rejected tag rather than a separate directory; D7 ADR directory is docs/adr/ following Pocock convention
- Assumptions: All changes are additive text in SKILL.md files; test_skill_contracts.py can accommodate new assertions; CONTEXT.md does not exist yet and will be created by executor during step 1; docs/adr/ does not exist yet
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `CONTEXT.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `skills/imm-work/SKILL.md`, `skills/imm-executor/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-compounder/SKILL.md`, `tests/test_skill_contracts.py`, `.imm/specs/pocock-inspired-improvements.spec.md`
  - dependencies_known: true
  - verification_path:
      - target: CONTEXT.md exists at repo root with IMM domain terms; brainstorm and planner reference CONTEXT.md; planner supports verification_type and prototype annotations; QA checks verification quality; work supports fast-track and HANDOFF.md; executor supports prototype steps; compounder supports rejected decisions and ADR suggestions; contract tests pass
      - method: `python3 -m unittest tests.test_skill_contracts` and `python3 .imm/imm-plan.py docs/plans/2026-05-12-064-feat-pocock-inspired-improvements-plan.md --json`
  - blockers: none
  - replan_condition: if CONTEXT.md creation during step 1 reveals naming conflicts with existing docs/solutions/ terms that require broader reconciliation

## Steps

### Step 1
- Step ID: U1
- Result: Immune-Brain domain vocabulary is defined in a repo-root CONTEXT.md plus referenced by brainstorm plus planner workflow rules for term consistency
- Verification: `CONTEXT.md` at repo root contains at minimum a Language section with domain terms and a Relationships section; `skills/imm-brainstorm/SKILL.md` Workflow Rules contains a CONTEXT.md awareness rule for surfacing term conflicts; `skills/imm-planner/SKILL.md` Planning Rules contains a CONTEXT.md vocabulary rule for step descriptions; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers CONTEXT.md file existence at repo root; Covers brainstorm CONTEXT.md reference text; Covers planner CONTEXT.md reference text; Covers no regression on existing contract tests
- Depends on: none
- Scope: `CONTEXT.md`, `skills/imm-brainstorm/SKILL.md`, `skills/imm-planner/SKILL.md`, `tests/test_skill_contracts.py`

### Step 2
- Step ID: U2
- Result: Planner plus QA plus executor skills carry verification quality annotations with prototype step handling so that manual-only verification is flagged as debt
- Verification: `skills/imm-planner/SKILL.md` contains verification_type annotation documentation with values automated and hitl and manual; `skills/imm-planner/SKILL.md` contains prototype step flag documentation; `skills/imm-qa/SKILL.md` Workflow Rules contains a verification quality check that flags manual verification as technical debt; `skills/imm-executor/SKILL.md` Workflow Rules contains prototype step handling that skips test-first and captures the answer; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers planner verification_type text; Covers planner prototype flag text; Covers QA verification quality check text; Covers executor prototype step handling text; Covers no regression on existing contract tests
- Depends on: none
- Scope: `skills/imm-planner/SKILL.md`, `skills/imm-qa/SKILL.md`, `skills/imm-executor/SKILL.md`, `tests/test_skill_contracts.py`

### Step 3
- Step ID: U3
- Result: imm-work carries fast-track mode plus HANDOFF.md auto-update so that small plans compress ceremony while cross-session state stays human-readable
- Verification: `skills/imm-work/SKILL.md` Workflow Rules contains a fast-track rule specifying plans with two or fewer steps with automated verification can compress plan-execute-QA within a single interaction; `skills/imm-work/SKILL.md` Workflow Rules contains a HANDOFF.md update rule specifying auto-update after QA pass with plan progress and next step and blockers; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers imm-work fast-track text; Covers imm-work HANDOFF.md update text; Covers no regression on existing contract tests
- Depends on: none
- Scope: `skills/imm-work/SKILL.md`, `tests/test_skill_contracts.py`

### Step 4
- Step ID: U4
- Result: Compounder plus brainstorm skills carry rejected-decision recording with lightweight ADR suggestions so that previously rejected approaches stay durably captured
- Verification: `skills/imm-compounder/SKILL.md` Workflow Rules contains a rejected decision rule specifying docs/solutions/ entries with rejected true frontmatter tag; `skills/imm-compounder/SKILL.md` Workflow Rules contains an ADR suggestion rule with the three-criteria trigger gate and docs/adr/ target; `skills/imm-brainstorm/SKILL.md` Workflow Rules contains a rejected decision scan rule referencing docs/solutions/ rejected entries; `python3 -m unittest tests.test_skill_contracts` exits zero
- Test scenarios: Covers compounder rejected decision text; Covers compounder ADR suggestion text; Covers brainstorm rejected decision scan text; Covers no regression on existing contract tests
- Depends on: none
- Scope: `skills/imm-compounder/SKILL.md`, `skills/imm-brainstorm/SKILL.md`, `tests/test_skill_contracts.py`

## Notes
- All four steps are independent and can proceed in any order
- Each step touches only skill text and contract tests; no Python tooling changes required
- CONTEXT.md is created during step 1 execution with initial Immune-Brain domain terms
- docs/adr/ directory is referenced in compounder text but created lazily on first ADR write
- HANDOFF.md is a convenience artifact; .imm/memory/ remains source of truth
