---
name: imm-test-prune
description: Use when the user explicitly requests Immune-Brain audit or pruning of redundant, bloated, or orphaned tests.
---

# Immune-Brain: Test Prune

Reduce test-suite bloat in one Git repository. The Skill works through explicit
invocation, a comprehensive test inventory, evidence-based candidate narrowing,
one exact user-approved manifest, and bounded test-only mutation that never
weakens a live guarantee. It is language- and runner-agnostic: it uses the
target repository's own test, coverage, and static-check commands. This is a
standalone host-native maintenance entry, not a Managed Path continuation and
not an `imm-run` internal-role dispatch.

## Authority Boundary

This Skill restructures and prunes tests without creating or mutating
TaskIntent, TaskRecord, Kernel, Spec, or Plan authority. An already active
Managed task remains owned by `imm-run`. Read-only inventory and manifest
production remain available.

Classify each of the following candidates as `BLOCKED_ACTIVE_SCOPE` and
continue auditing unaffected candidates:
- a candidate overlapping the active TaskIntent `scope_hint`;
- a candidate named by an active acceptance descriptor's verification `argv`.

If the routing owner or scope cannot be read reliably, fail closed for
mutation. This Skill does not invoke `imm-doc-prune`. Tests whose only behavior
is asserting document existence or wording remain that Skill's job and are
reported as `DEFER_DOC_PRUNE`.

## Invocation

Requires explicit invocation: `imm-test-prune` or `/imm-test-prune`. Ordinary
"is this test redundant?" questions and routine test maintenance during a
change stay host-native and do not enter this Skill.

- `imm-test-prune audit`: read-only. Produce the manifest and stop.
- `imm-test-prune`: produce the manifest, then wait for exact manifest
  approval before any mutation.
- An optional path argument narrows inventory to the named test files or
  directories. The evidence rules still read the whole repository.

No automatic invocation. No daemon, no cron, no CI gate, no allowlist, no
runtime, no persistent report, no dependency installation, and no automatic
commit.

## Ordered Pruning Protocol

### Inventory and Manifest

1. **Establish repository safety.** Mutation requires a Git worktree. A
   non-Git repository or an untracked candidate is audit-only. For each
   candidate, record:
   - path;
   - blob/content hash;
   - tracked status;
   - candidate-local worktree status;
   - line count;
   - test-case count.

   Unrelated dirty files do not block the run; a dirty candidate is `BLOCKED`.

2. **Discover the repository's commands.** Read existing scripts, task files,
   CI configuration, and runner configuration to identify the following,
   without installing anything:
   - the test command;
   - its single-file and single-test selection syntax;
   - its coverage command and report format;
   - the static checks a contributor runs locally.

   Record the result as the coverage capability:
   - `isolated`: coverage can be collected for one selected test;
   - `file`: coverage can be collected only for one test file;
   - `unavailable`: no coverage tool is already configured or installed, or
     collection fails.

   Never add a coverage tool, plugin, or configuration to obtain coverage.

3. **Record the baseline.** Run the discovered test command over the
   inventoried scope once and record pass/fail per file and wall time. A file
   already failing at baseline is `BLOCKED` for mutation and reported. This
   Skill never repairs or deletes a failing test to make the suite green. When
   coverage capability is not `unavailable`, also record baseline line
   coverage for the source files the candidates exercise.

4. **Inventory tests and support code.** Enumerate tracked test files,
   fixtures, helpers, and snapshots. Exclude dependency, vendor, build-output,
   and cache trees.

5. **Classify test roles.**
   - behavior: asserts runtime or public-surface behavior;
   - documentation contract: asserts document existence, wording, links, or
     sections;
   - packaging and mirror consistency: asserts that registries, generated
     output, and packaged copies agree;
   - historical evidence: protects readers of frozen or archived records;
   - `UNCLASSIFIED`: grouped, not interrogated file by file.

   Historical-evidence and packaging-consistency tests are `KEEP` unless the
   protected reader or consumer is proven retired.

6. **Mechanically narrow candidates.**
   - Find structurally identical cases that differ only in literal inputs.
   - Find repeated setup blocks across cases or files.
   - Find hard-coded lists that duplicate a canonical registry or manifest.
   - Find assertions whose subject (symbol, path, command, or public surface)
     no longer exists in current source.
   - Find orphaned fixtures and helpers with no remaining importer.
   - Find tests that assert private implementation detail where a
     public-surface assertion already covers the same behavior.

7. **Apply evidence rules.** Age, file length, test count, and intermittent
   failure alone never prove a test redundant.

   `DELETE` requires one of the following:
   - **Retirement**: the protected behavior is retired, with the retiring
     commit or a current owner showing it removed.
   - **Subsumption**: a named surviving test covers the same behavior with
     equal or stronger assertions, and coverage evidence supports it. With
     `isolated` or `file` capability, the surviving test's covered lines must
     be a superset of the removed test's covered lines. Collect this only for
     candidate entries, at the finest available granularity.

   Line coverage is necessary, not sufficient: the assertion comparison is
   still required.

   A subsumption claim is `UNVERIFIED` and not mutable when any of these holds:
   - coverage capability is `unavailable`;
   - collection fails;
   - repeated runs disagree.

   A `MERGE` that drops any case follows the same subsumption rule. `MERGE` and
   `PARAMETERIZE` that keep every distinct input and assertion need no coverage
   evidence.

   `RELAX_TO_STRUCTURE` is allowed only where the asserted text is not a
   machine contract consumed by code, a host, or a packaged surface.

8. **Produce one exact manifest.** State the discovered commands and coverage
   capability first. Classify each entry as one of:
   - `MERGE`
   - `PARAMETERIZE`
   - `EXTRACT_HELPER`
   - `DERIVE_FROM_SOURCE`
   - `RELAX_TO_STRUCTURE`
   - `DELETE`
   - `KEEP`
   - `BLOCKED`
   - `BLOCKED_ACTIVE_SCOPE`
   - `DEFER_DOC_PRUNE`
   - `UNVERIFIED`

   Each entry includes:
   - evidence;
   - the exact file, case, or helper action;
   - for every `DELETE`, the retirement proof, or the surviving owner with its
     coverage evidence;
   - the expected change in case count and line count;
   - the candidate hash.

   Group `UNCLASSIFIED` files.

9. **Gate mutation.** `audit` mode stops after the manifest. Mutation mode
   also stops until the literal user approves exact manifest entries (for
   example, "all recommendations except 4 and 7"). Broad approval such as
   "clean up the tests" is insufficient. Interruption starts a fresh scan; no
   manifest is persisted.

### Approved Mutation

10. **Revalidate and mutate minimally.** Before each approved change, re-read
    the candidate bytes, Git status, importers, and active scope. Drift blocks
    that item. Apply one manifest entry at a time, then run that entry's
    focused tests before the next. A failing focused check stops further
    mutation and leaves the inspectable diff.

## Mutation Envelope

This Skill may modify, merge, parameterize, or delete approved test files,
fixtures, helpers, and snapshots, and may add shared helpers beside the
repository's existing test helpers. It must stop when completion requires
changing any of the following:
- production source;
- public API;
- package exports;
- registries or generated output;
- dependencies, lockfiles, or coverage configuration;
- credentials or network writes;
- Git history;
- any Managed authority mutation.

**Never weaken a live guarantee.** Never do any of the following to make a
check pass or to reduce counts:
- skip, focus, or mark a test pending;
- loosen an assertion's strength (exact to partial, equality to existence,
  specific error to any error);
- widen a timeout;
- delete a negative assertion that still guards a live boundary.

Snapshot updates are allowed only for cases whose structure the approved entry
changed, never as a blanket refresh.

## Verify and Report

11. **Verify and report.**
    - Re-run every touched test file plus the baseline scope, the discovered
      static checks, and `git diff --check`.
    - The baseline pass set must be preserved: every previously passing
      behavior keeps a passing owner.
    - When coverage capability is not `unavailable`, re-collect line coverage
      for the baseline's source files. Any decrease blocks the run: name the
      responsible entry and leave the diff for the user. Report coverage as
      unavailable rather than inferring it.
    - This Skill does not commit.
    - Report only these sections:
      - `Changed` (with entry IDs);
      - `Deleted` (each with its retirement proof, or its surviving owner and
        coverage evidence);
      - `Blocked`;
      - `Deferred to imm-doc-prune`;
      - `Unverified`;
      - `Delta` (case count, line count, wall time, and line coverage before
        and after, or `coverage unavailable`);
      - `Verification`;
      - `Recovery: git log -- <path>`.

## Recovery

Git history is the archive for removed tests. Every `DELETE` entry reports
`Recovery: git log -- <path>`. Untracked, dirty, baseline-failing, or non-Git
candidates are never mutated.
