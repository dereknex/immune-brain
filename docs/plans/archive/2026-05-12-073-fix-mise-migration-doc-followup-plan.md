---
title: "fix: mise migration documentation follow-up"
type: fix
status: active
date: 2026-05-12
origin: imm-code-review direct_fix — residual `make` install examples in first-party docs and specs plus brittle grep verification narrative
---

# Iteration Plan

## Task
- Summary: Close residual Makefile install references in first-party markdown with mise-first advisory bullets
- Origin: `imm-code-review` on mise migration slice — `readme-installed-skills-sync.spec.md` and `2026-05-07-001` party plan still cited `make list-skills`; U2 verification used `grep` without `-E` so `|` was literal; optional advisory bullet narrowed too aggressively
- Research: `git grep -nE 'make[[:space:]]+(test|legacy-installer|list-skills|heal|uninstall|check-install)' -- ':(exclude)upstreams' ':(exclude).imm/memory/current_iteration.json'` currently hits `.imm/specs/readme-installed-skills-sync.spec.md` and `docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md`. `docs/plans/2026-05-12-072` line 39 documents a non-extended-regex `grep` pipeline; `.imm/memory/current_iteration.json` echoes the same substrings but is treated as runtime evidence out of scope for the doc-hygiene grep gate
- Decisions: D1 single-step closure; D2 verification excludes `upstreams/` and `.imm/memory/current_iteration.json`; D3 update `2026-05-12-072` Step 2 Verification narrative to `grep -E` when touching that line for consistency; D4 advisory layer bullet restores explicit `--list` equivalence alongside `mise run list-skills`
- Assumptions: No CI job depends on the old literal `grep '|'` pipeline text
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: `.imm/specs/readme-installed-skills-sync.spec.md`, `docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md`, `docs/plans/2026-05-12-072-feat-mise-task-runner-migration-plan.md`, `docs/solutions/advisory-roundtable-layer.md`
  - dependencies_known: true
  - verification_path:
      - target: First-party tracked sources (excluding upstreams and runtime iteration JSON) contain no `make <install-or-test-target>` substrings matching the agreed extended-regex probe
      - method: `git grep -nE 'make[[:space:]]+(test|legacy-installer|list-skills|heal|uninstall|check-install)' -- ':(exclude)upstreams' ':(exclude).imm/memory/current_iteration.json'` exits 1 with empty stdout
  - blockers: none
  - replan_condition: if product policy reintroduces Makefile as a supported entrypoint

## Steps

### Step 1
- Step ID: U1
- Result: First-party curated markdown carries no stale Makefile-install command examples outside runtime iteration JSON
- Verification type: automated
- Verification: `git grep -nE 'make[[:space:]]+(test|legacy-installer|list-skills|heal|uninstall|check-install)' -- ':(exclude)upstreams' ':(exclude).imm/memory/current_iteration.json'` exits 1 with empty stdout
- Test scenarios: readme-installed-skills-sync spec lists mise-only live list guidance; party advisory plan Verification references `mise run list-skills` or `mise run check-install`; advisory-roundtable-layer verification bullet names both `mise run list-skills` and `zsh scripts/legacy-installer.sh --list`; 072 plan Step 2 Verification documents `grep -E` semantics when that line is edited
- Depends on: none
- Scope: `.imm/specs/readme-installed-skills-sync.spec.md`, `docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md`, `docs/plans/2026-05-12-072-feat-mise-task-runner-migration-plan.md`, `docs/solutions/advisory-roundtable-layer.md`
