# Retire Public Skill Aliases

**Status**: Completed on 2026-08-15 (Kernel QA and Review passed; one
Review rework resolved for `user_manual`/`IMMUNE` alias advertising)
**Task**: `2026-08-15-023-retire-public-skill-aliases`
**Roadmap**: `docs/specs/host-native-lightweight-workflow-roadmap.spec.md`, Phase 5 R4
**Output Language**: English prose; preserve skill names, registry keys, paths, and mode identifiers literally.
**Design risk**: Material - retires four public Skill compatibility entries (`debug-investigator`, `imm-page-design`, `imm-party`, `imm-preplan-review`) across registry, packaged docs, current-facing references, and contract tests; canonical skills already expose the same modes, and this task migrates the remaining behavior contracts into canonical docs before deletion. No runtime, Kernel, or authority change.
**Diagram decision**: not_required
**Diagram reason**: The change is a bounded alias retirement with a fixed file enumeration and canonical-doc migration; the consumer graph is enumerated in Scope.

## 1. Problem

Four Skill names remain as public compatibility entries even though the
canonical skills already expose the identical modes:

| Alias | Canonical | Mode |
| --- | --- | --- |
| `debug-investigator` | `imm-advisory-reviewer` | `debug_hypothesis` |
| `imm-page-design` | `imm-planner` | `page_design` |
| `imm-party` | `imm-brainstorm` | `roundtable` |
| `imm-preplan-review` | `imm-brainstorm` | `adversarial` |

The canonical docs already say "replaces the `imm-party` entry",
"replaces the `debug-investigator` entry", etc. The alias registry entries,
SKILL.md forwarding stubs, and packaged `dist/*.md` copies remain as dead
entry points that duplicate routing that canonical skills already document.
Two behavioral contract fragments (`Ask one question at a time` and
`provide a recommended answer`) exist only in the `imm-preplan-review` alias
doc and must move into the canonical `imm-brainstorm` adversarial-mode
contract before the alias is deleted.

## 2. Goal

- Delete the four alias registry entries, their SKILL.md stub directories,
  and their packaged `dist/*.md` copies.
- Migrate the two adversarial-behavior fragments into canonical
  `dist/imm-brainstorm.md`.
- Update canonical skill docs, current-facing reference docs, user-facing
  manuals, and the three contract tests to the canonical mode expressions.
- Regenerate `dist/registry.yaml` and the README role map via the sync
  script.
- Leave historical evidence (brainstorms, plans, solutions, archived specs,
  `docs/archives/history.md`) untouched.

## 3. Scope

### 3.1 Delete

1. `plugins/immune-brain/skills/registry.yaml`: remove the four alias
   entries (`debug-investigator`, `imm-party`, `imm-preplan-review`,
   `imm-page-design`); update the `imm-brainstorm` entry's `next_actions`
   from `[imm-preplan-review, imm-planner]` to `[imm-planner]`.
2. `plugins/immune-brain/skills/{debug-investigator,imm-page-design,imm-party,imm-preplan-review}/SKILL.md` (4 stub directories).
3. `plugins/immune-brain/dist/{debug-investigator,imm-page-design,imm-party,imm-preplan-review}.md` (4 packaged copies).

### 3.2 Canonical doc updates

- `plugins/immune-brain/skills/imm-brainstorm/SKILL.md`: replace "(`roundtable` (the `imm-party` compatibility entry), and `adversarial` (the `imm-preplan-review` compatibility entry))" with plain mode names (the modes are canonical; compatibility entries are retired).
- `plugins/immune-brain/dist/imm-brainstorm.md`: same mode-name updates for the `roundtable`/`adversarial` references; add the adversarial question protocol ("Ask one question at a time when a dependency blocks the next decision, and provide a recommended answer with the question. It checks ...") to the adversarial-mode section.
- `plugins/immune-brain/dist/imm-advisory-reviewer.md`: `debug_hypothesis` lens description drops "replaces the `debug-investigator` entry" (entry retired) or rewrites it as "was the former `debug-investigator` entry" (past tense, optional).
- `plugins/immune-brain/dist/imm-planner.md`: `page_design` mode description drops "replaces the `imm-page-design` compatibility entry" or rewrites past-tense.
- `plugins/immune-brain/dist/imm-init.md`: drop "Use `imm-brainstorm`, `imm-preplan-review`, or `imm-planner`" in favor of canonical names.
- `plugins/immune-brain/skills/imm-planner/SKILL.md`: "formerly exposed as `imm-page-design`" stays (past-tense historical note) — verify only.

### 3.3 Current-facing docs

- `docs/user_manual.md`: replace the `imm-preplan-review` and
  `imm-page-design` table rows and workflow references with canonical
  `imm-brainstorm adversarial` / `imm-planner page_design` expressions.
- `IMMUNE.md`: replace `imm-preplan-review`, `imm-party` role paragraphs
  with canonical mode expressions (adversarial/roundtable).
- `plugins/immune-brain/USER_GUIDE.md`: remove the four alias rows from the
  compatibility table (or replace with a canonical-mode note).
- `docs/reference/immune-brain-skills-guide.md`: update the mode table
  (drop alias rows, adjust `imm-brainstorm` next_actions), remove the
  mermaid `Preplan[imm-preplan-review]` node and its edges, delete the
  deep-dive sections `### 8. imm-preplan-review`, `### 11.
  debug-investigator`, `### 13. imm-page-design`, `### 14. imm-party`,
  and correct the "18 个技能" count/heading (to 14).
- `docs/reference/planning-quality-gate.md` and
  `plugins/immune-brain/dist/docs/reference/planning-quality-gate.md`:
  replace "`imm-preplan-review`" with the canonical adversarial-mode
  expression.
- `docs/reference/workflow-and-subagents.md`: replace
  `imm-preplan-review` references with canonical adversarial mode.
- `docs/reference/subagent-remaining-work.md`: update the
  `debug-investigator` and `imm-party` tracking rows to retired status.
- `docs/reference/immune-brain-skill-details/README.md`: replace the
  `imm-page-design` entry with `imm-planner` `page_design` mode.
- `docs/reference/addy-agent-skills-contrast.md`: replace `imm-party`/
  `imm-preplan-review`/`debug-investigator` references with canonical
  mode expressions.
- `docs/reference/mattpocock-skills-contrast.md`: replace
  `debug-investigator` and `imm-preplan-review` (including the
  "Relentless Grilling Mode ... one question at a time with a recommended
  answer" paragraph) with the canonical `imm-brainstorm` adversarial
  expression.
- `docs/reference/upstream-pro-workflow-borrow-map.md`: replace the
  `imm-preplan-review` alignment note with the canonical adversarial mode.
- `plugins/immune-brain/README.md` role map: regenerated by
  `scripts/sync-dist-docs.ts`.

### 3.4 Contract tests

- `tests/skill-mode-consolidation.test.ts`: rewrite — assert the four
  aliases are absent from the registry and from `dist/`, assert canonical
  modes (`roundtable`/`adversarial`/`page_design`/`debug_hypothesis`) are
  declared on the canonical skills, and drop alias-specific mapping
  assertions.
- `tests/brainstorm-decision-probing-contract.test.ts`: replace the
  `PREPLAN` read of `dist/imm-preplan-review.md` with the canonical
  `dist/imm-brainstorm.md` read and keep the adversarial question-protocol
  assertions against it.
- `plugins/immune-brain/tests/authorization-phrase-consistency.test.ts`:
  remove `dist/imm-party.md` from `DISPATCH_HOSTS`.

### 3.5 Regeneration

- Run `bun scripts/sync-dist-docs.ts` to regenerate
  `plugins/immune-brain/dist/registry.yaml` and the README role map, then
  verify `--check` passes.

### 3.6 Out of scope

- Historical evidence: `docs/brainstorms/*`, `docs/plans/*`,
  `docs/solutions/*`, `docs/specs/*` (including
  `debug-investigator.spec.md`, `imm-party-*.spec.md`,
  `imm-page-design-expansion.spec.md`, `party-mode-advisory.spec.md`),
  `docs/archives/history.md`.
- Canonical skills (`imm-brainstorm`, `imm-planner`,
  `imm-advisory-reviewer`) behavior and modes.
- `imm-kernel`, Kernel, or Pi extension surface.
- The unfinished TUI breaking-revision payload path.

## 4. Contract

After this task:

- `rg -n "imm-page-design|imm-party|imm-preplan-review|debug-investigator"`
  under `plugins/immune-brain/` returns only: canonical docs mentioning the
  former entries in past tense, the registry next_actions (now
  `[imm-planner]` only), and historical packaged docs that remain in
  `dist/` (none of the four alias `dist/*.md` files exist).
- `tests/skill-mode-consolidation.test.ts` passes with alias-absence
  semantics.
- `bun scripts/sync-dist-docs.ts --check` reports no drift.
- Full repository suite passes.

## 5. Tests

- `bun test tests/skill-mode-consolidation.test.ts tests/brainstorm-decision-probing-contract.test.ts plugins/immune-brain/tests/authorization-phrase-consistency.test.ts`
  — updated contract tests.
- `bun scripts/sync-dist-docs.ts --check` — dist sync.
- `bun test plugins/immune-brain/tests/skill-registry-consistency.test.ts plugins/immune-brain/tests/host-manifest-consistency.test.ts tests/pi-canary-discovery-regression.test.ts tests/pi-canary-packed-loader.test.ts tests/pi-only-package-surface.test.ts`
  — registry/package surfaces.
- `bun test` — full regression.

## 6. Verification descriptors (TaskIntent)

1. Alias absence: the four alias registry entries, SKILL.md stub
   directories, and `dist/*.md` copies are gone.
2. Canonical migration: `dist/imm-brainstorm.md` contains the adversarial
   question protocol; `imm-advisory-reviewer.md`/`imm-planner.md`/
   `imm-init.md` use canonical mode expressions without alias entry
   references.
3. Current docs: user_manual, IMMUNE, USER_GUIDE, skills-guide (table,
   mermaid, deep-dive sections, counts), planning-quality-gate
   (source+dist), workflow-and-subagents, subagent-remaining-work,
   skill-details README, addy-agent-skills-contrast,
   mattpocock-skills-contrast, and upstream-pro-workflow-borrow-map use
   canonical mode expressions; no current-facing doc advertises an alias
   as an entry point.
4. Contract tests: the 3 updated test files pass.
5. Dist sync: `sync-dist-docs.ts --check` passes; dist/registry.yaml has no
   alias entries; README role map regenerated.
6. Full repository suite passes.
