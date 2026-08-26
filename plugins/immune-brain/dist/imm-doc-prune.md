---
name: imm-doc-prune
description: Use to prune stale current documentation from a Git repository after an explicit, hash-bound, user-approved manifest; never deletes Managed authority artifacts.
---

# Immune-Brain: Doc Prune

Prune stale current documentation from one Git repository through explicit
invocation, comprehensive inventory, evidence-based candidate narrowing,
one exact user-approved manifest, and bounded current-only mutation. This is
a standalone host-native maintenance entry, not a Managed Path continuation
and not an `imm-loop` internal-role dispatch.

## Authority Boundary

This Skill prunes documentation
without creating or mutating
TaskIntent, TaskRecord, Kernel, Spec, or Plan authority. An already active
Managed task remains owned by `imm-loop`. Read-only inventory and manifest
production remain available. Classify each candidate overlapping the active
TaskIntent `scope_hint` as `BLOCKED_ACTIVE_SCOPE` and continue auditing
unaffected candidates. If the routing owner or scope cannot be read reliably,
fail closed for mutation.

## Invocation

Requires explicit invocation: `imm-doc-prune` or `/imm-doc-prune`. Ordinary
"is this doc stale?" questions stay host-native and do not enter this Skill.

- `imm-doc-prune audit`: read-only. Produce the manifest and stop.
- `imm-doc-prune`: produce the manifest, then wait for exact manifest approval
  before any mutation.

No automatic invocation. No daemon, no cron, no CI, no allowlist, no runtime,
no persistent report, and no automatic commit.

## Ordered Pruning Protocol

1. **Establish repository safety.** Mutation requires a Git worktree. A
   non-Git repository or an untracked candidate is audit-only. Record the
   candidate path, blob/content hash, tracked status, and candidate-local
   worktree status. Unrelated dirty files do not block the run; a dirty
   candidate is `BLOCKED`.

2. **Inventory current documentation.** Enumerate tracked `.md`, `.mdx`,
   `.rst`, and `.adoc` files, agent instruction files such as `AGENTS.md`,
   `CLAUDE.md`, and `GEMINI.md`, plus `.json`, `.yaml`, and `.yml` files
   under documentation directories that are referenced by current
   documentation. Exclude `node_modules`, vendor trees, build output,
   caches, arbitrary business data, and source comments from semantic
   scanning.

3. **Classify document roles.** Distinguish current guidance, generated or
   mirror content, Kernel authority artifacts, historical-by-purpose
   records, non-authority archives, and `UNCLASSIFIED` groups. Preserve
   `CHANGELOG`, release notes, migration records, and incident reports;
   do not modernize historical narration merely because it describes old
   behavior.

4. **Build repository facts.** Resolve current truth in this order:
   executable/public registries, package exports, CLI/runtime entrypoints;
   behavior tests; active Spec/TaskIntent; current `CONTEXT.md`/ADR/
   reference/README; Solution/Brainstorm/archive. A lower-priority historical
   statement cannot prove a retired public surface is current.

5. **Mechanically narrow candidates.** Check local paths and anchors, public
   Skill/CLI/API names, command/import targets without executing arbitrary
   examples, inbound local references, source/generated declarations,
   translations with explicit source mappings, ADR/Solution owners, and
   conflicting current claims. External URL availability is not probed in
   the first version.

6. **Apply evidence rules.** Age or zero references alone never proves
   staleness. ADR deletion requires a removed decision object, an implemented
   mutually exclusive replacement with current constraints preserved, a
   retired public surface, or a successor ADR that fully carries current
   constraints. Solution deletion requires a false `reusable_premise`,
   vanished `key_files` without a current owner, a retired command/Skill/API/
   workflow, or complete replacement by current guidance.

7. **Produce one exact manifest.** Classify entries as `DELETE`, `EDIT`,
   `KEEP`, `BLOCKED`, `BLOCKED_ACTIVE_SCOPE`, `UNVERIFIED`,
   `HISTORICAL_GIT_ONLY`, or `MISSING_CURRENT_DOC`. Include evidence, exact
   file/section action, inbound-reference treatment, Git recoverability, and
   candidate hash. Group `UNCLASSIFIED` files; do not interrogate the user
   file by file.

8. **Gate mutation.** `audit` mode stops after the manifest. Mutation mode
   also stops until the literal user approves exact manifest entries (for
   example, "all recommendations except 4 and 7"). Broad approval such as
   "clean stale docs" is insufficient. Interruption starts a fresh scan; no
   manifest is persisted.

9. **Revalidate and mutate minimally.** Re-read candidate bytes, Git status,
   inbound references, generated ownership, and active scope immediately
   before each approved change. Drift blocks that item. Delete a whole file
   only when its role is wholly obsolete; otherwise delete the complete stale
   logical section or move still-current constraints into an existing current
   owner before deleting the obsolete source. Never renumber ADRs and never
   create a new ADR or Solution merely to complete pruning.

10. **Verify and report.** Re-scan residual names and paths, current local
    links on current documentation, source/generated parity, existing documentation contract tests,
    and `git diff --check`. This Skill does not execute arbitrary documented
    commands or the full business suite unless touched executable metadata
    requires a focused check. This Skill does not commit. Report only `Deleted`, `Edited`, `Blocked`,
    `Unverified`, `Historical Git-only references`, `Verification`, and
    `Recovery: git log -- <path>`.

## Mutation Envelope

This Skill may modify or delete approved documentation, explicit translation
or generated mirrors, documentation sync manifests, and tests whose only
behavior is asserting document existence or obsolete wording. It must stop
when completion requires runtime behavior, business-test semantics, package
exports, public API, credentials, network writes, Git history rewriting, or
any Managed authority mutation.

Generated content is never independently authored: change the source, update
its declared sync ownership, and run the repository's existing generator. A
failed generator or focused check leaves an inspectable diff and stops; this
Skill does not stash, reset, checkout, or revert user work.

## Authority Artifacts Excluded

This Skill categorically does not delete active or frozen Specs, TaskIntents,
TaskRecords, tombstones, or other `.imm` authority. Historical immutable
authority references to deleted non-authority documents are allowed and
reported as `HISTORICAL_GIT_ONLY` references with the recovering commit; they
are not treated as current dangling links.

## Recovery

Git history is the archive for obsolete non-authority documentation. Every
`DELETE` entry reports `Recovery: git log -- <path>` so the user can restore
content from history. Untracked, dirty, or non-Git candidates are never
deleted.
