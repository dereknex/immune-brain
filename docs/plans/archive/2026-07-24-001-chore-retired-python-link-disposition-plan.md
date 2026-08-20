---
title: "chore: retire dead Python links and prune stale key_files in docs/"
type: chore
status: proposed
date: 2026-07-24
origin: imm-compounder handoff after link-fix batch (483 rewritten, 228 dead links remained); imm-advisory-reviewer docs lens recommended one-step planner routing
spec: docs/specs/archive/2026-07-24-retired-python-link-disposition.spec.md
---

# Iteration Plan

## Task

- Summary: Dispose of 228 broken markdown links to retired Python files and prune the stale `key_files` frontmatter in `docs/solutions/contracts.md`, so `docs/` has no broken `[text](url)` link to a deleted file and historical artifacts are explicitly marked with paths preserved as inline code.
- Spec: `docs/specs/archive/2026-07-24-retired-python-link-disposition.spec.md`
- Origin: `imm-compounder` handoff. The mechanical fixer (`scripts/fix-broken-links.ts`) rewrote 483 links whose targets exist; the remaining 228 point at deleted `.imm/*.py`, `tests/test_*.py`, and other retired files with no 1:1 successor. `docs/solutions/contracts.md` `key_files` frontmatter lists 70+ retired `.py` paths (TS successors already listed alongside).
- Scope Mode: New single-Step docs-hygiene slice. No runtime, test, contract, or state change.
- Planner research dispatch: none. Single-domain docs hygiene; no multi-domain or elevated-risk trigger. Solo planning.

## Output Language

- Human-readable Spec and Plan prose: English.
- User-facing replies: Chinese per project instructions.
- Preserved literals: `Plan`, `Step`, `Spec`, `Verification`, `key_files`, `Historical note`, file paths, commands, and code identifiers.

## Research

- `scripts/fix-broken-links.ts --preview docs/ plugins/immune-brain/ README.md` reports 228 dead links: 114 `tests/test_*.py`, 85 `.imm/*.py` / `.imm/imm_core/*.py`, 11 deleted files (`Makefile`, `scripts/install-local.sh`, `scripts/legacy-installer.sh`, `.mcp.json`, `imm-page-layout-design.md`), 8 nonexistent `skills/*/SKILL.md`, 10 other.
- Concentration by source: `docs/solutions/contracts.md` (104), `docs/solutions/canonical-runtime-state-paths.md` (14), `docs/solutions/architecture.md` (10), ~100 across `docs/specs/*.md`, a few in `docs/plans/*.md`.
- `docs/solutions/contracts.md` `key_files` frontmatter already lists TS successors (`plugins/immune-brain/runtime/immune_brain_runtime.ts`, `imm_core.ts`, `tests/*.test.ts`) alongside the retired `.py` entries — D1 pruning requires no mapping guesswork.
- Repo precedent: `docs/solutions/architecture.md` `Pattern: Runtime Truth Guards Before Historical Cleanup` documents that historical materials may retain old Python/MCP paths when explicitly marked `Historical note` / `Superseded current-truth pattern` / `source-only reference`.
- `detect-stale-refs.ts` residual (175 `stale_skill_ref`, 17 `broken_legacy_spec`, 16 `broken_doc_link`) are glob wildcards and inline-text references, not `[text](url)` links — out of scope for this plan.

## Decisions

- One outcome Step: docs-hygiene closure is a single closable result; the executor batches mechanical edits across files within the step. No read/edit/run micro-step split.
- D1/D2/D3 disposition (see Spec): prune stale `key_files`; rewrite or inline-code-convert active-hub dead links; banner + inline-code-convert historical docs. Paths preserved as inline code, never silently deleted.
- Verification gate is `fix-broken-links.ts --preview`, not `detect-stale-refs.ts`, because the former matches only real links and can fail on the intended regression; the latter carries pre-accepted text-pattern false-positives.

## Assumptions

- A `docs/specs/*.md` referencing `.imm/*.py` describes the Python era and is therefore historical (current specs reference TS files). If discovery finds a spec that is both current AND references `.py`, route back to planner.
- TypeScript successor files listed in `contracts.md` `key_files` are the authoritative current-truth navigation targets; no new mapping is invented.

## Devil's Advocate Audit

- Rollback resilience: Docs-only and git-recoverable. `git revert` fully restores. A misplaced `Historical note` or an over-converted link is reverted per file. No runtime/state/contract risk; failure midway leaves docs in a partial-but-honest state, recoverable by re-running `fix-broken-links.ts --preview` to find the remainder.
- Verification vanity: `fix-broken-links.ts --preview` reporting `Dead links reported: 0` genuinely fails if a dead `[text](url)` link remains — it is not a text-existence check. The secondary grep (paths still present as inline code) catches the silent-deletion failure mode. `detect-stale-refs.ts` is deliberately NOT the gate, avoiding the vanity of a check that cannot distinguish glob inline text from real links.
- Spec dilution detection: No accepted requirement silently narrowed. All 228 dead links are addressed by D1/D2/D3. The out-of-scope items (175 inline `stale_skill_ref`, glob false-positives) are explicitly declared as non-goals in the Spec, not silently dropped.

## Steps

### Step 1

- Step ID: U1
- Result: docs/ has zero broken markdown links to deleted files with historical docs banner-marked plus contracts.md key_files pruned to existing files only with retired Python paths preserved as inline code
- Verification type: automated
- Verification: `bun scripts/fix-broken-links.ts --preview docs/ plugins/immune-brain/ README.md | grep -q "Dead links reported (NOT rewritten): 0" && bun test tests/active-runtime-docs-contract.test.ts tests/python-reference-boundary.test.ts && git diff --check`
- Test scenarios: Covers a retired `.imm/imm_core/foo.py` link in `contracts.md` becoming inline code with a `Historical note` (or rewritten to the TS successor if current navigation); Covers `contracts.md` `key_files` containing no 404 entry while TS runtime/test entries remain; Covers a `docs/plans/*.md` dead `tests/test_workflow_loop.py` link gaining the banner with the path surviving as inline code; Covers `fix-broken-links.ts --preview` reporting 0 dead links and `active-runtime-docs-contract` + `python-reference-boundary` tests passing
- Discovery cache: scripts/fix-broken-links.ts (dead-link scanner, --preview/--write); scripts/detect-stale-refs.ts (secondary text-pattern detector); docs/solutions/architecture.md#Pattern: Runtime Truth Guards Before Historical Cleanup (historical-marking precedent)
- Scope: `docs/solutions/contracts.md`, `docs/solutions/canonical-runtime-state-paths.md`, `docs/solutions/architecture.md`, other `docs/solutions/*.md` with dead links, affected `docs/specs/*.md`, affected `docs/plans/*.md`, and `README.md` only. No runtime, test, or state files.
- Agent Hint: imm-executor
- Depends on: none
- Implementation batch (inside this outcome unit):
  1. D1: prune `docs/solutions/contracts.md` `key_files` — drop entries that do not resolve (`.imm/*.py`, `plugins/immune-brain/dist/.imm/*.py`, `tests/test_*.py`, `scripts/install-local.sh`); keep existing `.ts` and existing-path entries.
  2. D2: for each active solution hub with dead body links (`contracts.md`, `canonical-runtime-state-paths.md`, `architecture.md`, others surfaced by preview), rewrite to the TS successor where the link is current navigation, else convert the dead link to inline code and add `> Historical note` to the section.
  3. D3: for each `docs/plans/*.md` and `docs/specs/*.md` with dead `.py` links, add the `> Historical note:` banner after frontmatter and convert dead links to inline code.
- failure_behavior: If a dead link is missed, `fix-broken-links.ts --preview` reports it and the step is not closed; re-apply D2/D3 to the reported file. If a current spec is found referencing `.py` (invalidating the historical assumption), stop and return to planner.
- security_considerations: Docs-only; preserve repo-relative paths and do not introduce user-local absolute paths. Do not delete historical path text — convert to inline code.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-24-001-chore-retired-python-link-disposition-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-24-001-chore-retired-python-link-disposition-plan.md --sync`

## Next Action

- Gate: Plan passes `imm-plan --json` validation and `imm-plan <plan> --sync`; no step has a hypothetical-only verification path; user confirms scope (especially the out-of-scope `detect-stale-refs` inline-text residual).
- If gates pass: default to `imm-work` for single-step manual control (the user has been driving step-by-step), or `imm-loop` for the full completion loop. Confirm with user.