---
status: accepted
---

# The Risk Floor Is Declared By The Project

Accepted on 2026-10-13 by the repository owner (user decision U3 in
`docs/specs/host-owned-environment.spec.md`), for Issue #225.

## Context

`parseTaskIntentV1` raised a declared risk to `material` whenever the scope
reached one of nine path prefixes compiled into the runtime, and
`classifyTaskRisk` did the same for changed paths plus `docs/specs` and
`docs/plans`. Every prefix named a directory of this repository. In any other
project the list matched nothing, so that project had no floor at all, while a
project that happened to keep its own files under `docs/plans` was raised for a
reason that did not apply to it. The floor also lived inside the strict parser,
so a pure syntax check carried a policy decision.

## Decision

1. **The floor leaves the parser.** `parseTaskIntentV1` returns the declared
   risk. The floor is applied where a risk is decided by a caller that knows
   the project root: `parseProjectTaskIntent` and `readTaskIntent` for a
   candidate, `resolveProjectedRisk` for an enrolled task's current gating,
   `classifyIntentRevision` for a revision, and `classifyTaskRisk` for changed
   paths.
2. **The project declares it in one tracked file, `.imm/risk-floor.json`.** It
   holds a `material` and a `critical` tier. Each tier has `paths`, which raise
   a task through its scope or its changed paths, and `changed_only`, which
   raise a task through its changed paths alone. `runtime/kernel/risk_floor.ts`
   owns the format, the reader and both path policies.
3. **A missing declaration means no floor.**
4. **An untrusted declaration makes every task `critical`.** That covers a
   file that is invalid JSON, has an unknown field or a wrong type, is not a
   regular file, is larger than 64 KiB, cannot be read, or differs from what is
   committed. The reader compares the bytes it parses with the regular blob
   in `HEAD`; an empty `git status` alone cannot establish trust because index
   flags can hide worktree changes.
5. **The declaration's own path is always `critical`**, through scope or
   through changed paths, whatever the file contains.
6. **This repository's declaration carries the two former lists unchanged**:
   the nine prefixes as `material.paths`, and `docs/specs` and `docs/plans` as
   `material.changed_only`.
7. **An enrolled intent keeps its hash and its risk.** The canonical hash of a
   recorded intent is computed from the risk it was recorded with, and that
   risk is the same before and after the move. Readers of an enrolled revision
   receive the TaskRecord's snapshot and preserve its risk when hashing the
   sidecar. Current declaration policy is applied separately to projected
   gating, including scope paths that have not changed. A TaskRecord is not
   re-graded when the declaration changes.

## Consequences

- A project other than this one now has no floor until it declares one, and
  can declare paths this runtime never knew about, including a `critical` tier.
- A broken or half-edited declaration blocks nothing but raises every task to
  `critical` until it is repaired and committed. The reason is reported by
  `imm-kernel inspect --json` as `risk.floor_invalid`.
- Changing the floor is itself a `critical` task, so it always carries a
  human approval.
- The functions that decide a risk take the floor as a parameter. A caller with
  no project root passes no floor and gets the declared risk.
- The same-directory scope rule of ADR 0021 refuses an addition on any path the
  declaration names, in either tier and either list, in place of the former
  constant.

## Rejected

- Keeping the list in the runtime and letting a project extend it: the built-in
  entries would still be wrong for every other project.
- Reading the floor from `AGENTS.md` or `CLAUDE.md`: the Executor edits those
  files as prose, and a parse miss would silently drop the floor.
- Treating an invalid declaration as no floor: a typo would silently remove
  the gating the project asked for.
