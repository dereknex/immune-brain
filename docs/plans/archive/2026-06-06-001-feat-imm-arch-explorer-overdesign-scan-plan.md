# Iteration Plan

## Task

- Summary: Add an evidence-backed Overdesign Scan to `imm-arch-explorer` so architecture exploration can find excessive abstraction as well as weak boundaries.
- Origin: User asked to consider how to discover architecture overdesign problems after a brainstorm on whether `imm-arch-explorer` needs a simplified architecture perspective.
- Spec: docs/specs/imm-arch-explorer-overdesign-scan.spec.md
- Research: `CONTEXT.md` defines Skill, Plan, Spec, ADR, Domain Mapper, and Step vocabulary. `plugins/immune-brain/dist/imm-arch-explorer.md` already requires architecture deepening, coupling evidence, ADR awareness, Best-Fit Challenge, and a simpler boring alternative for the recommended candidate. `plugins/immune-brain/dist/imm-executor.md` and `plugins/immune-brain/dist/imm-qa.md` already enforce YAGNI at execution and QA time, but `imm-arch-explorer` does not yet scan architecture candidates for overdesign before recommending deeper structure. `tests/test_skill_contracts.py` already guards the arch-explorer deepening contract.
- Decisions: D1 add Overdesign Scan as a reverse pressure inside the existing `imm-arch-explorer` flow. D2 keep this as contract and test hardening, not a runtime scanner or new skill. D3 require concrete evidence signals so the scan does not become generic anti-abstraction taste. D4 keep selected simplification work routed through `imm-planner`.
- Assumptions: The user's planner request resolves BR-Q-1 as "yes, land this in skill documentation and contract tests." The compiled skill text under `plugins/immune-brain/dist/` is the contract surface for this repo.
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-DEC-1; BR-OUT-1; BR-DEFER-1; BR-Q-1

## Brainstorm Trace

| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-1 | covered_by_step | U1 | The step makes `imm-arch-explorer` detect both weak architecture and overdesign. |
| BR-REQ-2 | covered_by_step | U1 | The step requires evidence-backed overdesign signals instead of subjective complexity complaints. |
| BR-DEC-1 | captured_as_decision | D1 | Overdesign Scan is added inside the existing architecture exploration flow. |
| BR-OUT-1 | out_of_scope | Scope | A separate simplified architecture mode or new skill is explicitly excluded. |
| BR-DEFER-1 | deferred | Future plan | Runtime scanners or metrics can be reconsidered only after contract guidance proves useful. |
| BR-Q-1 | resolved_as_assumption | Assumptions | The user invoked `imm-planner`, so the plan assumes this should land in skill docs and contract tests. |

## Devil's Advocate Audit

1. **Rollback Resilience**: This slice touches only documentation-style contract files and one focused contract test. If the wording proves noisy or misleading, revert `docs/specs/imm-arch-explorer-overdesign-scan.spec.md`, this Plan, the `imm-arch-explorer` contract edits, and the matching test assertion.
2. **Verification Vanity**: Verification must not be a bare grep. The contract test should assert the presence of the named scan, concrete signal categories, evidence-backed simplification candidate language, and read-only planner routing.
3. **Spec Dilution Detection**: The user asked how to discover overdesign. The plan preserves that as a first-class explorer behavior, while explicitly excluding automatic rewrites, a new skill, or broad runtime detection machinery.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/dist/imm-arch-explorer.md`, `plugins/immune-brain/skills/imm-arch-explorer/SKILL.md`, `tests/test_skill_contracts.py`, and `docs/specs/imm-arch-explorer-overdesign-scan.spec.md`.
- compatibility: Existing Plans, Specs, runtime state, and Domain Mapper behavior need no migration. The contract is additive.
- interruption recovery: The single Step can be retried from the listed files. No `.imm/memory/` mutation is required during execution beyond normal plan sync before work starts.
- rollback path: Revert the new spec, this Plan, the two arch-explorer skill files, and the focused test changes.
- verification strength: Use `python3 -m unittest tests.test_skill_contracts` plus `python3 .imm/imm-plan.py docs/plans/2026-06-06-001-feat-imm-arch-explorer-overdesign-scan-plan.md --json`.
- Brainstorm traceability: Every `BR-*` item from the brainstorm conclusion is mapped above.

## Steps

### Step 1

- Step ID: U1
- Result: `imm-arch-explorer` contract detects evidence-backed architecture overdesign
- Scope: `plugins/immune-brain/dist/imm-arch-explorer.md`, `plugins/immune-brain/skills/imm-arch-explorer/SKILL.md`, `tests/test_skill_contracts.py`, `docs/specs/imm-arch-explorer-overdesign-scan.spec.md`.
- Discovery cache: plugins/immune-brain/dist/imm-arch-explorer.md (compiled explorer contract); plugins/immune-brain/skills/imm-arch-explorer/SKILL.md (skill wrapper contract); tests/test_skill_contracts.py (contract regression surface); docs/specs/imm-arch-explorer-overdesign-scan.spec.md (accepted behavior)
- Verification: `python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-06-06-001-feat-imm-arch-explorer-overdesign-scan-plan.md --json`
- Verification type: automated
- Test scenarios: Covers Overdesign Scan guidance; Covers concrete overdesign signal categories; Covers evidence-backed simplification candidates; Covers read-only planner handoff remains required; Covers no new simplified architecture skill is introduced.
- failure_behavior: If the contract language makes explorers reject useful abstraction by default, narrow the wording to evidence thresholds and ADR-backed exceptions before QA.
- security_considerations: No new security-sensitive behavior; the scan should treat security and ownership isolation as valid reasons to keep complexity.
- Depends on: none

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-06-001-feat-imm-arch-explorer-overdesign-scan-plan.md --json`
- Focused contract tests: `python3 -m unittest tests.test_skill_contracts`

## Notes

- This Plan intentionally does not create a runtime overdesign scanner.
- After validation and runtime sync, continue through `imm-work` for Step 1.
