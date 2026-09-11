# Spec: Public Review Retro Skill

**Task ID**: `imm-review-retro`
**Owner**: user
**Status**: Candidate
**Output Language**: English prose; preserve skill names, CLI flags, paths, schema keys, and code identifiers literally.
**Design risk**: Medium
**Design risk rationale**: Adds a seventh public Skill and a shipped analyzer across registry, packaged contracts, npm pack contents, and current-facing docs. No Kernel, TaskRecord, or Managed Path authority change.
**Diagram decision**: not_required
**Diagram reason**: Ownership is a file enumeration plus one JSONL-to-stdout data flow; prose and the CLI contract are sufficient.

## Outcome

Ship `imm-review-retro` as a public, standalone, host-native Skill. Users invoke it to rank models by how much code review their own edits triggered and to report basic project usage over a look-back window. The Skill is read-only on `~/.pi/agent/sessions` logs. It does not enter Managed Path and does not write session logs, `.imm/` state, Specs, or TaskIntents.

## Brainstorm Trace

| ID | Coverage |
| --- | --- |
| `BR-REQ-1` | A2. Register `imm-review-retro` in `skills/registry.yaml` and package it with an owned dist contract. Description states cross-model review analysis plus project-usage retro. |
| `BR-REQ-2` | A1. Preserve the existing counting 口径 (reviews, uniq, rev/100ed, avgSc, pass%, findings split, rounds/task, project table). Changing 口径 requires updating the fixture test. |
| `BR-REQ-3` | A1. Add sessions, turns, edits, tool-call distribution, and top projects. |
| `BR-REQ-4` | A1. Default scan is the user's full session-log tree; `--project` scopes by cwd substring. Document this in the Skill contract. |
| `BR-REQ-5` | A1/A2. TypeScript analyzer is typechecked; focused bun tests lock 口径 and packaging; a patch changeset names the Skill. |
| `BR-DEC-1` | A1. Implement as TypeScript, not the personal python script. |
| `BR-DEC-2` | A1. Erasable TypeScript using `node:` APIs only, runnable by `bun` and Node ≥23.6 with type stripping. No new emit pipeline. |
| `BR-OUT-1` | Excluded. No Compounder or scheduled/cron integration. |
| `BR-OUT-2` | Excluded. No `.imm/audit/` lifecycle statistics. |
| `BR-DEFER-1` | Deferred. No cross-window snapshot persistence. Revisit when the user needs week-over-week diffs. |

No unresolved `BR-Q-*`.

## Discovery Evidence

- Personal prototype: `~/.pi/agent/skills/review-retro/SKILL.md` and `scripts/review_retro.py`. Counting rules live in that script header. Out of repository scope; do not delete or modify the personal copy.
- Public Skill packaging: `plugins/immune-brain/skills/registry.yaml` is canonical; `scripts/sync-dist-docs.ts` mirrors it to `plugins/immune-brain/dist/registry.yaml` and regenerates the README role map. `scripts/dist-sync-manifest.ts` `SKILL_OWNED_ENTRIES` lists owned `dist/imm-*.md` contracts. `publicSkills()` in `tests/skill-dist-consistency.test.ts` discovers directories whose names start with `imm-`.
- Hardcoded six-Skill lists that must gain the seventh name: `tests/skill-dist-consistency.test.ts`, `tests/claude-host-package.test.ts`, `plugins/immune-brain/tests/skill-registry-consistency.test.ts`, `tests/pi-canary-packed-loader.test.ts` (pack required files), `tests/direct-first-routing-contract.test.ts` (README standalone-skill sentence).
- `package.json` `files` already includes `plugins/immune-brain/skills` and `plugins/immune-brain/dist`, so a new skill directory ships. `tsconfig.json` `include` currently omits `skills/**/*.ts`; the analyzer will not typecheck until that glob is added.
- Node 24 (mise) type-strips `.ts` without enums/namespaces. `tsconfig.json` is `noEmit: true`. Do not add a compile step.
- Current-facing six-Skill copy: `CONTEXT.md` Architecture Map, `IMMUNE.md`, `plugins/immune-brain/README.md`, `plugins/immune-brain/USER_GUIDE.md`, `docs/user_manual.md`, `docs/reference/immune-brain-skills-guide.md`, root `README.md` / `README.zh-CN.md`. Managed Path remains the three entries `imm-brainstorm` / `imm-planner` / `imm-loop`.

## Technical Design

**Design views**: Architecture layers (Skill loader, owned contract, analyzer, packaging) and data flow (JSONL → counters → stdout) are relevant. State transitions and temporal sequence are omitted: the Skill is a single-shot read-only CLI with no persisted workflow state.

### Layers And Ownership

| Layer | Owner | Must not |
| --- | --- | --- |
| `skills/imm-review-retro/SKILL.md` | Compact loader. Explicit-entry description. Routes into the owned dist contract. | Become a Managed Path entry or a second contract. |
| `dist/imm-review-retro.md` | Owned contract (authoring source). Invocation, counting 口径, CLI, report order, caveats. | Depend on Kernel tools or `.imm/` writes. |
| `skills/imm-review-retro/scripts/review_retro.ts` | Analyzer. Stdlib/`node:` only. | Import runtime/kernel modules or write files. |
| Registry + dist-sync + pack tests | Public surface. | Treat the Skill as an internal role. |

### Analyzer Contract

Invocation (agent runs this; users do not type it):

```
bun "<skill-dir>/scripts/review_retro.ts" <days> [--root <sessions-dir>] [--project <substr>] [--top N]
```

`node` with type stripping is an allowed equivalent. `days` is required and must be `> 0`.

Preserve these counting rules from the python prototype:

- `review` = `Agent` toolCall with `subagent_type == "Review"`, attributed to the most recent `edit`/`write`/`multiedit` model in that session (`no-edit (review-only)` when none).
- `kernel:submit_review` is reported separately and never added into `reviews`.
- `avgSc` / `pass%` parse `[SCORE: …]` / `[VERDICT: …]` tags from the matching Review `toolResult`.
- Findings = `imm_kernel_canary` `record_finding`, deduped per session; summaries matching the bookkeeping regex split out of blocking/advisory.
- `--project` keeps sessions whose `cwd` contains the substring; default is unfiltered.

Add usage metrics on the same pass: session count with activity, assistant turns, edit counts, tool-call name histogram, and the existing project × author table.

Stdout order: window/口径 header, ranked model table (including scores), usage section (sessions/turns/edits/tool mix), quality & scores, project table, rounds/task, caveats. Header lines remain the comparable 口径; the Skill report reads them aloud.

Failure: skip malformed JSONL lines; `days <= 0` exits non-zero; missing `--root` uses `~/.pi/agent/sessions`. The analyzer writes only stdout/stderr.

### Packaging And Docs

- Registry `role: execute`, `role_class: discovery`, `next_actions: []`, non-empty boundary stating read-only logs and no Managed mutation.
- Loader description contains `Immune-Brain`, no CJK, and does not match the dist-consistency forbidden token regex. Routes are section links into the owned contract (`common` plus at least one more), each with an anchor, no ` through `.
- Owned dist contract is self-contained, larger than 2× the loader, and frontmatter `name`/`description` match the loader.
- `SKILL_OWNED_ENTRIES` gains `imm-review-retro.md`. Hardcoded six-name arrays become seven. Test titles that say "six" are renamed; they must not keep asserting a closed set of six.
- Current-facing docs say seven public Skills: three Managed Path + four standalone host-native (`imm-pr-fix`, `imm-doc-prune`, `imm-agent-doc-maintain`, `imm-review-retro`). Do not add `imm-review-retro` to Managed Path start rules.
- Patch changeset for package `immune-brain`.

### Boundaries And Compatibility

- Not a Managed Path Skill. Ordinary host questions about "which model is worse" stay host-native unless the user explicitly invokes `imm-review-retro`.
- Does not scan repositories other than session JSONL. `--project` is the only default narrowing.
- Does not replace `code-review`. The Skill reviews no diff.
- Personal `~/.pi/agent/skills/review-retro` is left in place.
- No compatibility shim, no python remainder in this repository, no new dependency.

## Acceptance And Verification

| ID | Required evidence | Focused descriptor |
| --- | --- | --- |
| A1 | Fixture JSONL replay preserves review attribution, uniq vs reviews, rev/100ed, score/verdict parsing, findings split, submit_review separation, `--project` filtering, and the new usage counters (sessions, turns, edits, tool histogram, top projects). | `bun test tests/review-retro-analyzer.test.ts` |
| A2 | Registry, owned dist contract, dist-sync manifest, and hardcoded public-Skill lists publish `imm-review-retro` as the seventh Skill; loader/dist frontmatter and section routes satisfy existing packaging guards; a patch changeset names the Skill. | `bun test tests/skill-dist-consistency.test.ts tests/claude-host-package.test.ts plugins/immune-brain/tests/skill-registry-consistency.test.ts` |
| A3 | Packed package contains the Skill loader, analyzer script, and dist contract; current-facing routing copy keeps Managed Path as the three entries and names `imm-review-retro` as standalone host-native. | `bun test tests/pi-canary-packed-loader.test.ts tests/direct-first-routing-contract.test.ts` |

Extend the listed existing tests; do not weaken them. A1 uses a tiny committed JSONL fixture under `tests/fixtures/review-retro/`, not live `~/.pi/agent/sessions`. Descriptors use Bun 1.3.14, 30-second bounds, and 32 KiB output. Deterministic QA runs them after implementation. Implementation verification also includes `bun run typecheck` and `bun scripts/sync-dist-docs.ts --check` outside these descriptors.

## Scope

Editable: the new Skill directory and owned dist contract; registry + dist-sync manifest + `tsconfig.json` include glob; the listed packaging/routing tests and the new analyzer test/fixture; current-facing Skill-count copy listed in Discovery Evidence; this Spec's active and archive paths; the TaskIntent active and archive paths; one patch changeset.

Not editable: Kernel, TaskRecord, Enrollment, Loop dispatch, Compounder, `.imm/` layout, the personal python skill, historical archives, and any session-log files.

## Devil's Advocate Audit

- **Rollback resilience**: Delete `skills/imm-review-retro/` and `dist/imm-review-retro.md`, revert registry/manifest/docs/tests/tsconfig/changeset, regenerate dist registry and the README role map. No persisted authority changes. A partial add that leaves a directory without a registry row fails `skill-registry-consistency` (orphan SKILL.md).
- **Verification vanity**: A1 must fail if attribution, `--project`, or findings split regress, not merely if the script prints a table. A2/A3 must fail if the seventh name is missing from a closed list or if the analyzer is omitted from the packed tarball.
- **Spec dilution detection**: Do not fold this Skill into `imm-loop`, do not scan `.imm/audit/`, do not add scheduling, and do not keep a python copy in this repository as a dual implementation.
