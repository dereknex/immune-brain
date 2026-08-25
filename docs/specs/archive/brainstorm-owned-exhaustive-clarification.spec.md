# Spec: Brainstorm-Owned Exhaustive Clarification

**Task ID**: `2026-08-25-002-brainstorm-owned-exhaustive-clarification`
**Owner**: user
**Status**: Candidate
**Design risk**: Medium
**Design risk rationale**: This changes the public behavior contract between two canonical Managed Skills and their packaged prompt surfaces. It does not change runtime routing, Kernel authority, persisted schemas, or implementation permissions, but an incomplete change could preserve duplicate interviews or let Planner silently decide an unresolved user choice.

**Diagram decision**: not_required
**Diagram reason**: The design is a short ownership split and dependency-aware interview loop; prose invariants and focused contract tests express it more clearly than a structural diagram.

## Summary

`imm-brainstorm` becomes the sole exhaustive user-clarification owner. It follows the `grilling` design-tree protocol across every current-goal branch grounded in the request, repository evidence, or an earlier answer, without a model-selected materiality filter. `imm-planner` consumes the closed-world Brainstorm manifest, derives technical design, and asks only focused supplements when new repository evidence exposes an omission, conflict, or invalidated assumption.

## Origin

The user compared current `imm-brainstorm` with `grill-me`, observed that the latter traverses and questions more completely, and rejected reliance on model task/risk classification before clarification. A subsequent `grill-me` session exhausted the design frontier. The user adopted the decisions below, with one explicit correction: accepting recommendations closes only the current frontier nodes and must always be followed by recomputing and traversing newly unlocked branches; it never closes the Brainstorm session by itself.

## Brainstorm Manifest

| ID | Confirmed item |
| --- | --- |
| BR-REQ-001 | Traverse every current-goal decision branch grounded in the user request, repository evidence, or an earlier answer; do not prefilter user decisions through a materiality/type judgment. |
| BR-REQ-002 | Seed the tree with goal, beneficiary/scenario, current state, desired behavior, scope/non-goals, constraints, failure/edge behavior, compatibility/migration, success/verification, and deferred items, then expand dynamically. |
| BR-REQ-003 | Classify unresolved nodes only as repository facts or user decisions; investigate facts on demand and let a blocked fact delay only dependent branches. |
| BR-REQ-004 | Ask the complete currently unlocked frontier in dependency-aware rounds; number every question, present grounded options, and provide one explicit recommendation with a short reason. |
| BR-REQ-005 | Direct requirements and adopted recommendations settle their current nodes but still unlock downstream traversal; they do not make the session complete. |
| BR-REQ-006 | Reopen only the affected decision delta when later answers or new evidence invalidate an earlier decision; minimally clarify ambiguous answers while independent branches continue. |
| BR-REQ-007 | Stop expanding an explicitly deferred branch and record it as `BR-DEFER-*`, unless it still affects the current Result, interface, or compatibility. |
| BR-REQ-008 | Complete Brainstorm only when the frontier is empty; an early stop emits unresolved `BR-Q-*` items and cannot be planning-ready. |
| BR-REQ-009 | Keep Brainstorm read-only by default and return a concise conclusion, Scope, final `BR-*` manifest, and deferred/open items without exposing the internal tree or repeating confirmed decisions. |
| BR-REQ-010 | Use the same exhaustive frontier protocol in `default`, `roundtable`, and `adversarial`; the latter two are explicit user-selected analysis lenses, not model-selected clarification routes. |
| BR-REQ-011 | Consult ADRs and rejected Learnings when a live branch makes them relevant rather than scanning every rejected Learning before the interview begins. |
| BR-REQ-012 | Planner may supplement only a newly discovered omission, repository conflict, or invalidated assumption; it asks a local decision delta directly and returns to Brainstorm only when the answer reopens multiple product branches or changes the overall goal/Scope. |
| BR-REQ-013 | Direct Planner entry remains valid for a clear request; it resolves repository facts and technical design, but returns to Brainstorm as soon as an unresolved user decision appears. |
| BR-REQ-014 | Planner owns ordinary technical choices, reference closure, Spec, TaskIntent, scope, and verification; only technical alternatives with different user behavior, compatibility, risk acceptance, or irreversible cost become user decisions. |
| BR-REQ-015 | Current documentation must describe former `imm-preplan-review` grilling behavior as migrated to `imm-brainstorm`; archived Specs and Plans remain unchanged historical evidence. |
| BR-OUT-001 | Do not explore speculative future branches that have no provenance in the current goal. |
| BR-OUT-002 | Do not automatically select `roundtable` or `adversarial` from model risk/type classification. |
| BR-OUT-003 | Do not retain a second exhaustive user interview in Planner. |
| BR-OUT-004 | Do not automatically create `docs/brainstorms/` artifacts or give Brainstorm Spec/Plan write authority. |

There are no unresolved `BR-Q-*` items.

## Brainstorm Trace

| Item | Status | Design coverage |
| --- | --- | --- |
| BR-REQ-001 through BR-REQ-008 | covered_by_acceptance | Acceptance A1 and the Brainstorm protocol invariants |
| BR-REQ-009 through BR-REQ-011 | covered_by_acceptance | Acceptance A1 and the authority/mode/history invariants |
| BR-REQ-012 through BR-REQ-014 | covered_by_acceptance | Acceptance A2 and the Planner supplement invariants |
| BR-REQ-015 | covered_by_acceptance | Acceptance A3 and current-reference cleanup |
| BR-OUT-001 through BR-OUT-004 | captured_as_decision | Out Of Scope and authority invariants |

## Research

### Reference closure

- `plugins/immune-brain/skills/imm-brainstorm/SKILL.md` and `plugins/immune-brain/dist/imm-brainstorm.md` both define the current materiality-qualified exhaustive protocol. The detailed contract additionally mandates a global rejected-decision preflight and allows a zero-question path before proving downstream traversal.
- `plugins/immune-brain/skills/imm-planner/SKILL.md` and `plugins/immune-brain/dist/imm-planner.md` duplicate the same exhaustive frontier interview for execution design. The detailed Planner already has the correct reference-closure, technical-design, Brainstorm Trace, direct-entry, and return-to-Brainstorm primitives.
- `tests/exhaustive-decision-tree-contract.test.ts` currently requires both stages to share the exhaustive protocol and explicitly requires the materiality filter. It is the highest focused seam for changing ownership without introducing another test harness.
- `tests/brainstorm-decision-probing-contract.test.ts` guards frontier ordering, recommendations, rejected-decision handling, and the retired Preplan behavior now hosted in Brainstorm. It is the focused Brainstorm seam.
- `tests/fixtures/imm-brainstorm-behavior-benchmark.json` still encodes the old clear-frame stop posture and should describe continued downstream traversal after a recommendation is adopted.
- `docs/reference/mattpocock-skills-contrast.md` and `docs/solutions/grill-me-interaction-mechanics-borrow.md` still attribute parts of the active grilling protocol to the retired `imm-preplan-review`. Current-facing text needs migration wording; archived planning artifacts remain untouched.
- `plugins/immune-brain/skills/registry.yaml` already exposes only canonical `imm-brainstorm` modes and `imm-planner`; no registry change is needed.

### Prior decisions

- ADR 0003 keeps public Brainstorm and Planner authority separate from internal advisory roles. This change preserves that separation and adds no public or internal role.
- `docs/solutions/rejected-origin-coverage-authority-expansion.md` rejects allowing Brainstorm to write Specs or Plans. The final manifest remains a read-only handoff and Planner remains the planning-artifact owner.
- The archived 2026-07-27 decision-probing Spec optimized for fewer questions and retained Preplan ownership. Its assumptions are historical and have been superseded by the user's explicit exhaustive-clarification decisions and retirement of `imm-preplan-review`; the archive itself is not rewritten.

## Technical Design

### Brainstorm protocol

1. Seed the design tree from the fixed framing roots and the user's supplied decisions.
2. Require every branch to cite provenance from the current request, repository evidence, or a settled parent node. Unsupported future branches are excluded, not scored for materiality.
3. Label each unresolved node as a repository fact or user decision. Resolve facts with bounded, on-demand read-only evidence. An unavailable fact remains blocked and delays only its dependent subtree.
4. Ask every independent user decision on the current frontier in one numbered round. Each question carries grounded options, an explicit recommendation, and a concise reason.
5. Treat direct requirements, explicit answers, and bulk adoption as settlement of only the current nodes. Recompute the tree after every response and continue with newly unlocked branches.
6. Reopen only decisions invalidated by later evidence. An explicit defer prunes its subtree unless that subtree still affects the current promised behavior or compatibility.
7. Finish only when no unresolved or blocked branch remains. The zero-question path remains legal only when the complete seeded and dynamically expanded tree contains no unresolved user decision; it is not an early classification shortcut.
8. Emit the concise final manifest without a second confirmation for unchanged decisions. Early stop emits open `BR-Q-*` items and does not route as planning-ready.

### Modes and history

`default`, `roundtable`, and `adversarial` share the protocol above. `roundtable` adds advisory perspectives and `adversarial` adds hostile risk/rollback/verification analysis only when the user explicitly selects the mode. Default framing still includes failure, compatibility, migration, and risk decisions through its fixed roots. Relevant ADR or rejected-Learning evidence is retrieved when a live branch reaches that topic; no repository-wide rejected-decision scan precedes questioning.

### Planner supplement

Planner does not build a second exhaustive user-decision tree when a Brainstorm manifest exists. It maps every `BR-*`, performs reference closure, derives technical design and verification, and preserves confirmed choices. It may ask only a focused delta tied to concrete new evidence showing an omission, conflict, or invalidated assumption. A local delta stays in Planner; a delta that reopens multiple product branches or changes the overall goal/Scope returns to Brainstorm.

Direct Planner entry remains available. A clear request may take the existing zero-question planning path after repository and technical discovery. The first unresolved user decision returns to Brainstorm; Planner does not silently choose it or reproduce the exhaustive interview.

## Invariants

- Brainstorm remains read-only and cannot write Spec, TaskIntent, Plan, runtime state, or implementation files.
- Every surfaced question has current-goal provenance; completeness does not mean speculative product expansion.
- Repository facts are not converted into user choices when evidence is unavailable.
- Accepting recommendations advances traversal rather than terminating it.
- Planner never silently drops, reopens, or contradicts a confirmed `BR-*` decision.
- Planner retains technical-design and planning-artifact authority without retaining a duplicate exhaustive user interview.
- No runtime route, Kernel schema, Skill registry entry, or public Skill is added.

## Failure And Recovery

- If prompt edits cause Brainstorm to invent unsupported future branches, the focused contract tests fail the provenance invariant and the change is corrected in place.
- If removing Planner's exhaustive section also removes direct entry, reference closure, or focused conflict handling, the ownership-split test fails and the prior contract files can be restored together.
- If current references cannot be corrected without rewriting archived evidence, leave archives unchanged and update only current reference/Learning text.
- The change has no persisted runtime migration. Reverting the four Skill contract edits, focused tests/fixture, and two current documentation updates restores prior behavior.

## Compatibility And Rollback

The public Skill names, modes, read-only/planning boundaries, `BR-*` IDs, TaskIntent schema, Kernel routing, and direct Planner entry remain compatible. Existing Brainstorm manifests remain consumable. The behavior change intentionally supersedes the materiality prefilter, mandatory rejected-Learning preflight, automatic high-risk mode selection, and Planner's duplicate exhaustive interview.

Rollback is a single prompt-contract/test/documentation revert. No compatibility layer or transitional route is introduced because there is no persisted data format to migrate.

## Scope

- `docs/specs/brainstorm-owned-exhaustive-clarification.spec.md`
- `docs/specs/archive/brainstorm-owned-exhaustive-clarification.spec.md`
- `docs/plans/2026-08-25-002-brainstorm-owned-exhaustive-clarification.intent.json`
- `docs/plans/archive/2026-08-25-002-brainstorm-owned-exhaustive-clarification.intent.json`
- `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`
- `plugins/immune-brain/dist/imm-brainstorm.md`
- `plugins/immune-brain/skills/imm-planner/SKILL.md`
- `plugins/immune-brain/dist/imm-planner.md`
- `tests/exhaustive-decision-tree-contract.test.ts`
- `tests/brainstorm-decision-probing-contract.test.ts`
- `tests/fixtures/imm-brainstorm-behavior-benchmark.json`
- `docs/reference/mattpocock-skills-contrast.md`
- `docs/solutions/grill-me-interaction-mechanics-borrow.md`

## Out Of Scope

- Runtime, Kernel, Enrollment, Assurance, TaskRecord, or routing changes;
- new Skills, aliases, registries, schemas, parsers, or compatibility layers;
- automatic Brainstorm artifact persistence;
- speculative future-product discovery unrelated to the current goal;
- rewriting archived Specs, Plans, TaskIntents, or historical task records;
- changing internal advisory Agent authority or dispatch behavior; and
- adding a second confirmation after an unchanged final Brainstorm summary.

## Acceptance

### A1: Brainstorm owns exhaustive user clarification

Both Brainstorm contract surfaces implement the provenance-bounded fixed-root design tree, fact/decision split, on-demand facts, complete dependency-aware frontier rounds, recommendation-adoption continuation, delta reopening, defer/blocked handling, explicit mode lenses, and frontier-empty completion without the prior materiality filter or mandatory global rejected-decision preflight.

### A2: Planner is a focused supplement and technical-design owner

Both Planner contract surfaces consume confirmed Brainstorm decisions without a second exhaustive interview, preserve direct clear-request entry and technical/reference-closure authority, and ask only evidence-backed omission/conflict/invalidated-assumption deltas, returning to Brainstorm when product branches reopen.

### A3: Current references and regression fixtures match the canonical ownership

Focused tests and the Brainstorm behavior fixture encode continued traversal after adopting recommendations, current documentation attributes the retired Preplan behavior to Brainstorm, archived artifacts remain untouched, and generated packaged documentation remains synchronized.

## Verification Approach

- `bun test tests/brainstorm-decision-probing-contract.test.ts`
- `bun test tests/exhaustive-decision-tree-contract.test.ts`
- `bun scripts/sync-dist-docs.ts --check`
- `git diff --check`

The two focused Bun files read the actual compact and packaged Skill contracts, so they fail when ownership, required interaction mechanics, or prohibited legacy behavior drifts. The fixture assertions keep future model evaluation aligned with the accepted continuation semantics. The sync check guards generated package documentation without introducing a new test framework.

## Devil's Advocate Audit

**Rollback resilience**: This is a prompt-contract-only behavior change with no persisted schema or authority mutation. The four Skill files, focused tests/fixture, and current documentation can be reverted together; archived evidence remains intact.

**Verification vanity**: Checking only for the phrase `exhaustive decision tree` would preserve the current duplication. The tests must assert positive Brainstorm traversal mechanics, negative materiality/preflight clauses, positive Planner supplement behavior, and absence of Planner's duplicate exhaustive interview. Static contract tests cannot prove every model follows the prompt, so the focused benchmark fixture is updated to preserve a runnable behavioral probe; deterministic QA remains bounded to repository-local tests.

**Spec dilution detection**: The implementation must not reinterpret “adopt recommendations” as session completion, retain automatic `adversarial` selection, preserve the Planner interview under another heading, or rewrite historical archives. Every accepted Brainstorm item is mapped above, and there are no unresolved questions.
