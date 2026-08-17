# Iteration Plan

## Task

- Summary: Define the formal contract for per-phase human acceptance criteria in Immune-Brain Roadmaps. Clarify the acceptance criteria / promotion criteria relationship, L1/L2 validation boundaries, and dual-track verification model. Produce an example Roadmap that validates the format is usable.
- Origin: `imm-brainstorm` analysis of the `agent-skills` repository identified a gap: Roadmap phases carry `promotion_criteria` but no structured `acceptance_criteria` that developers can verify without reading implementation code. The brainstorming session produced a 4-phase roadmap (see Roadmap source below); this Plan covers Phase 1 only.
- Spec: docs/specs/roadmap-human-acceptance-gating.spec.md
- Research: `CONTEXT.md` defines Roadmap, Plan, Spec, Brainstorm, and Skill vocabulary but has no entries for `acceptance_criteria` or `promotion_criteria`. `plugins/immune-brain/dist/imm-planner.md` (lines 15, 47) defines Roadmap separation and deferred phase continuation with promotion criteria but does not mention structured acceptance criteria. `docs/reference/planning-quality-gate.md` (lines 23-24) checks roadmap information preservation and acceptance scope discipline but does not check acceptance criteria completeness. `docs/specs/roadmap-executable-slice-contract.spec.md` defines acceptance scope discipline (R5: "draft acceptance notes for deferred phases must be labeled non-executable") — we extend this by making acceptance notes structured and human-verifiable rather than free-form. `docs/brainstorms/` contains prior brainstorm documents; the example Roadmap will live here. `docs/reference/immune-brain-config.md` covers plugin configuration but does not define roadmap acceptance format. `tests/test_skill_contracts.py` and `tests/test_imm_plan.py` are the contract and parser test surfaces; Phase 1 does not touch them (deferred to Phases 2-3).
- Decisions: D1 acceptance_criteria and promotion_criteria are independent but related fields. D2 dual-track verification: `observable` (visual/interactive) and `verifiable` (command output). D3 human signoff is document convention only (no runtime/State Ledger integration). D4 L1 = error (missing/empty field), L2 = warning (non-behavioral pattern match). D5 the example Roadmap lives in `docs/brainstorms/` to avoid creating a new directory.
- Assumptions: The Spec format (Requirements / Non-Goals / Roadmap / Acceptance Criteria) is the canonical structure for Immune-Brain feature Specs. `CONTEXT.md` is the authority for canonical term definitions. No runtime, State Ledger, MCP, or test surface changes are needed in Phase 1. The example Roadmap can be a real or synthetic multi-phase scenario; exact domain is not critical as long as the format is exercised.
- Scope Mode: Hold Scope — Phase 1 only; Phases 2-4 are deferred.

## Output Language

- Human-readable prose: English for Spec and Plan documents
- Preserved literals: file paths, skill names, `CONTEXT.md` canonical terms, field names (`acceptance_criteria`, `promotion_criteria`), verification mode values (`observable`, `verifiable`)

## Roadmap Source

- **Roadmap Spec**: `docs/specs/roadmap-human-acceptance-gating.spec.md` (this Spec defines the full 4-phase roadmap)
- **Execution scope**: Phase 1 only — Define the acceptance criteria contract, clarify concept relationships, and create an example Roadmap
- **Deferred phases**: Phase 2 (Planner integration), Phase 3 (Validation enforcement), Phase 4 (Promotion preservation)
- **Note**: This Plan is not the full roadmap implementation. It covers Phase 1. Phases 2-4 are deferred with preserved acceptance criteria, promotion criteria, and candidate next Plans.

## Brainstorm Manifest

| ID | Item |
|----|------|
| BR-REQ-001 | Define formal structure for per-phase human acceptance criteria in Roadmaps |
| BR-REQ-002 | Clarify acceptance_criteria vs promotion_criteria relationship (independent) |
| BR-REQ-003 | Define L1 (error) and L2 (warning) validation depth boundaries |
| BR-REQ-004 | Define dual-track verification model (observable + verifiable) |
| BR-REQ-005 | Choose document convention over runtime integration for human signoff |
| BR-REQ-006 | Create an example Roadmap that validates the format is usable |
| BR-REQ-007 | Add acceptance_criteria and promotion_criteria to CONTEXT.md canonical terms |
| BR-DEC-001 | 4-phase roadmap (vs 3 or 5) |
| BR-DEC-002 | Phase 1 first, Phases 2-4 deferred |
| BR-DEC-003 | No runtime/State Ledger/MCP changes in any phase |
| BR-DEC-004 | Compound extraction is post-phase, not a roadmap phase |
| BR-OUT-001 | Do not enforce acceptance criteria on single-phase or 2-phase work |
| BR-OUT-002 | Do not add LLM-based semantic validation (L3) |
| BR-OUT-003 | Do not change existing promotion_criteria field semantics beyond clarification |
| BR-Q-001 | Accepted dual-track verification (observable + verifiable) — user confirmed |
| BR-Q-002 | Accepted 4-phase structure — user confirmed |
| BR-Q-003 | Accepted Phase 1 first — user confirmed |

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | Spec defines per-phase acceptance_criteria structure, format rules, and behavioral assertion requirements |
| BR-REQ-002 | covered_by_step | U1 | Spec clarifies acceptance_criteria and promotion_criteria are independent but related fields |
| BR-REQ-003 | covered_by_step | U1 | Spec defines L1 error (missing/empty) and L2 warning (non-behavioral pattern) validation boundaries |
| BR-REQ-004 | covered_by_step | U1 | Spec defines observable and verifiable verification modes |
| BR-REQ-005 | covered_by_step | U1 | Spec states document convention; non-goals explicitly exclude runtime integration |
| BR-REQ-006 | covered_by_step | U1 | Example Roadmap in docs/brainstorms/ validates the format with 2+ phases |
| BR-REQ-007 | covered_by_step | U1 | CONTEXT.md updated with acceptance_criteria and promotion_criteria canonical terms |
| BR-DEC-001 | captured_as_decision | D1 | 4-phase roadmap chosen; Spec defines all 4 phases with acceptance and promotion criteria |
| BR-DEC-002 | captured_as_decision | Scope | Phase 1 is the executable slice; Phases 2-4 are deferred in the Spec's roadmap |
| BR-DEC-003 | captured_as_decision | D3 | Non-goals section confirms no runtime/State Ledger/MCP changes |
| BR-DEC-004 | captured_as_decision | Scope | Compound extraction is not a roadmap phase; it happens post-close via imm-compounder |
| BR-OUT-001 | out_of_scope | Scope | Single/2-phase work enforcement is explicitly excluded from R3 |
| BR-OUT-002 | out_of_scope | Scope | L3 semantic validation is listed as a non-goal |
| BR-OUT-003 | out_of_scope | Scope | Existing promotion_criteria semantics are preserved; only clarified |
| BR-Q-001 | resolved_as_assumption | Assumptions | User confirmed dual-track; encoded in R5 |
| BR-Q-002 | resolved_as_assumption | D1 | User confirmed 4 phases; encoded in the Spec's roadmap |
| BR-Q-003 | resolved_as_assumption | Scope | User confirmed Phase 1 first; this Plan covers Phase 1 only |

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: The Spec defines acceptance criteria format requirements that are later found unusable by Phase 2 planner integration.
- Recovery: Phase 2 discovery can feed back into a Spec revision before implementation. Since Phase 1 only touches Spec + CONTEXT.md + example Roadmap, any format change is a simple file edit with no runtime impact.
- Risk: CONTEXT.md term additions conflict with existing Roadmap/Plan/Step definitions.
- Recovery: `acceptance_criteria` and `promotion_criteria` are new terms that nest under the existing Roadmap definition. Revert is a single-line removal per term.

### 2. Verification Vanity

- Risk: "Human reads Spec and confirms format is clear" is subjective and cannot fail meaningfully.
- Mitigation: The example Roadmap provides a concrete anchor. If the format is unclear, the example Roadmap will expose it — missing fields, ambiguous criteria, or unverifiable assertions. The verification is: "Can a developer independently judge whether each phase's acceptance criteria are met, using only the criteria text?" This is a yes/no question, not a vibe check.
- Risk: The Spec could pass human review with vague acceptance criteria examples that don't actually constrain Phase 2-4 implementations.
- Mitigation: The example Roadmap must use a concrete domain (not meta-references to "acceptance criteria" itself). Each criteria entry must name a specific observable behavior.

### 3. Spec Dilution Detection

- Risk: The brainstorm's 4-phase roadmap could be compressed into the Spec without preserving deferred phase details.
- Mitigation: The Spec §5 explicitly enumerates all 4 phases with individual acceptance_criteria, promotion_criteria, and deferred sections. Phase 2-4 details are not summarized into labels.
- Risk: The brainstorm's concerns about L1/L2 boundaries and dual-track verification could be hand-waved rather than precisely defined.
- Mitigation: The Spec §3 (R4, R5) defines precise validation levels and verification modes. The brainstorm's BR-REQ-003 and BR-REQ-004 are mapped with concrete Spec sections.
- Risk: "No runtime changes" could silently creep into Phase 2-4.
- Mitigation: Non-goals §4 explicitly and repeatedly blocks runtime/State Ledger/MCP changes. The deferred phase acceptance criteria for Phase 3 note that only `plan_runtime.py` validation logic is touched (not workflow runtime).

## Planning Quality Gate

- contract surface: `docs/specs/roadmap-human-acceptance-gating.spec.md` (this Spec), `CONTEXT.md` (canonical term registry), `docs/brainstorms/` (example Roadmap). No runtime, skill contract, template, or test surfaces are touched in Phase 1.
- compatibility: Existing Roadmap documents remain valid because `acceptance_criteria` is an additive optional field. Existing `promotion_criteria` semantics are unchanged. Existing Plans, Specs, State Ledger files, and skill contracts require no migration.
- interruption recovery: If Phase 1 is interrupted mid-execution, the Spec file and CONTEXT.md edits are atomic file writes that can be completed independently. The example Roadmap can be created after the Spec without dependency on Spec completeness.
- rollback path: Revert `docs/specs/roadmap-human-acceptance-gating.spec.md`, CONTEXT.md term additions, and the example Roadmap file. No other files are affected.
- verification strength: Phase 1 verification is primarily human review (hitl). The example Roadmap provides a concrete test: if the format cannot be filled for a real scenario, the contract is insufficient.
- Brainstorm traceability: Every BR-* item from the brainstorm manifest is mapped in the Brainstorm Trace above. No unmapped items.

## Steps

### Step 1

- Step ID: U1
- Result: Roadmap acceptance criteria contract is defined
- Scope: `docs/specs/roadmap-human-acceptance-gating.spec.md` (the Spec defining the full contract and 4-phase roadmap), `CONTEXT.md` (add `acceptance_criteria` and `promotion_criteria` canonical terms), `docs/brainstorms/` (new example Roadmap document exercising the format with 2+ phases)
- Discovery cache: docs/specs/roadmap-executable-slice-contract.spec.md (existing Roadmap/executable slice contract); CONTEXT.md (canonical term registry — needs new entries); docs/brainstorms/imm-brainstorm-template-short.md (example of brainstorm document format in this directory); plugins/immune-brain/dist/imm-planner.md (current planner contract — confirms no acceptance_criteria rule exists yet); docs/reference/planning-quality-gate.md (current quality gate checklist — confirms no acceptance criteria completeness check exists)
- Verification: Human review — read the Spec and example Roadmap, confirm (a) acceptance_criteria format is clear, (b) acceptance vs promotion relationship is unambiguous, (c) L1/L2 boundaries are precise, (d) the example Roadmap demonstrates the format is fillable and verifiable, (e) CONTEXT.md terms are distinct and correct. The example Roadmap at docs/brainstorms/ serves as concrete validation that the contract format is usable.
- Verification type: hitl
- failure_behavior: If the human reviewer finds the format unclear or the example Roadmap exposes gaps, revise the Spec and example before closing the step. Do not proceed to Phase 2 planning until Phase 1 passes human review.
- security_considerations: No security-sensitive behavior. The example Roadmap must not contain real credentials, secrets, or production environment details.
- Depends on: none

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-27-001-feat-roadmap-human-acceptance-gating-phase1-plan.md --json`
- Planned verification: Human review of Spec + example Roadmap + CONTEXT.md terms (hitl)

## Notes

- This is Phase 1 of a 4-phase roadmap. Phases 2-4 are deferred in the Spec.
- After Phase 1 closure, the next action is `imm-planner` to create Phase 2's executable Plan (using the Phase 1 contract as input).
- `imm-compounder` extracts patterns after each phase closure, not as a roadmap phase.
- The example Roadmap should use a concrete, non-meta domain so the format is tested on real-world phase descriptions.
