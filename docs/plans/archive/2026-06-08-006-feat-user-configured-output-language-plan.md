---
title: "feat(output): honor configured language in persisted docs"
type: feat
status: proposed
date: 2026-06-08
origin: imm-brainstorm framing - user confirmed persisted document language support is in scope
---

# Iteration Plan

## Task

- Summary: Define a project-level Output Language Policy so Immune-Brain honors user-configured language in replies and newly persisted human-readable workflow documents while preserving machine contracts.
- Spec: docs/specs/archive/user-configured-output-language.spec.md
- Origin: User asked how to design Immune-Brain support for user-set language output documents, then confirmed persisted document language is also in scope.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-REQ-004; BR-DEC-001; BR-OUT-001; BR-DEFER-001
- Research: `CONTEXT.md` defines canonical workflow terms such as Step, Plan, Spec, Skill, Brainstorm, Executor, QA, Compounder, Learning, ADR, and State Ledger. `README.md` section 3.1 defines the default user-facing output contract and says the repo standardizes information density rather than exact wording. `docs/solutions/output-artifact-enum-to-plain-language.md` rejects renaming internal enum values to fix user-facing output. `docs/solutions/all-skills-natural-output-contract.md` says output artifacts remain traceability contracts rather than default user templates. `plugins/immune-brain/skills/imm-init/templates/AGENTS.md` already carries project-level workflow instructions and is the lowest-friction place for an editable language policy placeholder.
- Decisions: D1 treat configured language as a user-facing prose policy rather than a runtime schema feature. D2 put the project-level default in `AGENTS.md` or equivalent project instructions, with optional host or user-level config guidance below current-turn user instruction. D3 keep machine fields, enum values, CLI JSON, file paths, tool names, and code identifiers untranslated. D4 preserve canonical `CONTEXT.md` terms and allow local-language explanation around them. D5 do not migrate historical documents in this slice.
- Assumptions: The initial policy can be documentation and contract-test driven because no runtime parser currently consumes a language preference. Current-turn user language instructions should override stored defaults.
- Scope Mode: New narrow docs and contract slice.
- Planner research dispatch: solo; this is a small docs and skill-contract slice with sufficient local evidence.

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | The policy defines default language behavior for replies and persisted prose. |
| BR-REQ-002 | covered_by_step | U1 | The policy names Brainstorm, Spec, Plan, Learning, HANDOFF, and skill summaries as covered persisted prose. |
| BR-REQ-003 | covered_by_step | U1 | The contract keeps schema, enum, CLI JSON, State Ledger, paths, tools, and code identifiers untranslated. |
| BR-REQ-004 | covered_by_step | U1 | Canonical CONTEXT terms stay stable with optional local-language explanation. |
| BR-DEC-001 | covered_by_step | U1 | Project instructions become the preferred language policy surface, with config guidance as optional fallback. |
| BR-OUT-001 | captured_as_decision | D5 | Historical document migration is explicitly excluded from this slice. |
| BR-DEFER-001 | deferred | Future Plan | Full multilingual synchronization, translation QA, and historical bulk conversion remain separate future work. |

## Devil's Advocate Audit

1. **Rollback Resilience**: This slice should touch only repo-facing docs, skill contract text, the `imm-init` language-policy placeholder, focused contract tests, this Spec, and this Plan. Reverting those files restores previous behavior without runtime state repair.
2. **Verification Vanity**: A weak check would only search for the phrase Output Language Policy. Verification must assert the important semantics: persisted prose follows the configured language, machine contracts remain untranslated, and current-turn instructions override stored defaults.
3. **Spec Dilution Detection**: The user explicitly expanded scope to persisted documents. The Plan covers persistent human-readable workflow prose and excludes only historical migration, multilingual sync, and runtime translation machinery.

## Planning Quality Gate

- contract surface: `README.md`, `docs/reference/immune-brain-config.md`, `skills/BASELINE.md`, `plugins/immune-brain/skills/BASELINE.md`, `plugins/immune-brain/BASELINE.md`, `plugins/immune-brain/skills/imm-init/templates/AGENTS.md`, `plugins/immune-brain/dist/skills/imm-init/templates/AGENTS.md` if present, `plugins/immune-brain/dist/*` role guidance as needed, `tests/test_skill_contracts.py`, `tests/test_imm_init.py`, this Spec, and this Plan.
- compatibility: Additive documentation and template guidance only. Existing projects and State Ledger files require no migration.
- interruption recovery: If execution stops after updating repo docs but before template or packaged copies, focused contract tests should expose the drift. The workflow can rerun the same Step after resyncing the Plan.
- rollback path: Revert docs, baseline or skill guidance, template updates, focused tests, Spec, and Plan together. No `.imm/memory/current_iteration.json` surgery is required beyond normal plan sync.
- verification strength: Use focused unittest contract assertions plus `imm-plan --json`; avoid relying on manual reading only.
- Brainstorm traceability: Every `BR-*` item from the brainstorm handoff is mapped above, with the deferred item carrying a future-work reason.

## Steps

### Step 1

- Step ID: U1
- Result: Output Language Policy is documented as a user-facing prose contract
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_imm_init && python3 .imm/imm-plan.py docs/plans/2026-06-08-006-feat-user-configured-output-language-plan.md --json`
- Verification type: automated
- Test scenarios: README describes the language policy near the default output contract; config guidance names language preference as optional and lower precedence than current user instruction and project instruction; BASELINE guidance applies configured language to replies and persisted human-readable workflow documents; imm-init AGENTS template contains an editable Output Language Policy placeholder; tests reject wording that suggests machine schema, enum, CLI JSON, State Ledger keys, file paths, tool names, or code identifiers should be translated; packaged plugin copies remain aligned where touched.
- Discovery cache: README.md (default user output contract); docs/reference/immune-brain-config.md (optional user-level preference guidance); skills/BASELINE.md (shared skill posture); plugins/immune-brain/skills/BASELINE.md (packaged skill source baseline); plugins/immune-brain/BASELINE.md (plugin package baseline copy); skills/imm-init/templates/AGENTS.md (project instruction template); plugins/immune-brain/skills/imm-init/templates/AGENTS.md (plugin source template); tests/test_skill_contracts.py (contract assertions); tests/test_imm_init.py (bootstrap template assertions); docs/solutions/output-artifact-enum-to-plain-language.md (machine-code preservation pattern); docs/solutions/all-skills-natural-output-contract.md (natural output baseline); docs/specs/archive/user-configured-output-language.spec.md (accepted behavior)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If contract tests reveal generated package drift that cannot be fixed by updating mirrored docs and templates, stop and replan a packaging-sync-specific slice.
- security_considerations: The policy must not cause agents to translate secrets, paths, identifiers, or machine-readable state in a way that changes behavior or leaks extra context.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-08-006-feat-user-configured-output-language-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-08-006-feat-user-configured-output-language-plan.md --sync`

## Notes

- The implementation Step may update multiple documentation and test files, but the closable result is a single language-policy contract.
- After validation and runtime sync, continue through `imm-work` for Step 1.
