# Spec: UI i18n Review Lens

## Background

`imm-ui-review` already covers accessibility, responsive layout, UX heuristics,
and visual polish. It does not yet have a deterministic way to notice
internationalization and localization risk. UI changes that touch locale
resources, translation APIs, long translated strings, RTL layouts, or
localized theme assets can pass ordinary UI review while still breaking real
users in non-default languages.

This slice adds a first-class `ui_i18n` advisory lens under the existing
`imm-ui-review` host. The lens must stay read-only and advisory-only, using the
same Activation Plan and `imm-advisory-reviewer` dispatch pattern as the other
UI lenses.

## Requirements

### R1. i18n Checklist Source

Create `docs/reference/i18n-review-checklist.md` as the thin index for i18n and
theme-aware localization review. It must define:

- hardcoded user-facing string checks
- translation interpolation versus string concatenation checks
- text expansion, wrapping, truncation, and overflow checks
- RTL direction, mirroring, and alignment checks
- locale-aware date, number, currency, plural, and list formatting checks
- localized asset and light/dark theme legibility checks
- false-positive exclusions for technical literals, logs, test names,
  analytics keys, API fields, fixtures, and internal constants
- P0-P3 severity guidance and evidence expectations

### R2. `ui_i18n` Activation Plan Lens

Add `ui_i18n` to the host-bound Activation Plan contract for `imm-ui-review`.
The lens must be selected deterministically from changed paths and task
summary, not from LLM-only routing.

Trigger examples include:

- locale or translation resource paths such as `locales/`, `i18n/`, `lang/`,
  `messages/`, and translation `.json` files
- translation APIs such as `t(`, `useTranslation`, `Trans`, `Intl.*`,
  `formatMessage`, and plural/list/date/number formatting calls
- task keywords such as `i18n`, `l10n`, `locale`, `translation`, `RTL`,
  `right-to-left`, `localized asset`, and `hardcoded text`

The lens order must be documented with the other `imm-ui-review` lenses so
parallel caps remain deterministic.

### R3. Host Skill Tailoring

Update `plugins/immune-brain/dist/imm-ui-review.md` so the host:

- names `ui_i18n` as a specialist advisory lens
- dynamically loads `docs/reference/i18n-review-checklist.md` when the change
  surface matches i18n or localization context
- includes the checklist mapping in the Delegation Packet for i18n specialist
  dispatch
- keeps i18n review within `ui_review` output instead of creating a separate
  skill or artifact

### R4. Regression Coverage

Add tests that prove the lens is discoverable and useful:

- standalone `ui_i18n` keyword trigger
- standalone locale resource path trigger
- combined component change that can include `ui_i18n` without destabilizing
  the UI lens ordering or max parallel cap
- policy and output-schema text include `ui_i18n`
- checklist contract includes false-positive exclusions and severity guidance
- host skill references the checklist and `ui_i18n` lens

## Decisions

- Keep `imm-ui-review` as the single host. Do not create `imm-i18n-review`.
- Add `ui_i18n` as a real Activation Plan lens, not only a prose-only checklist.
- Keep translation semantic quality review out of scope; this lens checks UI
  usability, rendering, formatting, and implementation hygiene.
- Keep fully automated pixel-level multilingual screenshots out of scope for
  this slice.

## Acceptance Criteria

- `docs/reference/i18n-review-checklist.md` exists and covers every R1 category.
- `docs/reference/subagent-trigger-catalog.yaml` contains `ui_i18n` under
  `imm-ui-review`.
- Activation policy/output docs include `ui_i18n` in allowed lens lists,
  ordering, and rationale code examples.
- `plugins/immune-brain/dist/imm-ui-review.md` references the checklist and
  describes when to load it.
- `python3 -m unittest tests.test_activation_plan tests.test_skill_contracts`
  passes.
- `python3 .imm/activation_plan.py --host imm-ui-review --changed-path app/locales/en.json`
  returns a plan containing `ui_i18n`.
