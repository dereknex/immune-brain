---
title: "feat: automate plugin version management"
type: feat
status: planned
date: 2026-05-22
origin: imm-planner direct request
---

# Iteration Plan

## Task
- Summary: Add a repo-local release automation flow for the Immune-Brain plugin package so host manifests stay aligned and release owners can bump, validate, tag, push, and publish through guarded phases.
- Origin: User requested an `imm-planner` plan for plugin version management automation after confirming the current project keeps plugin versions manually in host manifests.
- Spec: docs/specs/archive/plugin-version-management-automation.spec.md
- Research: CONTEXT.md defines Plan, Spec, Step, and State Ledger as the planning vocabulary. README documents the plugin-first package under `plugins/immune-brain/` and host adapters for Codex, Claude Code, and Cursor. The current version source is the three host `plugin.json` manifests. `mise.toml` exposes `check-plugin`, which validates JSON and the runtime adapter but does not check version consistency. `scripts/sync-to-public.sh` copies whitelisted plugin-first files and should stay a file-copy step.
- Decisions: D1 use the three host manifests as the release version source of truth for this slice. D2 keep `skills/registry.yaml version: 1` as schema version only. D3 add guarded local release automation without introducing GitHub Actions. D4 make public release sync consume already-versioned files instead of rewriting versions. D5 use `immune-brain-vX.Y.Z` as the canonical release tag shape. D6 split release into plan, bump, validate, tag, push, and publish phases. D7 make marketplace publishing adapter-based because this repo has marketplace metadata but no concrete remote marketplace API.
- Assumptions: The first target plugin is `plugins/immune-brain`. Python standard library is sufficient for JSON parsing and SemVer comparison. Git operations are local CLI phases with dry-run support. Marketplace publishing needs explicit adapter configuration before a real publish can be marked complete.

## Steps

### Step 1
- Step ID: U1
- Result: Plugin version contract is documented
- Verification: `rg -n "immune-brain-vX.Y.Z|skills/registry.yaml.*schema|version source of truth" README.md docs/specs/archive/plugin-version-management-automation.spec.md` finds the documented contract
- Test scenarios: version source of truth names the three host manifests; registry schema version is not treated as release version; tag format is documented; public sync remains pre-versioned copy
- Discovery cache: README.md (plugin package and check-plugin docs); docs/specs/archive/plugin-version-management-automation.spec.md (acceptance criteria); plugins/immune-brain/.codex-plugin/plugin.json (host manifest version); plugins/immune-brain/.claude-plugin/plugin.json (host manifest version); plugins/immune-brain/.cursor-plugin/plugin.json (host manifest version)
- failure_behavior: If README becomes too noisy, put detailed release procedure in `docs/reference/` and keep README as a short pointer.
- security_considerations: Documentation must not imply automatic network publishing or credential use.
- Depends on: None

### Step 2
- Step ID: U2
- Result: Version bump command updates host manifests
- Verification: `python3 -m unittest tests.test_plugin_versioning` exits zero
- Test scenarios: patch bump updates all host manifests; minor and major bumps compute expected targets; explicit SemVer target is accepted; invalid SemVer is rejected; decreasing version requires force; dry-run reports changes without writing files
- Discovery cache: scripts/ (repo-local automation scripts); plugins/immune-brain/.codex-plugin/plugin.json (Codex manifest); plugins/immune-brain/.claude-plugin/plugin.json (Claude manifest); plugins/immune-brain/.cursor-plugin/plugin.json (Cursor manifest); tests/ (unit test location)
- Execution note: test-first
- failure_behavior: If a reusable script API is clearer than a CLI-only script, expose pure functions for tests and keep CLI parsing thin.
- security_considerations: The command must only edit repo-local manifest files and must not invoke git, network, or shell commands.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Plugin validation catches version drift
- Verification: `mise run check-plugin` fails on a fixture mismatch in unit coverage and passes for aligned manifests
- Test scenarios: aligned manifests pass; mismatched Codex manifest fails; mismatched Claude manifest fails; mismatched Cursor manifest fails; supplied tag value must match manifest version; malformed JSON remains a clear validation error
- Discovery cache: mise.toml (check-plugin task); plugins/immune-brain/tests/test_plugin_package.py (plugin package regression surface); scripts/ (version validation entrypoint); tests/ (focused version tests)
- Execution note: test-first
- failure_behavior: If `mise run check-plugin` should stay short, wire it to a small validator script and keep deeper scenarios in unit tests.
- security_considerations: Validation must be local and read-only.
- Depends on: 2

### Step 4
- Step ID: U4
- Result: Release tag phase is guarded
- Verification: `python3 -m unittest tests.test_plugin_versioning tests.test_plugin_release_flow` exits zero
- Test scenarios: dry-run release shows canonical tag; tag creation is blocked before validation; existing tag is detected before mutation; tag version must match manifests; annotated tag command is deterministic
- Discovery cache: scripts/ (release flow command); tests/ (release flow tests); docs/specs/archive/plugin-version-management-automation.spec.md (tag requirements); README.md (release procedure)
- Execution note: test-first
- failure_behavior: If git command execution is risky in tests, keep command construction pure and run tests against fake command runners.
- security_considerations: Tag automation must not push or publish as a side effect.
- Depends on: 3

### Step 5
- Step ID: U5
- Result: Release push phase is guarded
- Verification: `python3 -m unittest tests.test_plugin_release_flow` exits zero
- Test scenarios: dry-run shows branch and remote; push requires a created or existing matching tag; branch push and tag push are separate visible commands; failed branch push blocks tag push; duplicate pushed refs produce idempotent status
- Discovery cache: scripts/ (release flow command); tests/ (fake git runner coverage); docs/specs/archive/plugin-version-management-automation.spec.md (push requirements)
- Execution note: test-first
- failure_behavior: If remote detection is ambiguous, require `--remote` and stop with a clear message instead of guessing.
- security_considerations: Push automation must never run without an explicit apply flag.
- Depends on: 4

### Step 6
- Step ID: U6
- Result: Marketplace publish phase uses explicit adapter
- Verification: `python3 -m unittest tests.test_plugin_release_flow` exits zero
- Test scenarios: dry-run shows artifact path and adapter name; missing adapter reports blocked publish; command adapter receives version, tag, manifest path, and artifact path; adapter failure blocks release completion; duplicate marketplace version returns idempotent status when adapter reports already published
- Discovery cache: scripts/sync-to-public.sh (public artifact copy behavior); .agents/plugins/marketplace.json (local marketplace metadata); plugins/immune-brain/.codex-plugin/plugin.json (publish manifest metadata); tests/ (adapter tests)
- Execution note: test-first
- failure_behavior: If marketplace API remains unknown, ship the dry-run and command adapter only, and document real marketplace adapter setup as follow-up.
- security_considerations: Marketplace credentials must come from environment or external config and must not be stored in repo files.
- Depends on: 5

### Step 7
- Step ID: U7
- Result: Release automation path is repeatable
- Verification: `python3 -m unittest tests.test_plugin_versioning tests.test_plugin_release_flow && python3 -m unittest discover -s plugins/immune-brain/tests` exits zero
- Test scenarios: dry-run release output is human-readable; applied release keeps manifests aligned; tag check accepts `immune-brain-vX.Y.Z`; public release sync contract is documented as consuming already-versioned files; rollback procedure covers local bump, pushed tag, and marketplace publish
- Discovery cache: scripts/sync-to-public.sh (public artifact copy behavior); README.md (release procedure); docs/specs/archive/plugin-version-management-automation.spec.md (non-goals); plugins/immune-brain/tests/test_plugin_package.py (existing plugin package tests)
- failure_behavior: If importing plugin package tests by dotted module is awkward because of the hyphenated path, keep the final verification as the existing unittest discovery command plus the focused versioning and release flow tests.
- security_considerations: Release preparation must not create tags, push branches, or publish artifacts automatically.
- Depends on: 6
