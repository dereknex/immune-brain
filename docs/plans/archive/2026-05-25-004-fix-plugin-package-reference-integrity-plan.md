---
title: "fix: enforce plugin package reference integrity"
type: fix
status: proposed
date: 2026-05-25
---

# Iteration Plan

## Task
- Summary: Make packaged `immune-brain` skill references resolvable after installation and add a regression gate for future package-reference drift.
- Origin: User-requested installation analysis found missing packaged reference files and invalid `dist/*.md` links, including the `imm-ui-review` dependency on `docs/reference/ux-heuristic-checklist.md`.
- Spec: docs/specs/archive/plugin-package-reference-integrity.spec.md
- Research: `plugins/immune-brain/dist/*.md` contains the packaged skill bodies. `plugins/immune-brain/dist/docs/reference/` is the plugin-local reference bundle. `plugins/immune-brain/skills/*/SKILL.md` are thin shims that load `../../dist/*.md`. `tests/test_immune_brain_plugin_package.py` is the correct package contract test surface, while `tests/test_skill_contracts.py` already covers skill text contracts.
- Decisions:
    - D1: Treat `docs/reference/*` references in packaged skill bodies as plugin-local package dependencies when they describe installed local reference material.
    - D2: Keep target-project paths such as `.imm/memory/*`, `docs/plans/*`, and generated artifacts out of package completeness checks.
    - D3: Fix bad Markdown links in `dist/*.md` rather than relying on agents to infer source-tree paths after installation.
    - D4: Add package-level regression coverage so missing local references fail before release or installation.
- Assumptions:
    - The package should remain lightweight and should not include the full `docs/` tree.
    - Reference files already present in repository `docs/reference/` are the source of truth for the missing plugin-local copies.
    - Runtime CLI behavior is already functional and should not be changed by this slice.
- Scope Mode: Two-step package integrity repair
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/dist/*.md`, `plugins/immune-brain/dist/docs/reference/`, `tests/test_immune_brain_plugin_package.py`
  - dependencies_known: yes
  - verification_path: focused package-reference integrity test plus existing skill contract tests
  - blockers: none
  - replan_condition: If the package manifest or installer resolves plugin-local paths differently from the filesystem layout currently installed under `.codex/plugins/cache`.
- Devil's Advocate Audit:
  - rollback_resilience: The repair is limited to packaged docs and package tests; rollback removes copied reference files, link rewrites, and the new regression test without touching runtime behavior.
  - verification_vanity: The new test must resolve paths in a copied or package-root context, not merely assert that source repository files exist.
  - spec_dilution_detection: The plan covers both observed failure classes: missing reference files and links that become invalid after plugin installation.

## Steps

### Step 1
- Step ID: U1
- Result: Packaged skill references resolve inside the plugin
- Verification type: automated
- Verification: `python3 -c 'from pathlib import Path; root = Path("plugins/immune-brain"); required = ["dist/docs/reference/ux-heuristic-checklist.md", "dist/docs/reference/agent-quality-checklists.md", "dist/docs/reference/code-simplification-checklist.md", "dist/docs/reference/HANDOFF-template.md", "dist/docs/reference/compaction-handoff-hosts.md"]; missing = [path for path in required if not (root / path).exists()]; assert not missing, missing; offenders = [str(path) for path in root.glob("dist/*.md") if "../BASELINE.md" in path.read_text(encoding="utf-8") or "../../../../docs/reference/" in path.read_text(encoding="utf-8")]; assert not offenders, offenders'`
- Test scenarios: Confirm `imm-ui-review`, `imm-code-review`, and `imm-work` can refer to their local checklist or handoff files from the packaged plugin layout; confirm source-tree-only Markdown paths are no longer present in packaged skill bodies.
- Discovery cache: plugins/immune-brain/dist/imm-ui-review.md (UX checklist references); plugins/immune-brain/dist/imm-code-review.md (quality and simplification checklist references); plugins/immune-brain/dist/imm-work.md (handoff reference links); docs/reference/ (source reference files)
- Agent Hint: imm-executor
- failure_behavior: If copying every referenced `docs/reference/*` file makes the package too broad, record the excluded file and change the skill text so it no longer claims the file is installed local reference material.
- security_considerations: Reference packaging must not include private local state or `.imm/memory/*` artifacts.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Package reference drift fails automated tests
- Verification type: automated
- Execution note: test-first
- Verification: `python3 -m unittest tests.test_immune_brain_plugin_package tests.test_skill_contracts`
- Test scenarios: Add a focused package test that scans packaged skill bodies for local Markdown links and `docs/reference/*` references, resolves them against `plugins/immune-brain`, and excludes only documented target-project runtime paths.
- Discovery cache: tests/test_immune_brain_plugin_package.py (package-level regression tests); tests/test_skill_contracts.py (existing skill text contract coverage); plugins/immune-brain/skills/registry.yaml (installed skill inventory)
- Agent Hint: imm-executor
- failure_behavior: If the scanner produces false positives for target-project paths, narrow the allowlist with explicit path prefixes and keep package-local references strict.
- security_considerations: The test must not traverse user home plugin caches or depend on machine-specific installed paths.
- Depends on: 1

## Notes
- Validate this plan with `imm-plan --json`, then sync it explicitly before execution.
