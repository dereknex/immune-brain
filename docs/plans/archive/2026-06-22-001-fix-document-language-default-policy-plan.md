---
title: "fix: separate reply language from document language"
type: fix
status: proposed
date: 2026-06-22
origin: imm-brainstorm framing - document language default regression
---

# Iteration Plan

## Task

- Summary: Restore English as the default language for generated persisted Immune-Brain documents unless document language is explicit.
- Spec: docs/specs/archive/document-language-default-policy.spec.md
- Origin: User reported that generated documents should default to English and that an `AGENTS.md` instruction to reply in Chinese was incorrectly expanded into document language.
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-DEC-001; BR-OUT-001; BR-OUT-002; BR-DEFER-001
- Research: Current README, baseline files, config docs, `imm-planner`, templates, `imm-init` templates, `imm-plan` warning tests, and the contracts Learning encode the old conflated behavior. `CONTEXT.md` identifies Plan validation and Skill contracts as the relevant surfaces. The previous loop-engineering Plan is closed, so this is a new slice rather than an append.
- Decisions: D1 Persisted Immune-Brain documents default to English. D2 `AGENTS.md` reply-language guidance affects conversation replies unless it explicitly names persisted documents. D3 This slice supersedes the old output-language Spec for document defaults. D4 Runtime schema remains unchanged.
- Assumptions: The existing mirrored package tests can guard packaged copy alignment for touched surfaces. The stale contracts Learning should be superseded by a later compounder pass rather than rewritten during planner or executor work.
- Scope Mode: Hold Scope
- Planner research dispatch: solo; the task is a bounded contract and validator slice with direct local evidence.

## Output Language

- Human-readable prose: English for new Spec and Plan documents; Chinese for user-facing replies in this workspace
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Manifest

| ID | Item |
|----|------|
| BR-REQ-001 | Generated persisted documents default to English. |
| BR-REQ-002 | Document language changes only when explicitly specified. |
| BR-DEC-001 | `AGENTS.md` default Chinese reply guidance affects replies only, not persisted document language. |
| BR-OUT-001 | Do not rewrite historical docs. |
| BR-OUT-002 | Do not change runtime schema. |
| BR-DEFER-001 | Optional independent `document_language` config remains deferred. |

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | U1 updates the durable contract and templates to state the English default. |
| BR-REQ-002 | covered_by_step | U1 | U1 documents the explicit-document-language requirement across user-facing guidance. |
| BR-DEC-001 | covered_by_step | U2 | U2 updates validator behavior so reply-only Chinese policy does not warn on English docs. |
| BR-OUT-001 | out_of_scope | D3 | Historical document rewrites are excluded from this slice. |
| BR-OUT-002 | captured_as_decision | D4 | The Plan keeps State Ledger, Plan, and MCP schemas unchanged. |
| BR-DEFER-001 | deferred | D4 | Independent `document_language` config can be promoted by a future Plan after this contract is stable. |

## Devil's Advocate Audit

1. **Rollback Resilience**: The fix is limited to docs, templates, contract tests, and existing language-warning logic. If a step fails midway, reverting the touched files restores the previous behavior without state migration.
2. **Verification Vanity**: Text-only assertions would be weak if they only prove that "English" appears. Verification must demonstrate both negative and positive cases: Chinese reply-only `AGENTS.md` accepts English Plan and Spec prose, while explicit Chinese document-language policy still produces a warning for English docs.
3. **Spec Dilution Detection**: The user asked to separate reply language from document language, not merely to tweak wording. U2 is required because docs-only changes would leave `imm-plan` enforcing the obsolete conflation.

## Planning Quality Gate

- contract surface: `README.md`, `skills/BASELINE.md`, `plugins/immune-brain/skills/BASELINE.md`, `plugins/immune-brain/BASELINE.md`, `docs/reference/immune-brain-config.md`, packaged config docs, `plugins/immune-brain/dist/imm-planner.md`, `.imm/templates/iteration-plan-template.md`, packaged Plan template, `skills/imm-init/templates/AGENTS.md`, packaged `imm-init` template, `.imm/imm_core/plan_runtime.py`, packaged runtime copy, and focused tests.
- compatibility: Existing reply-language preferences still affect conversation replies. Existing explicit document-language policies remain supported. Existing runtime state and schemas require no migration.
- interruption recovery: If execution stops, rerunning the focused tests and `imm-plan --json` identifies which contract surface remains old. The current State Ledger can continue from the synced Step metadata.
- rollback path: Revert the new Spec, this Plan, touched docs/templates/runtime warning logic, and focused tests as one coherent slice.
- verification strength: Use focused unit tests for contract wording, `imm-init` templates, `imm-plan` language policy behavior, packaged parity, Python compilation, and Plan validation.
- Brainstorm traceability: Every `BR-*` item from the brainstorm manifest is mapped in `Brainstorm Trace`.

## Steps

### Step 1

- Step ID: U1
- Result: Document language contract is corrected
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_output_language_policy_is_documented tests.test_skill_contracts.SkillContractTests.test_planner_output_language_gate_is_local_contract tests.test_imm_init.ImmInitTests && python3 .imm/imm-plan.py docs/plans/2026-06-22-001-fix-document-language-default-policy-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers English default for persisted documents; Covers reply-only `AGENTS.md` scope; Covers explicit document-language override wording; Covers machine contract preservation; Covers mirrored template and packaged guidance surfaces.
- Discovery cache: docs/specs/archive/document-language-default-policy.spec.md (accepted behavior); README.md (main Output Language Policy); skills/BASELINE.md (shared Skill baseline); plugins/immune-brain/BASELINE.md (plugin baseline); plugins/immune-brain/skills/BASELINE.md (plugin Skill baseline); docs/reference/immune-brain-config.md (config guidance); plugins/immune-brain/dist/imm-planner.md (planner gate); .imm/templates/iteration-plan-template.md (Plan template); skills/imm-init/templates/AGENTS.md (bootstrap project instructions); tests/test_skill_contracts.py (contract regression tests); tests/test_imm_init.py (bootstrap template tests)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If wording changes imply a new runtime field or config schema, stop and return to planner because that violates `BR-OUT-002`.
- security_considerations: No secret or auth surface is involved; the main risk is durable docs being written in an unintended language.

### Step 2

- Step ID: U2
- Result: Language warning policy is corrected
- Verification type: automated
- Verification: `python3 -m unittest tests.test_imm_plan.ImmPlanTests.test_output_language_summary_ignores_reply_only_chinese_policy tests.test_imm_plan.ImmPlanTests.test_output_language_summary_warns_for_explicit_chinese_document_policy tests.test_imm_plan.ImmPlanTests.test_main_json_omits_output_language_for_reply_only_chinese_policy tests.test_immune_brain_plugin_package.PluginPackageTest.test_packaged_runtime_matches_repo_runtime_sources && python3 -m py_compile .imm/imm-plan.py .imm/imm_core/plan_runtime.py plugins/immune-brain/dist/.imm/imm-plan.py plugins/immune-brain/dist/.imm/imm_core/plan_runtime.py && python3 .imm/imm-plan.py docs/plans/2026-06-22-001-fix-document-language-default-policy-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers no warning for English Plan under Chinese reply-only `AGENTS.md`; Covers warning for English docs under explicit Chinese document policy; Covers JSON output omission when no document-language policy applies; Covers packaged runtime parity.
- Discovery cache: .imm/imm_core/plan_runtime.py (language policy detection); plugins/immune-brain/dist/.imm/imm_core/plan_runtime.py (packaged runtime copy); tests/test_imm_plan.py (validator behavior tests); tests/test_immune_brain_plugin_package.py (package parity tests)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: If the detector cannot reliably distinguish reply-only and document-language policy with bounded patterns, keep the behavior conservative and require explicit document-language wording rather than inferring from generic output language text.
- security_considerations: The validator must not read broad unrelated files or expose local config content in JSON output.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-22-001-fix-document-language-default-policy-plan.md --json`
- Runtime sync: MCP `imm_plan_validate(sync=true)`

## Notes

- The old `docs/specs/archive/user-configured-output-language.spec.md` is superseded only for persisted document defaults; do not rewrite it in this Plan unless implementation needs a clear deprecation note.
- The old `docs/solutions/contracts.md` Learning should be superseded after closure by `imm-compounder`, not edited inside this planner slice.
- After validation and sync, continue through `imm-work` before any executor edits.
