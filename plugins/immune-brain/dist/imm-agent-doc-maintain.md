---
name: imm-agent-doc-maintain
description: Use to minimize tracked AGENTS.md, CLAUDE.md, and GEMINI.md files to necessary non-discoverable context after an explicit, hash-bound, user-approved manifest; never installs or validates project contracts.
---

# Immune-Brain: Agent Doc Maintain

Minimize tracked agent instruction files in one Git repository to the smallest
set of persistent rules that are non-obvious, repeatable, stable, and costly to
violate. This is a standalone host-native maintenance entry, not a Managed Path
continuation and not an `imm-loop` internal-role dispatch.

## Authority Boundary

This Skill maintains agent instruction files without creating or mutating
TaskIntent, TaskRecord, Kernel, Spec, or Plan authority. An already active
Managed task remains owned by `imm-loop`. Read-only inventory and manifest
production remain available. Classify each candidate overlapping the active
TaskIntent `scope_hint` as `BLOCKED_ACTIVE_SCOPE` and continue auditing
unaffected candidates. If the routing owner or scope cannot be read reliably,
fail closed for mutation. This Skill does not invoke `imm-doc-prune`; stale
deletion of evidence-proven content remains that Skill's separate job.

## Invocation

Requires explicit invocation: `imm-agent-doc-maintain` or
`/imm-agent-doc-maintain`. Ordinary "is this AGENTS.md too long?" questions stay
host-native and do not enter this Skill.

- `imm-agent-doc-maintain audit`: read-only. Produce the manifest and stop.
- `imm-agent-doc-maintain`: produce the manifest, then wait for exact manifest
  approval before any mutation.

No automatic invocation. No daemon, no telemetry, no automatic learning, no
cron, no CI, no allowlist, no runtime, no persistent report, and no automatic
commit.

## Ordered Maintenance Protocol

1. **Establish repository safety.** Mutation requires a Git worktree. Only
   tracked regular files named exactly `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`,
   at the repository root or in nested tracked directories, are candidates.
   Git-tracked symlinks (`120000`) and other non-regular modes are `BLOCKED`
   before inventory, reading, or mutation, even when the basename matches.
   User-level and external files, including `~/.pi/agent/AGENTS.md` and
   `~/.agents/`, are never inventoried or modified. Record the candidate path,
   blob/content hash, tracked status, candidate-local worktree status, Git file
   mode, line count, and byte count. Unrelated dirty files do not block the run;
   a dirty or untracked candidate is `BLOCKED`.

2. **Resolve Managed ownership.** Read the existing routing projection without
   creating authority. An already active Managed task remains owned by
   `imm-loop`. A candidate overlapping its `scope_hint` is
   `BLOCKED_ACTIVE_SCOPE`; continue auditing unaffected candidates. If the
   routing owner or scope cannot be read reliably, fail closed for mutation.

3. **Inventory instruction relationships.** Determine nesting, explicit
   precedence statements, inbound references, and existing authority pointers.
   Preserve each file's native organization. Do not normalize files to a shared
   template and do not infer unsupported cross-host inheritance semantics.

4. **Build repository facts.** Resolve current truth in this order:
   executable/public registries, package exports, CLI/runtime entrypoints;
   behavior tests; active Spec/TaskIntent; current `CONTEXT.md`/ADR/
   reference/README; Solution/Brainstorm/archive. Repository facts are evidence
   for classification, not a reason to copy discoverable context into
   instructions.

5. **Apply the four-part persistent-rule value gate.** A retained or newly
   proposed persistent rule must be all of: non-obvious from ordinary
   repository inspection; plausibly repeatable across later tasks; stable beyond
   the current task; and costly to violate. Repository overviews, directory
   listings, technology summaries, discoverable command inventories, vague
   exhortations, and unconditional broad exploration or testing fail this gate
   unless the manifest proves they encode a hidden behavioral constraint.

6. **Classify exact actions.** Classify entries as `REMOVE`, `REWRITE`,
   `POINTER`, `KEEP`, `BLOCKED`, `BLOCKED_ACTIVE_SCOPE`, `UNVERIFIED`, or
   `MISSING_OWNER`. Every mutation entry identifies exact file/section bytes,
   preserved meaning, evidence, candidate hash, and resulting text. `POINTER`
   may target only an existing current authority and must include a concrete
   trigger condition. Missing reference ownership is `MISSING_OWNER`; this Skill
   does not create a reference document. Unknown or one-off-looking rules remain
   `UNVERIFIED` and are not deleted by default. Unresolved precedence or
   semantic conflicts that cannot be decided from explicit repository scope or
   declared precedence are `BLOCKED`. Filename convention, nesting, or guessed
   host behavior alone may not resolve a conflict.

7. **Produce one exact manifest.** `audit` mode stops after the manifest.
   Mutation mode also stops until the literal user approves exact manifest
   entries (for example, "all recommendations except 4 and 7"). Broad approval
   such as "clean AGENTS.md" is insufficient. Interruption starts a fresh scan;
   no manifest is persisted. No fixed line, byte, percentage, or Token target
   authorizes removal.

8. **Revalidate and mutate minimally.** Re-read candidate bytes, Git status,
   content hash, references, precedence evidence, and active scope immediately
   before each approved change. Drift blocks that item. Never execute commands
   copied from instruction files. Never alter ordinary documentation, install
   project contracts, commit, or mutate Managed authority. Necessary hard
   guardrails, security constraints, data-loss prevention, accessibility
   basics, and explicit user requirements are never simplified away for
   brevity.

9. **Verify and report.** Re-scan modified instruction relationships, local
   pointer targets, unresolved conflicts, source/package public-surface parity,
   existing focused documentation contracts, and `git diff --check`. This Skill
   does not execute arbitrary documented commands, real-model success-rate
   benchmarks, or Token measurements unless the user literally requests a
   benchmark. This Skill does not commit. Report only `Removed`, `Rewritten`,
   `Moved to pointer`, `Kept`, `Blocked`, `Unverified`, `Verification`, and
   before/after line and byte counts. Do not translate byte changes into Token
   or task-success claims.

## Mutation Envelope

This Skill may modify only approved agent instruction files. It must stop when
completion requires creating a new reference document, changing ordinary docs,
runtime behavior, business-test semantics, package exports, public API,
credentials, network writes, Git history rewriting, project-contract
installation or continuous validation, automatic rule learning, or any Managed
authority mutation.

A failed focused check leaves an inspectable diff and stops; this Skill does
not stash, reset, checkout, or revert user work.

## Non-goals

- User-level and external instruction files are never inventoried or modified.
- Runtime still does not install or continuously validate project-level
  `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `IMMUNE.md`, or `CONTEXT.md`
  contracts.
- No daemon, telemetry, automatic learning, persistent report, or automatic
  commit.
- No 200-line, Token, or success-rate target.
- `imm-doc-prune` remains able to remove evidence-proven stale
  agent-instruction content; the two Skills never invoke each other.
