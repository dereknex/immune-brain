# Add `imm-agent-doc-maintain`

**Status**: Candidate
**Task**: `2026-09-03-001-add-imm-agent-doc-maintain`
**Planning entry**: `imm-planner` after a closed `imm-brainstorm` decision tree.
**Output Language**: English for persisted Spec and TaskIntent prose; user-facing replies follow repository instructions. Schema fields, paths, commands, identifiers, and enum values remain literal.
**Design risk**: Medium - this adds a sixth destructive, user-facing packaged Skill contract across discovery, package, documentation, and test surfaces. It introduces no runtime or persisted state, but weak classification or approval wording could remove necessary agent instructions.
**Design views**: Component/interface and data-flow/temporal-sequence views are selected because the public loader, owned packaged contract, registry, generated package bytes, host discovery, and ordered manifest gate form one shipped interface. A state-transition view is omitted because the Skill creates no durable workflow state.
**Diagram decision**: not_required
**Diagram reason**: The behavior is a single linear interaction (`inventory -> classify -> manifest -> approval -> revalidate -> mutate -> verify`) with no service topology or persisted state machine; the ordered contract is clearer than a diagram.

## 1. Problem

Repository-level agent instruction files are always-loaded context. They often accumulate repository overviews, directory listings, discoverable technology facts, duplicated rules, vague no-op guidance, contradictory host instructions, and unconditional exploration or test requirements. Agents may follow those instructions faithfully, increasing work and context cost without improving outcomes.

`imm-doc-prune` already removes evidence-proven stale documentation, including stale sections in agent instruction files. It does not own the broader quality decision: whether a current instruction is necessary, non-discoverable, stable, repeatable, and costly to violate. Immune-Brain needs a separate explicit maintenance entry for that semantic curation without turning project instruction files into installed or continuously validated contracts.

## 2. Result

The package exposes a sixth public Skill, `imm-agent-doc-maintain`, as a standalone host-native maintenance entry. It audits tracked root and nested `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` files in the current Git repository; produces one exact hash-bound manifest; and, only after literal approval, removes redundant context, rewrites actionable instructions, or replaces detail with a pointer to an existing authority.

The Skill preserves uncertain rules, blocks unresolved semantic conflicts, reports line and byte deltas without claiming model-token or success-rate improvements, and leaves `imm-doc-prune` behavior unchanged. Its first delivery publishes the Skill only; using it to reorganize this repository's own `AGENTS.md` is deferred to a later invocation.

## 3. Brainstorm Trace

| Manifest item | Status | Design disposition |
| --- | --- | --- |
| `BR-REQ-001` | covered | The Skill performs comprehensive agent-instruction maintenance. |
| `BR-REQ-002` | covered | Inventory includes tracked root and nested files with the three confirmed names. |
| `BR-REQ-003` | covered | Mutation requires exact manifest approval and fresh revalidation. |
| `BR-REQ-004` | covered | Terminal report includes semantic disposition, Verification, and line/byte deltas. |
| `BR-DEC-001` | captured | Public name is `imm-agent-doc-maintain`. |
| `BR-DEC-002` | captured | The Skill is standalone host-native and creates no Managed authority. |
| `BR-DEC-003` | captured | `imm-doc-prune` remains stale-only and neither Skill invokes the other. |
| `BR-DEC-004` | covered | Mutation is limited to agent instruction files; only existing references may be linked. |
| `BR-DEC-005` | covered | Each host-native file structure is preserved. |
| `BR-DEC-006` | covered | Unresolved precedence or semantic conflicts fail closed as `BLOCKED`. |
| `BR-DEC-007` | covered | Rules without sufficient evidence remain as `UNVERIFIED`. |
| `BR-DEC-008` | covered | No line-count or Token reduction target controls deletion. |
| `BR-DEC-009` | out_of_scope | This delivery publishes the Skill but does not reorganize the repository's own instruction files beyond public-surface wording required to publish the Skill. |
| `BR-OUT-001` | out_of_scope | User-level and external files are never inventoried or modified. |
| `BR-OUT-002` | out_of_scope | No project instruction installation or continuous validation is introduced. |
| `BR-OUT-003` | out_of_scope | No daemon, telemetry, automatic learning, or persistent report is introduced. |
| `BR-OUT-004` | out_of_scope | The Skill never commits. |
| `BR-OUT-005` | out_of_scope | Real-agent benchmarks are optional only when literally requested. |
| `BR-DEFER-001` | deferred | Actual curation of this repository's `AGENTS.md` is a later manifest-gated invocation after publication. |

## 4. Technical Design

### 4.1 Shipped component boundary

Follow ADR-0002's two-level Skill ownership:

- `plugins/immune-brain/skills/imm-agent-doc-maintain/SKILL.md` is the compact host-discovery entry.
- `plugins/immune-brain/dist/imm-agent-doc-maintain.md` is the self-owned detailed packaged contract.
- `plugins/immune-brain/skills/registry.yaml` declares a canonical `execute` / `repair` entry with no `next_actions`; generated `dist/registry.yaml` and the README role map remain outputs of `scripts/sync-dist-docs.ts`.
- `scripts/dist-sync-manifest.ts` declares the owned packaged contract.
- Existing Pi and Claude Code package tests prove actual shipped discovery.

The Skill is a user-requested maintenance operation, not an internal advisory or execution role. ADR-0003 therefore remains intact: Loop internal roles still use role prompts and are not exposed as public Skills.

### 4.2 Ordered maintenance flow

1. **Establish safety.** Mutation requires the current directory to be a Git worktree. Only tracked regular files named exactly `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`, at root or below tracked directories, are candidates. Git-tracked symlinks (`120000`) and other non-regular modes are `BLOCKED` before inventory, reading, or mutation. User-level and external files are excluded. Record path, blob/content hash, tracked status, candidate-local worktree status, Git file mode, line count, and byte count.
2. **Resolve Managed ownership.** Read the existing routing projection without creating authority. An active task remains owned by `imm-loop`. A candidate overlapping its `scope_hint` is `BLOCKED_ACTIVE_SCOPE`; unreadable ownership or scope fails closed for mutation while audit remains available.
3. **Inventory instruction relationships.** Determine nesting, explicit precedence statements, inbound references, and existing authority pointers. Preserve each file's native organization; do not normalize files to a shared template or infer unsupported cross-host inheritance semantics.
4. **Build repository facts.** Prefer executable configuration, package scripts, public/runtime entrypoints, behavior tests, active Spec/TaskIntent, current ADR/reference/README, then historical material. Repository facts are evidence for classification, not an excuse to copy discoverable context into instructions.
5. **Evaluate rule value.** A retained or newly proposed persistent rule must be non-obvious from ordinary repository inspection, plausibly repeat across tasks, remain stable beyond the current task, and impose meaningful cost when violated. Repository overviews, directory listings, technology summaries, discoverable command inventories, vague exhortations, and unconditional broad exploration/testing are candidates only when the manifest proves they add no hidden behavioral constraint.
6. **Classify exact actions.** Use `REMOVE`, `REWRITE`, `POINTER`, `KEEP`, `BLOCKED`, `BLOCKED_ACTIVE_SCOPE`, `UNVERIFIED`, and `MISSING_OWNER`. Every mutation entry identifies exact file/section bytes, preserved meaning, evidence, candidate hash, and resulting text. `POINTER` may target only an existing current authority with a concrete trigger condition. Missing reference ownership is `MISSING_OWNER`; the Skill does not create a reference document.
7. **Produce one manifest.** `imm-agent-doc-maintain audit` returns the manifest and stops. Ordinary `imm-agent-doc-maintain` returns the same manifest and waits in the current conversation for literal approval of exact entry IDs. Broad requests to "clean everything" are not mutation approval. The manifest is not persisted; interruption requires a fresh scan.
8. **Revalidate and mutate.** Immediately before each approved action, re-read bytes, candidate status, content hash, references, precedence evidence, and active scope. Drift blocks only that entry. Dirty/untracked candidates are `BLOCKED`; unaffected candidates continue. Never execute commands copied from instruction files, alter ordinary docs, install project contracts, commit, or mutate Managed authority.
9. **Verify and report.** Re-scan modified instruction relationships, local pointer targets, unresolved conflicts, source/package public-surface parity, existing focused documentation contracts, and `git diff --check`. Report only `Removed`, `Rewritten`, `Moved to pointer`, `Kept`, `Blocked`, `Unverified`, `Verification`, and before/after line and byte counts. Do not translate byte changes into Token or task-success claims.

### 4.3 Conflict and evidence invariants

- Explicit repository scope and declared precedence may resolve a conflict; filename convention, nesting, or guessed host behavior alone may not.
- Unknown or one-off-looking rules are preserved as `UNVERIFIED`, not deleted by default.
- No fixed line, byte, percentage, or Token target authorizes removal.
- An incident supplied by the user is evidence for a candidate rule, not automatic authorization to append it. The same value gate and manifest approval still apply.
- Necessary hard guardrails, security constraints, data-loss prevention, accessibility basics, and explicit user requirements are never simplified away for brevity.
- `imm-doc-prune` remains able to remove evidence-proven stale agent-instruction content. `imm-agent-doc-maintain` owns broader context quality and never delegates to or invokes `imm-doc-prune`.

### 4.4 Compatibility, interruption, and rollback

This is an additive public package change from five to six Skills. Existing invocations, Managed Path routing, `imm-doc-prune` classifications, persisted TaskRecords, Kernel state, runtime tools, schemas, and package exports require no migration or compatibility layer.

The loader, owned dist contract, registry/generated bytes, public documentation, and host package expectations form one publication unit. Focused tests fail when publication is partial. If implementation is interrupted, rerun those checks to locate missing surfaces. Rollback is one normal Git revert of the task-owned publication files; no state repair or data migration is required.

## 5. Public Documentation Contract

Current guidance must consistently state:

- six public Skills are shipped;
- `imm-brainstorm`, `imm-planner`, and `imm-loop` are the only Managed Path entries;
- `imm-pr-fix`, `imm-doc-prune`, and `imm-agent-doc-maintain` are standalone host-native maintenance entries;
- `imm-doc-prune` removes evidence-proven stale current documentation;
- `imm-agent-doc-maintain` minimizes tracked agent instruction context through an exact approved manifest;
- runtime still does not install or continuously validate project-level `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `IMMUNE.md`, or `CONTEXT.md` contracts.

Loop source and packaged contracts must name all standalone entries as non-dispatched. No new internal role prompt, runtime route, tool, command, or authority transition is added.

## 6. Reference Closure Evidence

### Public and package owners

- `plugins/immune-brain/skills/imm-doc-prune/SKILL.md` and `plugins/immune-brain/dist/imm-doc-prune.md`: compact-loader, manifest gate, Git safety, and standalone maintenance precedent.
- `plugins/immune-brain/skills/registry.yaml` and `scripts/skill-registry.ts`: canonical public metadata and generated README role map.
- `scripts/dist-sync-manifest.ts` and `scripts/sync-dist-docs.ts`: owned dist contract declaration and generated registry/README bytes.
- `package.json`: ships the complete `plugins/immune-brain/skills` and `dist` trees, so no manifest edit is required.

### Current documentation consumers

- `AGENTS.md`, `IMMUNE.md`, and `CONTEXT.md` define project routing and architecture navigation.
- `README.md`, `README.zh-CN.md`, `docs/user_manual.md`, `docs/reference/immune-brain-skills-guide.md`, and `docs/reference/workflow-and-subagents.md` enumerate public entry behavior.
- `plugins/immune-brain/README.md` and `plugins/immune-brain/USER_GUIDE.md` define shipped package discovery.
- `plugins/immune-brain/skills/imm-loop/SKILL.md` and `plugins/immune-brain/dist/imm-loop.md` own the public-versus-internal dispatch boundary.

### Highest focused behavioral seams

- New `tests/imm-agent-doc-maintain-contract.test.ts`: ordered safety, value gate, classifications, approval, mutation envelope, failure behavior, and report contract.
- `tests/skill-dist-consistency.test.ts` and `plugins/immune-brain/tests/skill-registry-consistency.test.ts`: exact source/dist/registry surface and orphan prevention.
- `tests/skill-registry-metadata-contract.test.ts`: allowed existing role vocabulary and generated registry parity.
- `tests/pi-canary-packed-loader.test.ts`: actual packed Pi `DefaultResourceLoader` discovery.
- `tests/claude-host-package.test.ts`: shipped Claude Code Skill allowlist and dist contract set.
- `tests/direct-first-routing-contract.test.ts` and `tests/role-prompt-bridge.test.ts`: Managed routing and Loop non-dispatch wording.
- `bun scripts/sync-dist-docs.ts --check`: generated registry and README parity.

## 7. Devil's Advocate Audit

### Rollback resilience

The change has no runtime or persisted-state mutation. All publication surfaces share one revert boundary. Candidate-file mutations performed by the future Skill remain Git-recoverable and revalidated individually; dirty or drifted entries block without resetting user work.

### Verification vanity

A test that merely finds the Skill name would not prove safe maintenance. The new contract test must assert positive and negative behavior: exact tracked-file inventory, the four-part rule-value gate, all classifications, no fixed compression target, uncertain-rule preservation, conflict blocking, existing-pointer-only behavior, exact approval, revalidation, local failure isolation, bounded reporting, and forbidden global/runtime/commit behavior. Real Pi and Claude package tests separately prove the Skill is actually shipped.

### Spec dilution detection

The design does not reduce the request to stale deletion or a generic writing guide. It includes comprehensive current-instruction curation while preserving every confirmed non-goal: no global files, no automatic learning, no new reference docs, no benchmark gate, no self-application in the publication task, and no project-contract installation or validation.

## 8. Scope

### New Skill and packaged ownership

- `plugins/immune-brain/skills/imm-agent-doc-maintain/SKILL.md`
- `plugins/immune-brain/dist/imm-agent-doc-maintain.md`
- `plugins/immune-brain/skills/registry.yaml`
- `plugins/immune-brain/dist/registry.yaml`
- `scripts/dist-sync-manifest.ts`

### Routing and public documentation

- `AGENTS.md`
- `IMMUNE.md`
- `CONTEXT.md`
- `README.md`
- `README.zh-CN.md`
- `docs/user_manual.md`
- `docs/reference/immune-brain-skills-guide.md`
- `docs/reference/workflow-and-subagents.md`
- `plugins/immune-brain/README.md`
- `plugins/immune-brain/USER_GUIDE.md`
- `plugins/immune-brain/skills/imm-loop/SKILL.md`
- `plugins/immune-brain/dist/imm-loop.md`

### Focused tests

- Add `tests/imm-agent-doc-maintain-contract.test.ts`.
- Update `tests/skill-dist-consistency.test.ts`.
- Update `plugins/immune-brain/tests/skill-registry-consistency.test.ts`.
- Update `tests/pi-canary-packed-loader.test.ts`.
- Update `tests/claude-host-package.test.ts`.
- Update `tests/direct-first-routing-contract.test.ts`.
- Update `tests/role-prompt-bridge.test.ts`.

### Planning artifacts

- `docs/specs/add-imm-agent-doc-maintain.spec.md` and its frozen archive path.
- Canonical TaskIntent `docs/plans/2026-09-03-001-add-imm-agent-doc-maintain.intent.json`, authored by Kernel tooling.

## 9. Out of Scope

- Applying the new Skill to this repository's current instruction content.
- Modifying user-level or external instruction files.
- Creating ordinary reference documentation to receive moved content.
- Changing `imm-doc-prune` behavior or invoking one maintenance Skill from the other.
- Runtime, extension, Kernel, Loop role bridge, CLI, persistence, schema, Tool, authority, or package-export changes.
- Project instruction installation, contract validation, automatic rule learning, telemetry, daemon, cron, CI installation, persistent reports, automatic commits, or network writes.
- Mandatory real-model, success-rate, or Token benchmarks.
- A fixed line, byte, Token, or percentage reduction target.

## 10. Acceptance and Verification

1. **Maintenance safety contract**: the focused Skill contract test proves inventory scope, evidence ordering, the four-part value gate, native-format preservation, classifications, conflict and uncertainty behavior, exact manifest approval, revalidation, active-scope/dirty isolation, bounded mutation/reporting, and all explicit non-goals.
2. **Canonical public surface**: source loader, owned packaged contract, canonical/generated registries, allowed metadata, and exact package contract declarations expose six public Skills with `imm-agent-doc-maintain` as `execute` / `repair` and no next action.
3. **Pi package discovery**: the packed npm package contains the new files and Pi's real `DefaultResourceLoader` discovers all six Skills.
4. **Claude Code package discovery**: the supported Claude Code package includes the new loader and owned dist contract without creating a separate contract fork.
5. **Routing and documentation consistency**: current guidance names three Managed entries and three standalone host-native entries, and Loop never presents or dispatches the new Skill as an internal role.
6. **Generated consistency**: registry and generated README bytes pass `bun scripts/sync-dist-docs.ts --check`.

These are the highest existing observable seams. They detect unsafe prompt drift, incomplete source/package publication, real host-discovery failure, routing-boundary regression, and generated-byte drift without running the full suite or a nondeterministic model benchmark.
