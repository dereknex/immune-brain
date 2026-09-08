# Spec: Proportionate Autonomy

**Task ID**: `proportionate-autonomy`
**Owner**: user
**Status**: Candidate
**Design risk**: Medium
**Design risk rationale**: Changes instruction-level discretion and clarification policy across project guidance and two public Skills without changing runtime authority.
**Diagram decision**: not_required
**Diagram reason**: A decision table and explicit precedence describe this policy change; no state transition or data interface changes.

## Outcome

Let agents continue bounded investigation, local drafts, requested recoverable edits and ordinary local tests without repeated permission questions or mandatory repository-wide discovery. Ask about material user-owned uncertainty, not verifiable internal implementation choices. Keep approval before destructive or irreversible effects, unapproved external writes, credential or permission changes, and all mandatory host gates.

## Confirmed Decisions And Trace

The user approved the complete `Proportionate Agent Instructions` Initiative (`proportionate-agent-instructions`) and all three Slices. This is S1; S2 is independently valid, and S3 depends on S1. Recommended execution is S1, S2, S3 sequentially because of shared files. GitHub is the approved carrier. Planning and publication do not authorize implementation.

| Origin | Coverage |
| --- | --- |
| User 1: identify obsolete restrictions using original sentences | Completed audit at `docs/reports/agent-instruction-audit-2026-09-08.md`; A1/A2 replace the identified local policies, without attributing motives to older models. |
| User 2: autonomous retrieval, drafts and tests | A1/A2; bounded assumptions do not change confirmed behavior or protected authority. |
| User 3: narrow Skill triggers | S3, after this Slice settles clarification semantics. |
| User 4: task, project, then external Skill precedence | A2; within system/developer instructions, tool permissions, safety constraints and existing Managed authority. |
| User 5: clean AGENTS and change explanations | A2 applies `docs/reports/AGENTS.proposed.md` with machine-readable project preferences retained; the audit remains historical evidence. |
| User 6: reusable Skill | Already delivered globally as `agent-instruction-audit`; no duplicate in this repository. |
| Prior BR-Q-001/BR-Q-002 | Resolved by the approved decomposition: finite technical discretion is intentional; existing protected approvals remain. |
| Other global or third-party Skills | Explicitly excluded from this repository's batch; their audit recommendations remain available. |

No unresolved user decision remains.

## Discovery Evidence

- `AGENTS.md`, `IMMUNE.md` and `plugins/immune-brain/BASELINE.md` define project precedence, entry selection, completion and autonomy. The candidate AGENTS is a starting point, not a verbatim replacement that may lose the literal `Initiative carrier default: github` directive.
- `plugins/immune-brain/dist/imm-brainstorm.md` owns exhaustive clarification, repeated frontier expansion and the two-class fact/decision model. Its compact loader `plugins/immune-brain/skills/imm-brainstorm/SKILL.md` currently duplicates policy.
- `plugins/immune-brain/dist/imm-planner.md` owns decision supplements, small-scope discovery and compulsory per-Spec ceremony. Its compact loader is not a second design authority.
- `tests/exhaustive-decision-tree-contract.test.ts` locks exhaustive traversal and root AGENTS marker presence; `tests/brainstorm-decision-probing-contract.test.ts` and `tests/fixtures/imm-brainstorm-behavior-benchmark.json` encode the corresponding probing expectations.
- `tests/technical-design-conformance-contract.test.ts` and `docs/reference/planning-quality-gate.md` provide the conditional design-depth seam. Historical `tests/plan-validation.test.ts` covers the retired prose Plan validator, not a prerequisite for new TaskIntents; leave it and its runtime unchanged.
- `tests/baseline-packaging-contract.test.ts` and `tests/direct-first-routing-contract.test.ts` exercise actual instruction surfaces and host-native entry boundaries.
- `docs/solutions/grill-me-interaction-mechanics-borrow.md` contains current-facing clarification guidance and must not keep recommending the superseded default. The audit's historical `docs/reference/mattpocock-skills-contrast.md` reference no longer exists in this checkout; do not recreate it.
- `scripts/dist-sync-manifest.ts` declares Baseline's two generated copies and the planning-quality mirror. `scripts/sync-dist-docs.ts` regenerates them; owned `dist/imm-*.md` contracts are edited at source, not overwritten from loaders.

### Prior Decisions

The archived `docs/specs/archive/brainstorm-owned-exhaustive-clarification.spec.md` records explicit prior adoption of exhaustive questioning. This Slice intentionally supersedes its default interview policy following the new user approval; it does not rewrite that archive. ADR `docs/adr/0003-internal-role-prompt-routing.md` and `docs/solutions/rejected-origin-coverage-authority-expansion.md` retain read-only framing and advisory roles. Permission for local drafts does not grant Brainstorm permission to write Specs or let advisory roles mutate files.

## Technical Design

**Design views**: Instruction ownership and decision interfaces are relevant. Runtime state, data flow and temporal diagrams are omitted because no persisted interface or authority transition changes.

### Decisions

1. Separate repository facts, delegated technical choices and material user-owned decisions. Resolve the first two with bounded evidence and existing conventions. Ask only when an unresolved choice changes goals, scope, observable behavior, compatibility, risk acceptance or protected effects, or requires a fact only the user can supply.
2. Requirements, answered questions and adopted recommendations are settled decisions. Do not reopen or manufacture downstream decisions merely because a previous round finished. New evidence may reopen only its affected delta. A missing fact blocks only dependent work.
3. Preserve explicit user-selected adversarial or thorough interrogation modes when requested; do not make exhaustive interviewing the default for clear tasks. Speculative future branches remain excluded.
4. Within higher-level host constraints, explicit current-task requirements outrank applicable project AGENTS, which outranks external Skill preferences. A review-only request does not become implementation; an active Managed owner cannot be bypassed by ordinary edits.
5. Bounded read-only retrieval, permitted local drafts, requested recoverable edits and conventional local tests continue autonomously. Inspect unfamiliar test scripts before treating them as harmless. Never infer authorization for remote publication, deployments, overwriting others' work, credential exposure or mandatory native decisions from reversibility.
6. For a known file, read it and relevant callers/tests directly. Consult the Architecture Map before broad search, and relevant ADRs only when they affect the decision. Close actual callers, generated mirrors and state owners for shared/security changes; do not require every small task to scan unrelated directories.
7. Low-risk planning records outcome, scope and concrete verification without mandatory empty diagram or adversarial-audit templates. Elevated-risk work retains the design views, failure/rollback and verification reasoning that can change the outcome. Do not change schema validation, downgrade risk or weaken acceptance descriptors to achieve brevity.
8. Apply the clean project AGENTS with the literal carrier preference, language, workspace isolation and issue-tracker pointers preserved. Remove obsolete project-contract marker assertions rather than reinstalling an AGENTS schema. This does not add project-contract validation to the plugin.

9. Required verification must pass before reporting completion; disclosure of a gap is not a substitute. Select checks according to the change and established project requirements rather than making every small edit run the entire repository suite. During implementation, autonomously diagnose, repair and rerun failing conventional local checks within the authorized scope; ordinary failures do not require renewed permission or replanning. Never delete, skip or weaken valid checks to manufacture a pass. If a required check remains failing or cannot run, report the work as incomplete with the concrete blocker. Unrelated pre-existing failures do not authorize unrelated fixes. Only dependent work pauses when a repair needs a scope change, protected effect or user decision. This Initiative still requires full regression and typecheck during implementation.

The user approved this verification-and-repair supplement after initial publication. It refines A2 without changing acceptance IDs, descriptors, risk, dependencies or editable paths. When applying `docs/reports/AGENTS.proposed.md`, replace its permissive "checks executed or gaps disclosed" completion wording with this requirement; leave the historical report candidate unchanged during planning.

### Boundaries And Compatibility

Brainstorm still frames without implementation or planning-artifact writes. Planner still authors only candidates. QA/Review, Enrollment, breaking revisions, manifest-bound maintenance, stop and authorization remain unchanged. Existing manifests remain consumable and confirmed decisions stay represented. Source policy and generated mirrors are one contract; S3 may later shorten loaders without reverting these decisions.

No runtime migration, compatibility layer, new classifier, automatic Skill dispatcher or scheduling framework is introduced. Errors in assumptions return a focused correction, not silent scope expansion.

## Acceptance And Verification

| ID | Required evidence | Focused descriptor |
| --- | --- | --- |
| A1 | Brainstorm/Planner and existing fixture distinguish facts, delegated choices and material user decisions; clear requests and unchanged bulk approvals do not demand extra rounds; dependent uncertainty and protected decisions remain explicit. | `bun test tests/exhaustive-decision-tree-contract.test.ts tests/brainstorm-decision-probing-contract.test.ts` |
| A2 | Root/Baseline precedence and autonomy preserve host-native/Managed and protected-effect boundaries; targeted discovery replaces mandatory broad preflights; authorized local test failures trigger repair and rerun, required-check failure or non-execution prevents completion, and all Baseline copies agree. | `bun test tests/baseline-packaging-contract.test.ts tests/direct-first-routing-contract.test.ts` |
| A3 | Low-risk prose planning avoids empty mandatory ceremony while elevated-risk design, exact sensitive scope and focused verification remain; current reference and packaged guidance agree. | `bun test tests/technical-design-conformance-contract.test.ts tests/dist-docs-sync-contract.test.ts` |

Extend these existing contract tests to assert the new positive and negative cases, not merely remove old checks. Include a known-file typo, a local draft with an independent unknown, an already approved technical choice, a dangerous test script, an external write and an active owner as explicit instruction-contract scenarios. Also cover an in-scope local test failure followed by autonomous repair and rerun, an unavailable required check that remains incomplete, and an unrelated pre-existing failure that is disclosed without expanding the task. These tests verify shipped instructions and fixtures, not actual model obedience. No new model-evaluation framework is required. Descriptors use Bun 1.3.14, 30-second bounds and 32 KiB output limits; deterministic QA runs them after implementation. Final implementation verification also includes `bun run typecheck`, `bun test` and generated-doc checks outside acceptance descriptors.

## Scope

The canonical TaskIntent contains the exact editable sources, tests, generated copies and this Spec's active/archive paths. Discovery-only references, other Slices' artifacts, archived historical documents, runtime code and third-party Skills are not editable. The existing audit and candidate AGENTS are read-only source material.

## Devil's Advocate Audit

- **Rollback resilience**: Revert this Slice's instruction/test changes together and regenerate its mirrors; no persisted state changes. Preserve S2/S3 changes if rollback occurs later by reverting only the relevant diff. Interrupted edits are not a settled policy until focused checks pass.
- **Verification vanity**: Require both continuation examples and preserved refusal/approval boundaries. A shortened file or a passing substring assertion alone does not prove autonomy. Do not claim benchmark fixture updates are live model runs.
- **Spec dilution detection**: Do not rebrand exhaustive questioning, delete sensitive-scope closure, remove native gates, give Brainstorm write authority, or weaken the requested precedence to an optional suggestion.
