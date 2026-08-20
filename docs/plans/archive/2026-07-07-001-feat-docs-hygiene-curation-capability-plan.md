---
title: "feat: doc-hygiene curation capability for Immune-Brain"
type: feat
status: planned
date: 2026-07-07
origin:
  - imm-brainstorm framing: give Immune-Brain doc cleanup/curation ability (Option 1, user-selected)
  - docs/specs/archive/2026-07-07-docs-hygiene-curation-capability.spec.md
---

# Iteration Plan

## Task

- Summary: Add a read-only doc-hygiene sweep to `docs-verifier` backed by a shared
  `doc-lifecycle-hygiene.md` reference, and a stale-decision retirement
  convention to `imm-compounder`, without adding a new skill or write authority.
- Spec: `docs/specs/archive/2026-07-07-docs-hygiene-curation-capability.spec.md`
- Origin: User selected Option 1 (enhance `docs-verifier` + reuse `imm-compounder`)
  after rejecting a full `imm-planner` -> `imm-work` -> `imm-compounder` cleanup
  pipeline as too heavy and a standalone `docs-curator` skill as not lightweight.
- Scope Mode: New docs/contract slice on the `immune-brain` plugin. No runtime,
  State Ledger, or test-behavior changes. No cleanup of sample repos.
- Planner research dispatch: solo. Single-domain, docs/contract-only; the sync
  pipeline, consistency tests, and existing conventions were confirmed by direct
  inspection.

## Output Language

- Human-readable prose: English for Spec and Plan documents.
- Preserved literals: file paths, commands, frontmatter keys, YAML fields, CLI
  flags, Skill names, and canonical terms such as `Step`, `Plan`, `Spec`,
  `Verification`, and `Devil's Advocate Audit`.

## Research

- `plugins/immune-brain/dist/docs-verifier.md` is a hand-authored skill body
  (54 lines); it is not generated from a `docs/` source and has no content
  contract test.
- `plugins/immune-brain/dist/docs/reference/*` are byte-mirrored from repo-root
  `docs/reference/*` via `scripts/sync-dist-docs.ts`, classified in
  `scripts/dist-sync-manifest.ts` (`DIST_DOC_ENTRIES`), and guarded by
  `tests/dist-docs-sync-contract.test.ts` (every packaged file classified +
  mirror byte-identical + source exists).
- Adding a mirror reference = one `{ rel, mode: "mirror" }` entry in
  `dist-sync-manifest.ts` + source file under `docs/reference/` + one
  `bun scripts/sync-dist-docs.ts` run.
- `imm-compounder` already owns decision capture: `Rejected Decisions`
  (`rejected: true`), `Architecture Map Sync`, and `docs/solutions/` durable
  storage (`dist/imm-compounder.md:31`). Stale-decision retirement extends this,
  it does not duplicate it.
- No new skill directory is introduced, so `tests/skill-registry-consistency`
  and `tests/host-manifest-consistency` (auto-discovery via `"skills": "./skills/"`)
  stay green.
- Repo `docs/specs/` and `docs/plans/` prose is English; `IMMUNE.md` is the
  Chinese constitution but is not a document-language instruction for specs/plans.

## Decisions

- D1: Enhance `docs-verifier` (read-only) instead of adding a `docs-curator`
  skill. Keeps the advisory/execution invariant and avoids the skill-registry /
  host-manifest cost of a new skill.
- D2: `docs-verifier` stays strictly read-only. It emits a dry-run cleanup report;
  it never moves or deletes files.
- D3: File moves/deletes are applied by `imm-executor` or a normal agent after
  user confirmation. Routine doc cleanup does not force the full
  planner -> work -> QA -> compounder pipeline.
- D4: The lifecycle taxonomy and cleanup safety protocol live in one shared
  reference doc (`docs/reference/doc-lifecycle-hygiene.md`), reused by
  `docs-verifier` and `imm-compounder` instead of duplicated.
- D5: Stale-decision retirement extends `imm-compounder`'s existing
  `Rejected Decisions` rule (`status: superseded` + `superseded_by`, or
  `status: obsolete`); it does not create a competing convention.
- D6: Git history is the recovery path for low-value process docs, so those are
  delete-safe; misleading-but-historical docs are archived or marked `superseded`.
- D7: No cleanup is run against `refine` / `nextty.dev`; they remain samples.

## Assumptions

- A read-only inventory + classification + dry-run report is enough value to ship
  before any CLI tooling; a full `imm-docs-audit` command is deferred.
- Reusing the reference-doc packaging pattern is preferred over inlining the
  taxonomy into the compact `docs-verifier` body.

## Devil's Advocate Audit

### 1. Rollback Resilience

- Risk: markdown/manifest edits plus a generated mirror could half-apply.
- Mitigation: every change is git-reversible with no runtime/state migration.
  `bun scripts/sync-dist-docs.ts --check` detects mirror drift; re-running
  `bun scripts/sync-dist-docs.ts` restores byte-identity. A failed step leaves
  prior skill contracts intact.

### 2. Verification Vanity

- Risk: greps could prove new wording exists without proving the real regression
  (an advisory skill silently gaining write powers) cannot happen.
- Mitigation: U1 verification asserts `dist/docs-verifier.md` still states
  read-only and references the taxonomy, and runs the packaging + consistency
  test suites, which fail on real drift rather than only matching text.

### 3. Spec Dilution Detection

- Risk: the brainstorm requirement "cleanup allows move/delete" could be silently
  narrowed, or the "expired decisions" half dropped.
- Mitigation: the move/delete narrowing is recorded explicitly as D2/D3 (safe
  apply path outside the advisory boundary), not omitted; the decision-retirement
  half is a dedicated Step (U2) with its own verification.

## Steps

### Step 1

- Step ID: U1
- Result: Docs-verifier gains a read-only doc-hygiene sweep mode backed by a shared lifecycle taxonomy reference.
- Verification type: automated
- Verification: `cd /Users/derek/workspaces/agent-skills && bun scripts/sync-dist-docs.ts --check && bun test tests/dist-docs-sync-contract.test.ts && rg -q "doc-lifecycle-hygiene" plugins/immune-brain/dist/docs-verifier.md && rg -qi "read-only" plugins/immune-brain/dist/docs-verifier.md`
- Test scenarios: `doc-lifecycle-hygiene.md` defines all seven lifecycle classes and the cleanup safety protocol; the new reference is registered as a mirror entry and byte-identical to its `docs/reference/` source; `docs-verifier` describes an explicit-trigger hygiene sweep producing a classified inventory plus dry-run cleanup candidates; `docs-verifier` still states it is read-only and performs no file mutation.
- Discovery cache: docs/reference/doc-lifecycle-hygiene.md (new taxonomy + safety reference source); scripts/dist-sync-manifest.ts (register mirror entry); plugins/immune-brain/dist/docs-verifier.md (hygiene sweep mode + read-only reinforcement); plugins/immune-brain/skills/docs-verifier/SKILL.md (shim description); plugins/immune-brain/skills/registry.yaml (docs-verifier boundary/description)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: If the packaged mirror drifts from source, treat `docs/reference/doc-lifecycle-hygiene.md` as source of truth and re-run `bun scripts/sync-dist-docs.ts` before recording evidence.
- security_considerations: None. Docs/contract-only change; no code path, no credentials, no config output.

### Step 2

- Step ID: U2
- Result: Compounder gains a stale-decision retirement convention wired to the hygiene sweep.
- Verification type: automated
- Verification: `cd /Users/derek/workspaces/agent-skills && rg -q "superseded_by" plugins/immune-brain/dist/imm-compounder.md && rg -q "rejected: true" plugins/immune-brain/dist/imm-compounder.md && rg -qi "decision_candidates|decision candidates" plugins/immune-brain/dist/docs-verifier.md && bun test`
- Test scenarios: `imm-compounder` documents `status: superseded` + `superseded_by` (and `status: obsolete`) beside the existing `rejected: true` convention; expired-decision handling points at `doc-lifecycle-hygiene.md`; the hygiene sweep's `decision_candidates` route to `imm-compounder`; the full test suite stays green.
- Discovery cache: plugins/immune-brain/dist/imm-compounder.md (extend Rejected Decisions with superseded/obsolete); plugins/immune-brain/dist/docs-verifier.md (route decision_candidates to compounder)
- Agent Hint: imm-executor
- Depends on: U1
- failure_behavior: If the compounder convention conflicts with the taxonomy reference, align both to the reference wording before recording evidence; do not fork a second retirement convention.
- security_considerations: None. Docs/contract-only change.

## Brainstorm manifest

- BR-REQ-001: Immune-Brain supports doc cleanup/curation, not only appending docs.
- BR-REQ-002: Docs can be classified `current` / `active` / `historical` / `runtime_trace` / `scratch` / `obsolete` / `decision`.
- BR-REQ-003: Expired decisions get a status (`superseded` / `rejected` / `obsolete`).
- BR-REQ-004: `.imm` / `.planning` default to `runtime_trace`, not a long-term knowledge base.
- BR-REQ-005: Cleanup allows moving and deleting files, but through a safe, verifiable path.
- BR-REQ-006: Git history is the recovery path for low-value historical docs.
- BR-DEC-001: Do not remediate `refine` / `nextty.dev`; use them as samples only.
- BR-DEC-002: Enhance `docs-verifier`; do not build a complex new system.
- BR-OUT-001: No automatic mass deletion.
- BR-OUT-002: Do not permanently transcode every old plan/spec.
- BR-DEFER-001: An `imm-docs-audit` CLI can come later.
- BR-Q-001: Standalone `docs-curator` skill vs enhance `docs-verifier`.

## Brainstorm Trace

| BR ID | Status | Mapping / reason |
|-------|--------|------------------|
| BR-REQ-001 | covered_by_step | U1 adds the doc-hygiene sweep capability. |
| BR-REQ-002 | covered_by_step | U1 taxonomy reference defines all seven classes. |
| BR-REQ-003 | covered_by_step | U2 adds superseded/obsolete beside rejected. |
| BR-REQ-004 | covered_by_step | U1 taxonomy defines `runtime_trace` for `.imm`/`.planning`. |
| BR-REQ-005 | partially_covered | Move/delete stays outside advisory scope; D2/D3 define the safe apply path (executor or normal agent after dry-run + confirm) rather than a new write role. |
| BR-REQ-006 | captured_as_decision | D6: git history is the recovery path; encoded in the U1 safety protocol. |
| BR-DEC-001 | out_of_scope | D7: this Plan changes only the plugin; sample repos are untouched. |
| BR-DEC-002 | captured_as_decision | D1: enhance `docs-verifier`, no new skill. |
| BR-OUT-001 | captured_as_decision | D2: read-only report only; no automatic deletion. |
| BR-OUT-002 | captured_as_decision | D6: historical docs are archived or marked, not transcoded. |
| BR-DEFER-001 | deferred | v1 is skill/contract only; CLI tooling is a later slice. |
| BR-Q-001 | resolved_as_assumption | User chose Option 1: enhance `docs-verifier`, no `docs-curator`. |

## Test Scenarios

- An agent triggered with "doc hygiene sweep" gets a classified inventory and a
  dry-run cleanup candidate list without any file being changed.
- The lifecycle taxonomy reference ships byte-identical inside the plugin package.
- An expired decision can be retired via `superseded_by` without deleting its
  rationale, and a rejected approach keeps a minimal record.
- Existing plugin consistency and packaging test suites stay green.

## Validation

- Plan validator: `plugins/immune-brain/bin/imm-plan docs/plans/2026-07-07-001-feat-docs-hygiene-curation-capability-plan.md --json`
- Do not sync or execute this Plan until the user confirms scope.

## Next Action

- If the user approves scope, sync this Plan and start U1 through `imm-work`.
