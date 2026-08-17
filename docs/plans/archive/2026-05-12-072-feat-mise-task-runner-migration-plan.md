---
title: "feat: mise task-runner migration"
type: feat
status: active
date: 2026-05-12
origin: imm-brainstorm framing — use mise to manage environment/tools/tasks; remove Makefile; doc refs unified to mise run
---

# Iteration Plan

## Task
- Summary: Replace the root Makefile with mise.toml covering all existing targets plus README install variants then sweep all in-repo make references to mise run equivalents
- Origin: brainstorm confirmed scope — mise as sole primary entry; enable-dev-insights added as 8th task; README doc refs unified
- Research: Makefile has 7 phony targets (test; legacy-installer; legacy-installer-copy; unlegacy-installer; check-install; list-skills; heal). README references --enable-dev-insights variant not in Makefile (becomes 8th task). In-repo make refs outside upstreams: README.md 5 lines; docs/solutions/ 4 files (advisory-roundtable-layer; imm-workspace-pollution-migration-path; imm-workspace-pollution-control-pattern; live-install-list-source-of-truth); .imm/specs/legacy-installer-copy-default.spec.md line 13; .imm/memory/MEMORY.md line 138. No mise.toml or .tool-versions present at repo root.
- Decisions: D1 mise.toml at repo root (project-scoped); D2 tasks call underlying shell commands directly; D3 README retains a brief bare-shell escape-hatch table but primary narrative uses mise run; D4 Python version pinning skipped
- Assumptions: contributors can install mise or fall back to the escape-hatch shell commands
- Scope Mode: Hold Scope
- Engineering Closure Check:
  - architecture_surface: mise.toml (new); Makefile (deleted); README.md; docs/solutions/ (4 files); .imm/specs/legacy-installer-copy-default.spec.md; .imm/memory/MEMORY.md
  - dependencies_known: true
  - verification_path:
      - target: mise tasks lists 8 tasks; python3 -m unittest discover -s tests exits zero; Makefile absent; rg make-target refs returns no matches outside upstreams
      - method: mise tasks; python3 -m unittest discover -s tests; ls Makefile (should fail); rg with git ls-files scope
  - blockers: none
  - replan_condition: if mise task runner behavior diverges from script behavior in a way that breaks existing tests

## Steps

### Step 1
- Step ID: U1
- Result: Root `mise.toml` is present with all developer workflow tasks mapped from the prior Makefile plus README variants
- Verification: `mise tasks` lists all 8 task names (test; legacy-installer; legacy-installer-copy; unlegacy-installer; check-install; list-skills; heal; enable-dev-insights); `python3 -m unittest discover -s tests` exits zero
- Test scenarios: mise tasks output includes test; mise tasks output includes legacy-installer; mise tasks output includes enable-dev-insights; mise run test exits zero with passing suite
- Depends on: none

### Step 2
- Step ID: U2
- Result: The root Makefile is absent from the repository with all in-repo documentation updated to reference `mise run` as the primary task entry
- Verification: `ls Makefile` exits non-zero; `git grep -nE 'make[[:space:]]+(test|legacy-installer|list-skills|heal|uninstall|check-install)' -- ':(exclude)upstreams' ':(exclude).imm/memory/current_iteration.json'` exits 1 with empty stdout
- Test scenarios: Makefile absent from repo root; README primary workflow section uses mise run forms; docs/solutions make-target references replaced; .imm/specs/legacy-installer-copy-default.spec.md line 13 replaced; .imm/memory/MEMORY.md make reference replaced
- Depends on: 1
