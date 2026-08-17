---
title: feat: addy agent-skills upstream submodule and hub skill anatomy hardening
type: feat
status: planned
date: 2026-05-10
origin: user request for full improvement pass after preplan — submodule + contrast doc + BASELINE/skill hardening + routing + references + tests
---

# Iteration Plan

## Task

- Summary: Add **addyosmani/agent-skills** as `upstreams/addy-agent-skills`, publish an internal **contrast matrix** under `docs/reference/`, extend **skill anatomy** (Rationalizations / Red Flags / Verification) via **BASELINE** (or linked anatomy doc), apply it to **imm-work**, **imm-executor**, **imm-planner**, **imm-qa**, add a compact **inbound routing table**, introduce at least one **reference checklist** linked from review skills, and lock everything with **contract tests** plus **imm-plan** validation.
- Origin: `/imm-preplan-review` locked submodule + team contrast checklist; user then asked for **全面改进** incorporating brainstormed recommendations (anti-rationalization, verification templates, overlap matrix, submodule policy, progressive disclosure).
- Research: Reviewed `.gitmodules`, `README.md` upstreams section, `skills/BASELINE.md`, hub skills (`imm-work`, `imm-executor`, `imm-planner`, `imm-qa`), `tests/test_skill_contracts.py`, `.imm/imm-upstream-sync.py`, and addy README skill anatomy. Conclusion: submodule pattern is established; greatest leverage is **hub skill hardening** + **single contrast doc** without importing duplicate lifecycle skills.
- Decisions: D1 submodule path **`upstreams/addy-agent-skills`**; D2 contrast doc **`docs/reference/addy-agent-skills-contrast.md`**; D3 anatomy rules live primarily in **`skills/BASELINE.md`** with optional **`skills/SKILL-ANATOMY.md`** only if BASELINE becomes too long; D4 **four hub skills** must carry all three sections; D5 routing table in **`README.md`** unless length forces **`imm-brainstorm`**—prefer README for discoverability; D6 checklist is **thin local index + links** into submodule references to avoid dual maintenance; D7 extend **contract tests** with stable headings/phrases, preserving existing README/workflow substring contracts.
- Assumptions: MIT upstream is reference-only; no need to vendor hooks or Claude slash commands in this iteration.

## Steps

### Step 1

- Step ID: U1
- Result: **addy-agent-skills** submodule integration matches README upstream enumeration plus maintenance policy text.
- Verification: `.gitmodules` contains `[submodule "upstreams/addy-agent-skills"]` with path `upstreams/addy-agent-skills` and HTTPS URL; `git submodule update --init upstreams/addy-agent-skills` succeeds; `README.md` enumerates the new path and mentions submodule init + optional **`python3 .imm/imm-upstream-sync.py`** where accurate.
- Agent Hint: imm-executor
- Test scenarios: Covers spec §3 submodule + README bullets
- Depends on: none

### Step 2

- Step ID: U2
- Result: Internal **contrast / overlap** artifact exists under `docs/reference/`.
- Verification: `docs/reference/addy-agent-skills-contrast.md` includes skill inventory mapping, **overlap matrix** with authoritative source column, **borrow taxonomy** (structure / excerpt / do-not-import), and submodule update policy summary consistent with U1.
- Agent Hint: imm-executor
- Test scenarios: Covers spec §2.2
- Depends on: 1

### Step 3

- Step ID: U3
- Result: **BASELINE** documents anatomy for Rationalizations Red Flags Verification while **imm-work** **imm-executor** **imm-planner** **imm-qa** each ship matching sections tied to Immune-Brain evidence paths.
- Verification: `skills/BASELINE.md` (or BASELINE + `skills/SKILL-ANATOMY.md`) defines the three sections and names **imm-work**, **imm-executor**, **imm-planner**, **imm-qa** as mandatory carriers; each of those four `SKILL.md` files contains explicitly titled sections **Rationalizations**, **Red Flags**, and **Verification** with content grounded in this repo (e.g. `imm-work record-execution`, `imm-review`, `.imm` state), not generic upstream-only commands.
- Agent Hint: imm-executor
- Test scenarios: Covers spec §2.3
- Depends on: 2

### Step 4

- Step ID: U4
- Result: **Inbound routing table** ships beside a **docs/reference** checklist that **imm-code-review** (plus **imm-ui-review** when scoped) links for progressive disclosure.
- Verification: Routing table (≤20 lines) appears in `README.md` or `skills/imm-brainstorm/SKILL.md` and does not contradict `imm-work` / IMMUNE; new checklist file exists under `docs/reference/`; `skills/imm-code-review/SKILL.md` references it (plus `imm-ui-review` if checklist covers UI/a11y scope).
- Agent Hint: imm-executor
- Test scenarios: Covers spec §2.4
- Depends on: 3

### Step 5

- Step ID: U5
- Result: **Regression locks** via extended **test_skill_contracts** coverage plus green **imm-plan.py --json** validation for this plan path.
- Verification: `tests/test_skill_contracts.py` asserts anatomy phrases and/or section titles for BASELINE and the four hub skills; `python3 -m unittest tests.test_skill_contracts` passes; `python3 .imm/imm-plan.py docs/plans/2026-05-10-051-feat-addy-upstream-skill-anatomy-plan.md --json` exits successfully.
- Agent Hint: imm-executor
- Test scenarios: Covers spec §2.5 and §3 full checklist
- Depends on: 4

## Notes

- Keep **outcome granularity**: each step may contain multiple file edits/commits internally; do not split U3 across artificial micro-steps unless a blocker appears (e.g. validator rejects markdown structure).
- When editing `README.md`, **preserve** existing substrings required by `tests/test_skill_contracts.py` (including any concatenated surface from `docs/reference/workflow-and-subagents.md`); adjust tests in U5 if copy must change materially.
- If `git submodule add` is blocked in a given environment, record blocker and fall back to documenting manual steps in U2 — prefer resolving environment over scope cut unless user confirms.

## Next Action

Use **`imm-work`** with this plan path as the validated runtime plan: activate **U1**, execute via **`imm-executor`**, close with **`imm-qa`**, then proceed sequentially through U2–U5.
