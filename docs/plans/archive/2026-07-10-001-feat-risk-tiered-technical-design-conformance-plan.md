---
title: "feat: risk-tiered technical design conformance"
type: feat
status: proposed
date: 2026-07-10
origin: user-confirmed imm-brainstorm framing
---

# Iteration Plan

## Task

- Summary: Add risk-tiered Technical Design guidance and a final QA Design Conformance gate without imposing design or Mermaid ceremony on trivial changes
- Spec: docs/specs/archive/2026-07-10-risk-tiered-technical-design-conformance.spec.md
- Origin: User confirmed the `imm-brainstorm` direction: risk-tiered Technical Design, conditional Mermaid, Spec as the design baseline, Plan references instead of duplication, and final QA deviation handling
- Brainstorm manifest: BR-REQ-1; BR-REQ-2; BR-REQ-3; BR-REQ-4; BR-REQ-5; BR-DEC-1; BR-DEC-2; BR-DEC-3; BR-OUT-1; BR-OUT-2; BR-DEFER-1
- Research: `imm-planner` already owns Spec/Plan scope, requires a Devil's Advocate Audit, and applies `docs/reference/planning-quality-gate.md` to elevated-risk workflow contracts. `imm-qa` already has a Zoom-Out Check and routes local gaps to `rework` and structural mismatch to `replan`, but neither contract defines design-risk tiers, a Technical Design baseline, conditional Mermaid criteria, or a final Spec-to-implementation conformance record. `plan_core.ts` parses only existing Step fields, so this slice can remain a documentation-contract change with no runtime/schema work. Advisory candidates agreed that Spec should stay the sole design authority and warned against risk-score matrices, mandatory diagrams, duplicated Plan design text, and QA approving design changes. The plugin-local TypeScript `imm-plan --json` currently hardcodes `origin_coverage.applicable: false`; direct `plan_core.ts` parsing confirms this Plan declares and maps all 11 manifest items with no missing reason. Fixing that pre-existing CLI output gap is outside this design-conformance slice.
- Decisions: D1 use three qualitative risk tiers, not a scoring engine; D2 keep Technical Design inside the Spec; D3 require Mermaid only for materially diagrammable medium/high-risk structure, sequence, data flow, or state; D4 make final Plan closure the mandatory Design Conformance point; D5 route any intended or structural design change through Planner and `replan`; D6 add one focused contract test plus existing dist-mirror and Plan validation checks; D7 do not alter runtime, Plan schema, State Ledger, historical Specs, or activation behavior
- Assumptions: `plugins/immune-brain/dist/*.md` is the executable full skill contract while thin `skills/*/SKILL.md` loaders need no duplicated prose; `docs/reference/planning-quality-gate.md` is mirrored through the existing dist sync contract; a focused text-contract test is sufficient because this slice changes agent workflow contracts rather than runtime behavior
- Scope Mode: New Slice
- Planner research dispatch: advisory ensemble completed with no tools; agreement supports a three-tier single-Spec design, disagreement was limited to whether all high-risk work needs Mermaid, resolved by requiring diagrams only for diagrammable multi-component flow, sequence, or state

## Output Language

- Human-readable Spec and Plan prose: English for durable planning artifacts; Chinese for user-facing replies in this workspace
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, `Spec`, `Plan`, `Step`, `Technical Design`, `Design Conformance`, `QA`, `rework`, `replan`, and `State Ledger`

## Brainstorm Manifest

| ID | Item |
|---|---|
| BR-REQ-1 | Decide Technical Design depth from change risk. |
| BR-REQ-2 | Medium/high-risk changes include Technical Design in the Spec. |
| BR-REQ-3 | Plan references design decisions and constraints without copying design prose. |
| BR-REQ-4 | Use Mermaid when complex cross-module, API, data-flow, or state-machine relationships need it. |
| BR-REQ-5 | Final QA performs Design Conformance and verifies implementation deviations from the original design baseline. |
| BR-DEC-1 | Keep the Spec as the single design baseline; do not create a standalone Technical Design document system. |
| BR-DEC-2 | Route local deviations to `rework` and structural deviations to `replan`. |
| BR-DEC-3 | A reasonable deviation must update the design baseline with a reason before it can pass. |
| BR-OUT-1 | Do not require Mermaid for every change. |
| BR-OUT-2 | Do not add full design ceremony to copy, configuration, or trivial local fixes. |
| BR-DEFER-1 | Defer machine-level Mermaid syntax or diagram/prose semantic consistency validation. |

## Brainstorm Trace

| Item | Status | Target | Reason |
|---|---|---|---|
| BR-REQ-1 | covered_by_step | U1 | U1 adds qualitative Low/Medium/High design-depth rules and focused regressions. |
| BR-REQ-2 | covered_by_step | U1 | U1 requires a Spec Technical Design baseline for medium/high-risk work. |
| BR-REQ-3 | covered_by_step | U1 | U1 makes the Spec authoritative and Plan references non-duplicating. |
| BR-REQ-4 | covered_by_step | U1 | U1 defines conditional Mermaid triggers for diagrammable relationships. |
| BR-REQ-5 | covered_by_step | U1 | U1 adds final QA Design Conformance evidence and deviation classification. |
| BR-DEC-1 | covered_by_step | U1 | U1 explicitly rejects a standalone design document layer. |
| BR-DEC-2 | covered_by_step | U1 | U1 preserves QA's local `rework` and structural `replan` routes. |
| BR-DEC-3 | covered_by_step | U1 | U1 blocks QA from approving a changed design and returns baseline updates to Planner. |
| BR-OUT-1 | covered_by_step | U1 | U1 includes negative assertions against universal Mermaid requirements. |
| BR-OUT-2 | covered_by_step | U1 | U1 exempts low-risk trivial changes from Technical Design and Mermaid ceremony. |
| BR-DEFER-1 | deferred | Later validator slice | Semantic Mermaid/prose/code validation is unnecessary until contract-only guidance proves insufficient. |

## Devil's Advocate Audit

1. **Rollback Resilience**: The executable slice changes only Planner/QA Markdown contracts, one mirrored quality-gate document, one focused Bun test, this Spec, and this Plan. No State Ledger, parser, or persisted schema changes exist. Reverting those files restores the previous workflow without migration.
2. **Verification Vanity**: String-presence checks alone could pass while allowing universal Mermaid ceremony, Plan duplication, or QA-owned design changes. The focused test must assert both positive rules and negative boundaries across Planner, QA, and quality-gate contracts; the dist mirror test and `imm-plan --json` separately guard packaging and origin coverage.
3. **Spec Dilution Detection**: All confirmed requirements and non-goals map to U1. The design intentionally narrows only the deferred machine-semantic Mermaid validator, which is preserved as `BR-DEFER-1`; it does not narrow the required final Design Conformance gate or medium/high-risk design baseline.

## Planning Quality Gate

- contract surface: `plugins/immune-brain/dist/imm-planner.md`, `plugins/immune-brain/dist/imm-qa.md`, `docs/reference/planning-quality-gate.md`, `plugins/immune-brain/dist/docs/reference/planning-quality-gate.md`, focused contract test, this Spec, and this Plan.
- compatibility: existing Specs, Plans, Plan parser fields, State Ledger files, and historical closure evidence remain valid; the guidance applies prospectively.
- interruption recovery: partial edits do not mutate runtime state. Resume compares source/dist reference parity, rereads the latest Spec and Plan, and reruns the focused contracts before handoff.
- rollback path: revert the Planner/QA contract wording, quality-gate source and mirror, focused test, Spec, and Plan together; no data rollback is needed.
- verification strength: positive/negative Bun assertions prove tiering, Mermaid conditionality, single-Spec authority, evidence mapping, and deviation routing; dist parity and Plan validation are executable independent checks.
- Brainstorm traceability: direct `plan_core.ts` parsing confirms all eleven `BR-*` items are mapped; `BR-DEFER-1` includes a concrete reason and no open `BR-Q-*` remains. The known TypeScript CLI summary bug is recorded in Research rather than misreported as coverage evidence.

## Steps

### Step 1

- Step ID: U1
- Result: Immune-Brain enforces a regression-protected risk-tiered design conformance workflow
- Verification type: automated
- Verification: `bun test tests/technical-design-conformance-contract.test.ts tests/dist-docs-sync-contract.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-001-feat-risk-tiered-technical-design-conformance-plan.md --json`
- Test scenarios: Covers Low/Medium/High design-depth classification; Covers medium/high-risk Spec Technical Design baseline; Covers no mandatory Technical Design for trivial low-risk changes; Covers conditional Mermaid for structure, sequence, data flow, or state transitions; Covers no universal Mermaid gate; Covers Spec as sole design authority and Plan references without duplication; Covers final QA Spec-to-evidence Design Conformance; Covers local mismatch `rework`; Covers structural or intended design change `replan`; Covers QA cannot approve or silently accept a changed design; Covers quality-gate source/dist parity; Covers complete Brainstorm origin coverage
- Discovery cache: plugins/immune-brain/dist/imm-planner.md (Planner design-depth and Spec authority contract); plugins/immune-brain/dist/imm-qa.md (final closure and deviation routing authority); docs/reference/planning-quality-gate.md (elevated-risk design baseline checklist); scripts/dist-sync-manifest.ts (existing packaged mirror contract); tests/dist-docs-sync-contract.test.ts (mirror regression precedent); docs/specs/archive/2026-07-10-risk-tiered-technical-design-conformance.spec.md (accepted design baseline)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If implementation requires a new Plan parser field, State Ledger state, or universal Mermaid validator, stop and return to Planner because that exceeds this contract-only slice.
- security_considerations: High-risk classification explicitly includes security and prevents QA from silently accepting security-relevant boundary deviations; this slice itself handles no secrets or permissions.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-001-feat-risk-tiered-technical-design-conformance-plan.md --json`
- Runtime sync after validation: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-10-001-feat-risk-tiered-technical-design-conformance-plan.md --sync`
- Brainstorm trace check: import `parsePlan` and `parseBrainstormManifestItems` from `plugins/immune-brain/runtime/plan_core.ts`; assert 11 declared items, 11 mapped items, no missing IDs, and no reason-required rows without a reason. This temporary check is necessary because the TypeScript CLI currently hardcodes the JSON coverage summary.

## Notes

- This is one outcome Step, not separate Planner/QA/test micro-steps: the workflow contract is not useful or independently closable until planning guidance, final QA routing, packaging parity, and regression checks agree.
- No `parallel_probes` are planned. The file surfaces are small and causally coupled, so parallel discovery would cost more than sequential execution.
