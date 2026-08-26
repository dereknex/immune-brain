# Add `imm-doc-prune`

**Status**: Candidate
**Task**: `2026-08-26-001-add-imm-doc-prune`
**Planning entry**: Direct `imm-planner` after a user-confirmed grilling session; no Brainstorm artifact.
**Output Language**: English for persisted contracts; user-facing output follows the target repository's Output Language Policy.
**Design risk**: Medium - this adds a destructive, user-facing packaged Skill contract across discovery, registry, documentation, and test surfaces. It does not add runtime code or workflow authority, but incomplete safety wording could authorize accidental document deletion.
**Diagram decision**: not_required
**Diagram reason**: The design is one linear, stateless host-native interaction (`scan -> manifest -> approval -> revalidate -> edit/delete -> verify`) with no service topology, persisted state machine, or concurrent owner transition; the ordered contract below is clearer than a diagram.

## 1. Problem

Current documentation can continue to present retired capabilities as current guidance. A concrete failure occurred when a retired `imm-init` Skill was recommended from stale Solution content. Existing reference-closure and contract tests catch selected names and links, but they cannot reliably decide whether prose, an ADR premise, or a reusable Learning remains semantically current in an external repository.

Automatic deletion is unsafe, while leaving semantic cleanup implicit makes it easy for agents to reuse obsolete guidance. Immune-Brain needs one explicit, low-cost maintenance entry that scans the complete current documentation surface, narrows semantic review to evidence-backed candidates, and deletes only a user-approved exact manifest.

## 2. Result

The package exposes a fifth public Skill, `imm-doc-prune`, as a standalone host-native maintenance entry. It:

1. inventories tracked current documentation across the target Git repository;
2. mechanically identifies dead paths, retired public surfaces, stale local references, source/generated drift, and candidate semantic conflicts;
3. classifies each candidate using repository evidence;
4. presents one exact, hash-bound mutation manifest;
5. mutates only entries literally approved by the user and still byte-identical at execution time; and
6. verifies current documentation and generated/package consistency without creating Managed authority or persistent cleanup state.

The existing Managed Path remains entered only through `imm-brainstorm`, `imm-planner`, and `imm-loop`. `imm-pr-fix` and `imm-doc-prune` remain standalone host-native Skills.

## 3. Confirmed Decisions

The user confirmed the following closed-world decisions before Planner entry:

- Use the public name `imm-doc-prune`; invocation must be explicit.
- `imm-doc-prune audit` is read-only; ordinary `imm-doc-prune` scans and then waits for exact manifest approval.
- Scan all tracked agent-facing/current documentation rather than only `CONTEXT.md` and ADRs.
- Treat Git history as the archive for obsolete non-authority documentation; delete confirmed obsolete ADRs and Solutions instead of maintaining `retired` or `superseded` document tombstones.
- Preserve historical-by-purpose records such as changelogs, release notes, migration records, and incident reports.
- Never delete active/frozen Specs, TaskIntents, TaskRecords, tombstones, or other `.imm` authority.
- Allow historical immutable authority references to deleted non-authority documents as explicitly reported `HISTORICAL_GIT_ONLY` references.
- Require exact evidence, Git recoverability, candidate-clean status, one user approval, and pre-mutation hash/ownership revalidation.
- Do not add a daemon, cron job, CI installation, runtime checker, cache, persistent report, automatic commit, or project allowlist in the first version.

## 4. Technical Design

### 4.1 Selected design views

- **Component/interface view: selected.** The source shim, packaged Skill contract, registry, generated registry/README role map, public documentation, and focused tests form the shipped interface.
- **Data-flow view: selected.** Repository facts become candidates, candidates become a manifest, literal approval and byte revalidation authorize a bounded mutation, and verification produces the terminal report.
- **State-transition view: omitted.** The Skill writes no durable workflow state; its only interaction phases are local to one invocation and are fully defined by the ordered protocol.
- **Temporal-sequence view: omitted as a separate diagram.** Ordering is safety-critical but linear and is stated normatively in Section 4.3.

### 4.2 Public and authority boundaries

`plugins/immune-brain/skills/imm-doc-prune/SKILL.md` is a compact loader for the self-owned packaged contract at `plugins/immune-brain/dist/imm-doc-prune.md`. Registry metadata uses existing vocabulary (`role: execute`, `role_class: repair`) and produces `prune_report`; no new role enum or runtime dispatcher is introduced.

The Skill is standalone host-native. It must not create, update, enroll, resume, freeze, settle, or infer any Spec, Plan, TaskIntent, TaskRecord, Assurance projection, attestation, finding, claim, or Compounder state. It may use the resolved read-only routing-status surface to identify an active Managed owner. Read-only audit remains available, but a candidate overlapping an active TaskIntent `scope_hint` is `BLOCKED_ACTIVE_SCOPE`; an unreadable owner or scope fails closed for mutation.

### 4.3 Ordered pruning protocol

1. **Establish repository safety.** Require a Git worktree for mutation. A non-Git repository or untracked candidate is audit-only. Record the candidate path, blob/content hash, tracked status, and candidate-local worktree status. Unrelated dirty files do not block the run; a dirty candidate is `BLOCKED`.
2. **Inventory current documentation.** Enumerate tracked `.md`, `.mdx`, `.rst`, and `.adoc` files, agent instruction files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`, plus referenced `.json`, `.yaml`, and `.yml` files under documentation directories. Exclude dependencies, vendor trees, build output, caches, arbitrary business data, and source comments from semantic scanning.
3. **Classify document roles.** Distinguish current guidance, generated/mirror content, Kernel authority artifacts, historical-by-purpose records, non-authority archives, and `UNCLASSIFIED` groups. Do not modernize historical narration merely because it describes old behavior.
4. **Build repository facts.** Resolve current truth in this order: executable/public registries, package exports, CLI/runtime entrypoints; behavior tests; active Spec/TaskIntent; current `CONTEXT.md`/ADR/reference/README; Solution/Brainstorm/archive. A lower-priority historical statement cannot prove a retired public surface is current.
5. **Mechanically narrow candidates.** Check local paths and anchors, public Skill/CLI/API names, command/import targets without executing arbitrary examples, inbound local references, source/generated declarations, translations with explicit source mappings, ADR/Solution owners, and conflicting current claims. External URLs are not probed in v1.
6. **Apply evidence rules.** Age or zero references alone never proves staleness. ADR deletion requires a removed decision object, an implemented mutually exclusive replacement with current constraints preserved, a retired public surface, or a successor ADR that fully carries current constraints. Solution deletion requires a false `reusable_premise`, vanished `key_files` without a current owner, a retired command/Skill/API/workflow, or complete replacement by current guidance.
7. **Produce one exact manifest.** Classify entries as `DELETE`, `EDIT`, `KEEP`, `BLOCKED`, `BLOCKED_ACTIVE_SCOPE`, `UNVERIFIED`, `HISTORICAL_GIT_ONLY`, or `MISSING_CURRENT_DOC`. Include evidence, exact file/section action, inbound-reference treatment, Git recoverability, and candidate hash. Group `UNCLASSIFIED` files; do not interrogate the user file by file.
8. **Gate mutation.** `audit` mode stops after the manifest. Mutation mode also stops until the literal user approves exact manifest entries (for example, all recommendations except named IDs). Broad approval such as "clean stale docs" is insufficient. Interruption starts a fresh scan; no manifest is persisted.
9. **Revalidate and mutate minimally.** Re-read candidate bytes, Git status, inbound references, generated ownership, and active scope immediately before each approved change. Drift blocks that item. Delete a whole file only when its role is wholly obsolete; otherwise delete the complete stale logical section or move still-current constraints into an existing current owner before deleting the obsolete source. Never renumber ADRs or create a new ADR/Solution merely to complete pruning.
10. **Verify and report.** Re-scan residual names/paths, current local links, source/generated parity, existing documentation contract tests, and `git diff --check`. Do not execute arbitrary documented commands or the full business suite unless touched executable metadata requires a focused check. Do not commit. Report only `Deleted`, `Edited`, `Blocked`, `Unverified`, `Historical Git-only references`, `Verification`, and `Recovery: git log -- <path>`.

### 4.4 Mutation envelope

The Skill may modify or delete approved documentation, explicit translation/generated mirrors, documentation sync manifests, and tests whose only behavior is asserting document existence or obsolete wording. It must stop when completion requires runtime behavior, business-test semantics, package exports, public API, credentials, network writes, Git history rewriting, or any Managed authority mutation.

Generated content is never independently authored: change the source, update its declared sync ownership, and run the repository's existing generator. A failed generator or focused check leaves an inspectable diff and stops; the Skill must not stash, reset, checkout, or revert user work.

### 4.5 Compatibility and failure behavior

This is additive package behavior. Existing four Skills, active tasks, persisted TaskRecords, package exports, and runtime routes require no migration. Hosts discover the fifth Skill through the existing `pi.skills` directory package surface.

Partial implementation is safe because no runtime state changes. Before publication, source loader, owned packaged contract, source registry, generated registry/README, documentation, and tests must land as one coherent change. If execution is interrupted, package sync and focused tests identify incomplete publication. Rollback is the coherent revert of this Spec, Skill/registry/sync declarations, current documentation, and focused tests; no data migration or authority repair is required.

## 5. Public Documentation Contract

Current project documentation must state:

- five public Skills are shipped;
- only `imm-brainstorm`, `imm-planner`, and `imm-loop` enter or continue Managed Path;
- `imm-pr-fix` and `imm-doc-prune` are standalone host-native entries;
- `imm-doc-prune` is explicit, manifest-gated, Git-recoverable document maintenance and never a Loop internal role;
- Immune-Brain still does not automatically install or continuously validate project-wide `AGENTS.md`, `IMMUNE.md`, or `CONTEXT.md` contracts.

The existing stale `plugins/immune-brain/USER_GUIDE.md` claim that only three Skills are discoverable must be corrected. Any touched current-facing guidance that still says ordinary mutations automatically enter Managed Path must be corrected to the existing Skill-explicit routing contract.

## 6. Reference Closure Evidence

### Existing patterns and owners

- `plugins/immune-brain/skills/imm-pr-fix/SKILL.md` and `plugins/immune-brain/dist/imm-pr-fix.md`: compact-loader and standalone host-native authority precedent.
- `plugins/immune-brain/skills/registry.yaml`: canonical public discovery metadata; `dist/registry.yaml` is generated.
- `scripts/dist-sync-manifest.ts` and `scripts/sync-dist-docs.ts`: exhaustive packaged-contract ownership and generated registry/README synchronization.
- `tests/skill-dist-consistency.test.ts`: exact source/dist Skill set, loader linkage, and owned packaged contract coverage.
- `plugins/immune-brain/tests/skill-registry-consistency.test.ts`: registry-to-loader-to-dist discovery consistency.
- `tests/pi-canary-packed-loader.test.ts`: actual packed Pi `DefaultResourceLoader` discovery seam.
- `tests/direct-first-routing-contract.test.ts` and `tests/role-prompt-bridge.test.ts`: Managed/public/internal authority wording.
- `docs/adr/0003-public-orchestration-entry-internal-role-prompts.md`: internal roles must not be exposed as public Skills. `imm-doc-prune` is a standalone user-owned maintenance operation, not an internal role alias.
- `docs/solutions/rejected-shared-registry-generic-dispatcher.md`: rejected generic dispatch remains rejected; this Skill adds no dispatcher or runtime registry.

### Current-facing consumers

- `AGENTS.md`, `IMMUNE.md`, and `CONTEXT.md`.
- `plugins/immune-brain/README.md` and `plugins/immune-brain/USER_GUIDE.md`.
- `docs/user_manual.md`.
- `docs/reference/immune-brain-skills-guide.md`.
- `docs/reference/workflow-and-subagents.md`.
- `plugins/immune-brain/skills/imm-loop/SKILL.md` and `plugins/immune-brain/dist/imm-loop.md`, which name standalone public boundaries.

### Generated/package mirrors

- `plugins/immune-brain/dist/registry.yaml` and the generated role-map block in `plugins/immune-brain/README.md` are produced by `bun scripts/sync-dist-docs.ts`.
- `package.json` already ships the complete `skills/` and `dist/` trees; no package manifest or export change is required.

## 7. Devil's Advocate Audit

| Challenge | Evidence | Resolution |
| --- | --- | --- |
| A new Skill may be unnecessary; Planner or Compounder could clean docs. | Planner owns current planning authority and Compounder only records post-closure Learning. Neither provides an explicit, repository-wide, user-approved destructive maintenance boundary. | Keep one standalone explicit Skill; do not change Planner/Compounder behavior. |
| A static checker could guarantee freshness more cheaply. | Paths and registry names are mechanical, but whether an ADR premise or Solution remains current is semantic. The observed `imm-init` failure came from historically plausible prose. | Use cheap mechanical narrowing plus human approval; defer a checker until repeated external use proves stable extraction rules. |
| Git history could be unavailable or insufficient. | Untracked, dirty, or non-Git content is not recoverable from committed history. | Mutation fails closed for those candidates; audit remains available. |
| A public destructive Skill could collide with Managed execution. | Active TaskIntent scope and authority artifacts must remain Kernel-owned. | Read routing status, block overlapping/unknown scope, and categorically exclude authority artifacts. |
| Full-document scanning could become expensive. | File enumeration, local-link indexing, and name/reference matching are linear and cheap; semantic reads are the expensive part. | Read full content only for candidates and direct consumers; no default subagent fan-out or network checking. |
| Adding a maintenance Skill could become a second workflow. | The existing package already supports a standalone host-native PR repair Skill. | Reuse the standalone pattern with no next action, durable state, Enrollment, QA authority, or internal role dispatch. |
| The change may need multiple TaskIntents because it touches many files. | All files publish one inseparable public contract; partial registry/docs/package state is invalid, and all acceptance/rollback boundaries are shared. | Retain one coherent material TaskIntent. |

No blocking finding remains. No confirmed user decision was changed by this audit.

## 8. Scope

### Authoring and packaged Skill surface

- Add `plugins/immune-brain/skills/imm-doc-prune/SKILL.md`.
- Add `plugins/immune-brain/dist/imm-doc-prune.md`.
- Update `plugins/immune-brain/skills/registry.yaml`; regenerate `plugins/immune-brain/dist/registry.yaml`.
- Update `scripts/dist-sync-manifest.ts` with the owned packaged contract.
- Update standalone-boundary wording in `plugins/immune-brain/skills/imm-loop/SKILL.md` and `plugins/immune-brain/dist/imm-loop.md`.

### Current documentation

- `AGENTS.md`
- `IMMUNE.md`
- `CONTEXT.md`
- `plugins/immune-brain/README.md` (including generated role map)
- `plugins/immune-brain/USER_GUIDE.md`
- `docs/user_manual.md`
- `docs/reference/immune-brain-skills-guide.md`
- `docs/reference/workflow-and-subagents.md`

### Focused tests

- Add `tests/imm-doc-prune-contract.test.ts` for the ordered safety and authority contract.
- Update `tests/skill-dist-consistency.test.ts`.
- Update `plugins/immune-brain/tests/skill-registry-consistency.test.ts`.
- Update `tests/pi-canary-packed-loader.test.ts`.
- Update `tests/direct-first-routing-contract.test.ts`.
- Update `tests/role-prompt-bridge.test.ts`.

### Planning artifacts

- `docs/specs/add-imm-doc-prune.spec.md` and its frozen archive path.
- Canonical TaskIntent `docs/plans/2026-08-26-001-add-imm-doc-prune.intent.json`, authored by Kernel tooling.

## 9. Out of Scope

- Any runtime, extension, Kernel, Loop role bridge, CLI implementation, persistence schema, Tool schema, or authority transition.
- Automatic project initialization, CI installation, recurring scan, daemon, cron, cache, allowlist, or report artifact.
- External URL availability checks or execution of arbitrary commands embedded in documentation.
- Actual pruning of this repository's historical ADRs, Solutions, Specs, Plans, or `.imm` records as part of publishing the Skill.
- A new registry `role` or `role_class` enum.
- Package manifest or export changes.
- Automatic commits or remote mutations.

## 10. Acceptance and Verification

1. **Pruning safety contract**: the focused contract test proves explicit invocation, audit-only behavior, repository-wide role classification, evidence categories, exact manifest approval, hash/status/active-scope revalidation, authority exclusions, bounded mutations, verification, and no persistent state/commit behavior.
2. **Public package discovery**: the source loader, owned dist contract, canonical registry, generated registry, packed tarball, and real Pi resource loader expose exactly five public Skills, with `imm-doc-prune` discoverable.
3. **Authority and documentation consistency**: current guidance consistently distinguishes three Managed entries from two standalone host-native entries, and Loop does not dispatch `imm-doc-prune` as an internal role.
4. **Generated consistency**: `bun scripts/sync-dist-docs.ts --check` passes with the new owned contract and generated registry/README bytes.

The selected seams catch the intended regressions at the highest existing observable boundaries: contract text for destructive safety, the real Pi loader for shipped discovery, routing tests for authority isolation, and the canonical sync checker for generated parity.

## 11. Delivery and Recovery

Implement as one coherent TaskIntent because loader, packaged contract, registry, docs, and tests publish one user-visible capability and share one rollback boundary. Use characterization-first edits: add the focused contract assertions before completing the prompt and public documentation, then run package generation and focused verification.

If interrupted, do not expose a partial Skill as complete. Re-run the focused contract/discovery tests and sync check; they identify missing loader, registry, dist, docs, or package bytes. Rollback is a normal coherent Git revert of the task-owned files. No compatibility layer, migration, or temporary mechanism is introduced, so no exit plan is required.
