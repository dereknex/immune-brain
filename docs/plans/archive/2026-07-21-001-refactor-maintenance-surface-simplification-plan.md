---
title: "refactor: clarify maintenance surfaces and retire stale pattern ownership"
type: refactor
status: proposed
date: 2026-07-21
origin: user-selected architecture exploration opportunities 1 through 5
spec: docs/specs/2026-07-21-maintenance-surface-simplification.spec.md
---

# Iteration Plan

## Task

- Summary: Clarify ownership and retention across planning artifacts, host manifests, packaged docs, Skill contracts, and L2S documentation while removing only the stale active ownership of `docs/patterns/`.
- Spec: `docs/specs/2026-07-21-maintenance-surface-simplification.spec.md`
- Origin: The user selected all five `imm-arch-explorer` candidates for overall planning. Repository evidence and four advisory reviews narrowed the safe implementation to explicit ownership contracts plus one compatibility-preserving documentation migration.
- Scope Mode: New two-Step executable slice. No historical Plan/Spec bulk migration and no host/package runtime redesign.
- Planner research dispatch: planner ensemble used because the request spans historical evidence, cross-host manifests, packaged outputs, Skill discovery, and documentation ownership. Fast and mid candidates favored compatibility-preserving policy and generation boundaries; the strong candidate and `imm-preplan-review` blocked broad consolidation or deletion.

## Output Language

- Human-readable Spec and Plan prose: English.
- User-facing replies: Chinese per project instructions.
- Preserved literals: file paths, commands, code identifiers, `Plan`, `Spec`, `Step`, `Skill`, `State Ledger`, and host names.

## Planning Bootstrap

- Problem frame: Five visible duplication or accumulation signals may be intentional compatibility boundaries; simplify only where ownership ambiguity creates real maintenance cost.
- Intended behavior: Future maintainers can identify canonical sources, generated outputs, compatibility paths, and retention constraints without changing runtime or packaging behavior.
- Scope boundaries: Documentation, architecture decisions, and existing contract verification only.
- Success criteria: All five candidates receive an explicit keep, constrain, or migrate decision; the only migrated surface keeps its old path resolvable.
- Blocking questions: none. Existing repository evidence is sufficient to preserve uncertain external contracts and avoid destructive migration.

## Research

- `CONTEXT.md`, `IMMUNE.md`, and `README.md` define Plans and Specs as workflow evidence but do not provide archival eligibility rules.
- The repository currently has 233 files under `docs/plans/` and 230 under `docs/specs/`; current docs, tests, and historical artifacts contain path references.
- Codex, Claude, Cursor, OpenCode, and the root package have different manifest shapes. `scripts/plugin_versioning.ts` already validates and updates all version-bearing files, while `plugins/immune-brain/tests/host-manifest-consistency.test.ts` verifies cross-host version consistency.
- `scripts/dist-sync-manifest.ts`, `scripts/sync-dist-docs.ts`, and `tests/dist-docs-sync-contract.test.ts` classify packaged docs, generate adapted copies deterministically, and fail closed on missing or duplicated replacement fragments.
- Existing tests read both `plugins/immune-brain/skills/*/SKILL.md` and `plugins/immune-brain/dist/*.md`; the two paths have different discovery and detailed-instruction responsibilities.
- `README.md` states that durable learning belongs in `docs/solutions/`, but `docs/patterns/l2s-workflow.md` still contains full current guidance and `docs/solutions/workflow.md` links to it as evidence.
- Existing ADR review found no decision that authorizes collapsing manifests, checked-in `dist/`, or the two-level Skill contract.

## Advisory Synthesis

- Agreement: Do not bulk-delete historical Plans/Specs, normalize host schemas, untrack packaged `dist/`, merge Skill surfaces, or break the existing L2S path.
- Agreement: Use prospective retention rules and preserve current package/runtime contracts.
- Disagreement: One advisor proposed five migration Steps; the strong review found that steps for candidates 2 through 4 would be ceremonial because the existing boundaries already satisfy the intended contracts.
- Planner decision: Record candidates 1 through 4 as explicit architecture and retention decisions in U1, then perform only the evidence-backed L2S ownership migration in U2.
- Strong-model blockers promoted to requirements: host-native loading, deterministic adapted docs, dual Skill visibility, and live/historical links must remain verifiable.

## Decisions

- D1: Treat Plan and Spec history as durable by default. A future cleanup may move or delete only paths proven independent of current docs, tests, packaging, State Ledger data, and support/release workflows.
- D2: Keep all host manifests native. `scripts/plugin_versioning.ts` remains the shared version mutation boundary; no canonical manifest schema is added.
- D3: Keep checked-in `dist/` as packaged runtime output and repository docs as authoring sources. Existing deterministic sync remains the ownership mechanism.
- D4: Keep `skills/*/SKILL.md` and `dist/*.md` separate because host discovery and detailed runtime instructions are distinct contracts.
- D5: Make `docs/solutions/workflow.md` the single active L2S guidance and retain `docs/patterns/l2s-workflow.md` as a compatibility pointer.
- D6: Use two Steps rather than one Step per candidate; no-change architecture decisions do not justify ceremonial implementation Steps.

## Assumptions

- Existing host manifest and package runtime tests are the strongest locally available evidence; no supported host-specific schema validator is installed in this repository.
- Historical Plan and Spec links are evidence and need not be rewritten when the active canonical documentation changes.
- `docs/solutions/workflow.md` is the accepted long-lived home for active workflow guidance under current README policy.
- Documentation-only ownership changes do not require State Ledger schema migration or generated package changes.

## Devil's Advocate Audit

1. **Rollback Resilience**: U1 changes only repository policy and architecture documents; reverting those files restores the prior ambiguity without touching runtime state. U2 changes the canonical solution text and the legacy pattern file together; restoring both files fully rolls back the migration. No Step deletes historical evidence, modifies manifests, or rewrites generated output.
2. **Verification Vanity**: Text existence alone would not prove preserved contracts. U1 runs version validation, deterministic dist drift checking, host manifest tests, Skill registry/contract tests, planner ensemble tests, and package runtime tests. U2 uses executable content assertions to prove one complete canonical guide and one compatibility pointer, then scans current non-historical docs for stale authoritative references.
3. **Spec Dilution Detection**: All five selected candidates receive explicit decisions. Candidate 1 becomes a prospective retention contract rather than an unsafe bulk migration; candidates 2 through 4 are intentionally preserved with evidence; candidate 5 receives the only physical simplification. These choices are explicit constraints, not requirements silently dropped due to implementation cost.

## Planning Quality Gate

- contract surface: `CONTEXT.md`, the new retention reference, the new ADR, `docs/solutions/workflow.md`, `docs/patterns/l2s-workflow.md`, host manifests, `scripts/plugin_versioning.ts`, `scripts/dist-sync-manifest.ts`, `scripts/sync-dist-docs.ts`, Skill entry files, packaged Skill contracts, focused tests, this Spec, and this Plan.
- compatibility: Existing Plan/Spec paths, native host manifest schemas, checked-in packaged files, Skill discovery paths, and the legacy L2S path remain available.
- interruption recovery: U1 and U2 are independently closable. If interrupted, restore or complete only the active Step files and rerun its verification; no generated or persisted state repair is required.
- rollback path: Revert the U1 policy/ADR files or the U2 solution/pattern pair. Do not revert unrelated historical docs, manifests, runtime files, or package output.
- verification strength: Existing behavioral and packaging contract tests, manifest version validation, deterministic dist drift checks, executable documentation assertions, reference scans, Plan validation, and `git diff --check`.
- design-depth classification: High because the evaluated boundaries span multiple host packages and compiled Skill contracts, even though the accepted implementation preserves those surfaces.
- Design Conformance: QA must compare implementation with the ownership invariants and non-goals in the Spec. Any proposal to delete history, unify host schemas, untrack `dist/`, or merge Skill surfaces is structural scope change and routes to Planner.
- Brainstorm traceability: no upstream Brainstorm document or open `BR-Q-*` item exists; direct-entry Planning Bootstrap records the accepted frame and constraints.

## Steps

### Step 1

- Step ID: U1
- Result: Repository maintenance-surface ownership is explicit for architecture candidates 1 through 4
- Verification type: automated
- Verification: `bun scripts/plugin_versioning.ts validate && bun scripts/sync-dist-docs.ts --check && bun test plugins/immune-brain/tests/host-manifest-consistency.test.ts tests/dist-docs-sync-contract.test.ts tests/skill-registry-metadata-contract.test.ts tests/planner-ensemble-contract.test.ts tests/plugin-package-runtime.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-21-001-refactor-maintenance-surface-simplification-plan.md --json && git diff --check`
- Test scenarios: Covers all configured manifest versions remaining consistent; Covers deterministic packaged-doc output remaining in sync; Covers every packaged doc retaining a declared mirror or adapted classification; Covers host-discoverable Skill metadata and detailed packaged contracts remaining visible; Covers plugin-local package runtime loading; Covers retention policy prohibiting unproven bulk history movement; Covers architecture decision rejecting new manifest, dist, or Skill generation layers.
- Discovery cache: CONTEXT.md (architecture map and canonical terms); README.md (FileSystem-as-Brain and docs/solutions policy); scripts/plugin_versioning.ts (existing shared version boundary); scripts/dist-sync-manifest.ts and scripts/sync-dist-docs.ts (packaged docs ownership); plugins/immune-brain/skills/*/SKILL.md and plugins/immune-brain/dist/*.md (two-level Skill contract); docs/specs/2026-07-21-maintenance-surface-simplification.spec.md (accepted invariants)
- Scope: `CONTEXT.md`, `docs/reference/planning-artifact-retention.md`, `docs/adr/0002-maintenance-surface-ownership.md`, and only focused existing tests if an assertion is required to make the documented contract executable.
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If current tests or release scripts show that an ownership statement is false, stop and return to Planner; do not change the host, dist, or Skill contract to make the document pass.
- security_considerations: Do not inspect or expose user-local State Ledger contents; repository path/reference evidence is sufficient for this documentation Step.

### Step 2

- Step ID: U2
- Result: L2S workflow documentation resolves through one canonical solution with legacy-path compatibility
- Verification type: automated
- Verification: `bun -e 'import { readFileSync } from "node:fs"; const solution=readFileSync("docs/solutions/workflow.md","utf8"); const legacy=readFileSync("docs/patterns/l2s-workflow.md","utf8"); if (!solution.includes("imm-planner") || !solution.includes("imm-loop") || !solution.includes("State Ledger")) throw new Error("canonical L2S guidance incomplete"); if (!legacy.toLowerCase().includes("compatibility") || !legacy.includes("docs/solutions/workflow.md")) throw new Error("legacy path is not a compatibility pointer");' && ! rg -n 'docs/patterns/l2s-workflow\.md' README.md IMMUNE.md CONTEXT.md docs/reference docs/user_manual.md plugins/immune-brain/USER_GUIDE.md && bun test tests/skill-registry-metadata-contract.test.ts tests/imm-loop-review-orchestration-contract.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-07-21-001-refactor-maintenance-surface-simplification-plan.md --json && git diff --check`
- Test scenarios: Covers the canonical solution retaining planner and completion-loop guidance; Covers State Ledger continuity guidance remaining present; Covers the old pattern path resolving to a compatibility notice; Covers current non-historical docs no longer treating the pattern path as authoritative; Covers historical Plan and Spec evidence remaining untouched; Covers Skill registry and loop orchestration contracts remaining unchanged.
- Discovery cache: docs/solutions/workflow.md (current durable workflow guidance); docs/patterns/l2s-workflow.md (legacy full copy and compatibility path); README.md (no-new-patterns policy); historical docs/plans references (evidence paths intentionally preserved); docs/specs/2026-07-21-maintenance-surface-simplification.spec.md (R5 and compatibility invariant)
- Scope: `docs/solutions/workflow.md`, `docs/patterns/l2s-workflow.md`, and current non-historical documentation only when it directly treats the legacy path as authoritative. Do not edit historical Plans or Specs.
- Agent Hint: imm-executor
- Depends on: U1
- failure_behavior: If a current runtime, package, or host consumer requires the full legacy file body rather than path resolution, stop and return to Planner instead of duplicating the guide again.
- security_considerations: Documentation-only change; preserve links and avoid embedding user-local paths or State Ledger contents.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-21-001-refactor-maintenance-surface-simplification-plan.md --json`
- Runtime sync: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-21-001-refactor-maintenance-surface-simplification-plan.md --sync`

## Notes

- Candidate 1 is constrained prospectively; this Plan intentionally does not perform a 463-file archive migration.
- Candidates 2 through 4 are resolved as documented architecture boundaries because existing code and tests already implement the safest shared contracts.
- Candidate 5 is the only physical simplification in this slice.
- No new dependency, generator, registry, archive command, compatibility layer, or test file is planned.
- Execution begins through `imm-loop`; Planner does not edit implementation files or issue QA closure.
