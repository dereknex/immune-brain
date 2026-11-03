# Legacy config hints

**Status**: candidate, direct Planner entry on 2026-11-03 for Issues #369 and #370. This document grants no execution authority.
**Task**: `legacy-config-hints` (one TaskIntent, no Initiative).
**Planning baseline**: `2faefe0`. Recheck the affected paths if HEAD changes before Enrollment.
**Document language**: English. User discussion stays in Chinese.
**Design risk**: Medium. The change touches two contracts that read the same legacy sources: the runtime's `deprecated_config_source` / `legacy_source_ignored` diagnostic text in `layered_config.ts`, and the Planner's carrier resolution in `dist/draw-up.md`. No resolution order, precedence, persisted shape, authority gate or machine field (`code`, `severity`, `file`, `key_path`) changes.
**Design views**: component interfaces.
**Threat model and supported environment**: none beyond the repository's own tooling. The inputs are the maintainer's user file, the tracked project file and the legacy files already read by `resolveConfig`; this change only alters the text of warnings built from fixed strings and the resolved user file path. Supported: macOS and Linux, Bun 1.4.

## Outcome

1. Every `deprecated_config_source` and `legacy_source_ignored` warning names its replacement key together with its layer and that layer's file, matching the layered-config D9 table. The `.imm/decision-bindings.json` warning names both of its targets: user `decision_models` and project `decision_models.egress`. (#369)
2. The Planner's carrier resolution uses an `initiative_carrier` value whose source is `legacy:AGENTS.md` or `legacy:CLAUDE.md` like any other resolved value, reports that source, and passes on its deprecation warning. The user guide says the same. (#370)

## Sources

| ID | Source |
| --- | --- |
| I369 | Issue #369: the warning reads `<file>: <key>: deprecated; use this replacement key`, names no layer or file, and the decision-bindings call passes only `decision_models`. `legacy_source_ignored` has the same gap. |
| I370 | Issue #370: layered-config D9 reads the tracked `AGENTS.md`/`CLAUDE.md` carrier directive for one major version, but `dist/draw-up.md` step 2 tells the Planner to ignore a `legacy:` value. |
| E1 | `plugins/immune-brain/runtime/config/layered_config.ts:121-124` (`legacy` helper) builds both warnings with a fixed sentence; `:20-22` (`diag`) prefixes `<file>: <key_path>: `; `:24-25` hold `userPath` and `projectPath`; calls at `:136-138` and `:180-181`. |
| E2 | `docs/specs/layered-config.spec.md:171-183` (D9 table): replacement keys are user `lanes`, user `decision_models.profiles`, user `decision_models` / project `decision_models.egress`, project `git_integration`, project `initiative_carrier`. |
| E3 | `plugins/immune-brain/dist/draw-up.md:229-231` step 2 ends "ignore a `legacy:AGENTS.md` or `legacy:CLAUDE.md` repository directive". `docs/reference/immune-brain-config.md:140-143` repeats it. |
| E4 | `plugins/immune-brain/runtime/git_integration_preference.ts:20` already accepts a `legacy:` `git_integration` source, so the carrier is the only consumer that drops one. This closes #370's "not verified" note. |
| E5 | `tests/layered-config.test.ts:123-166` asserts warning `code`, `file` and `key_path` but not the message text, and `:157` pins `key_path` equal to the replacement key. |

## User scenarios

| ID | Actor | Given | When | Then | Mode | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| SCN-1 | maintainer | a repository with `.imm/lanes.local.json` and no user `lanes` | they run `imm-kernel config --json` | the warning says to move the value to user `lanes` in their user file and shows that file's path | automated | AC1 |
| SCN-2 | maintainer | a repository with no `initiative_carrier` in `.imm/config.json` or the user file and `- Initiative carrier default: github` in its tracked `AGENTS.md` | they ask draw-up for an Initiative | draw-up uses `github`, names the source `legacy:AGENTS.md` and says the directive is deprecated | manual | — |

SCN-1 is sourced from I369 and SCN-2 from I370, both on direct Planner entry. SCN-2 is manual because it is Planner model behaviour; AC3 pins the contract text the Planner follows, which is not proof the model obeys it.

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D1 | **Target format.** A target is `<layer> \`<key>\` in <file>`, where layer is `user` or `project`, file is the resolved user file path (`userPath`, which honours `XDG_CONFIG_HOME` and `options.userConfigPath`) or `.imm/config.json`. Two targets are joined with ` and `. | I369, E1, E2 |
| D2 | **Messages.** `deprecated_config_source` reads `deprecated; move to <targets>`. `legacy_source_ignored` reads `ignored because a newer layer sets this section; its replacement is <targets>`. The `<file>: <key_path>: ` prefix stays. Exact wording is a delegated technical choice; the acceptance pins the targets, not the verbs. | I369, E1 |
| D3 | **Targets per source.** `.imm/lanes.local.json` → user `lanes`. `.imm/decision-models.local.json` → user `decision_models.profiles`. `.imm/decision-bindings.json` → user `decision_models` and project `decision_models.egress`. `AGENTS.md`/`CLAUDE.md` `Git integration` → project `git_integration`. `AGENTS.md`/`CLAUDE.md` `Initiative carrier default` → project `initiative_carrier`. | E2 |
| D4 | **Machine fields unchanged.** `code`, `severity`, `file` and `key_path` keep today's values; for decision bindings `key_path` stays `decision_models`. Only `message` changes, so `status` consumers and the existing `key_path` assertion keep working. | E5 |
| D5 | **Planner step 2.** `dist/draw-up.md` step 2 uses `initiative_carrier.value` and reports its `source` whether it is `project`, `user`, `user:project` or `legacy:<path>`. For a `legacy:` source it also reports the `deprecated_config_source` warning that names the replacement. The "ignore a `legacy:` … directive" clause is removed. Steps 1, 3 and 4 and the invalid-value rule are unchanged. | I370, E3 |
| D6 | **User guide.** `docs/reference/immune-brain-config.md` "Legacy Sources" says a warning names the replacement key with its layer and file, and that the Planner uses a `legacy:AGENTS.md` or `legacy:CLAUDE.md` carrier with its deprecation warning. The packaged mirror `plugins/immune-brain/dist/docs/reference/immune-brain-config.md` stays byte-identical. | I369, I370, E3 |
| D7 | **Release.** One patch changeset for `immune-brain`, and the Claude bundle `dist/claude/mcp-server.mjs` is regenerated. | delegated technical choice; `docs/agents/derived-files.json` |

## Technical Design

### Component interfaces

- **`resolveConfig(root, options)`** (`layered_config.ts`), caller-owned output `immune_brain/effective_config/v1`. The `legacy(path, replacement, used)` helper gains the targets it prints: it takes a list of `{ layer, key }` targets instead of one key, uses the first target's key as `key_path` (D4), and renders the message per D1–D2 from `userPath` or `projectPath`. No caller outside `layered_config.ts` calls the helper. Consumers that read `diagnostics` (`imm-kernel config --json`, `status` on both Hosts, the Planner, `git_integration_preference.ts`) read `message` as display text only; none parses it (E4 and the consumer search in Discovery evidence).
- **Planner carrier resolution** (`dist/draw-up.md` "Initiative Carrier Preference"): input is the `initiative_carrier` leaf and its diagnostics from `imm-kernel config --json`; output is the selected carrier with its source line. A `legacy:` value is now an accepted output, never a fall-through to step 3. Error behaviour is unchanged: an invalid value asks; a failed command inspects diagnostics and asks.

## Devil's Advocate Audit

- **Rollback resilience**: one commit. Reverting it restores the old sentence and the "ignore legacy" Planner step; no persisted state or field shape depends on the new text.
- **Verification vanity**: AC1 asserts each message contains its own targets and not the other layer's file: the Lane preset message must not name `.imm/config.json`, the Git directive message must not name the user file, and the decision-bindings message must name both. A bound control sets `options.userConfigPath` to a fixture path and requires that path in the message, so a hard-coded `~/.config/...` string fails. AC2 asserts the same targets on `legacy_source_ignored`. AC3 asserts the "ignore a `legacy:`" clause is gone and step 2 names `legacy:<path>` with the deprecation warning, so restoring the clause fails it. The user-guide mirror is checked byte for byte.
- **Spec dilution**: I369 maps to D1–D4, AC1, AC2; I370 maps to D5, AC3; both map to D6, AC4. Nothing is deferred.

## Acceptance mapping

| ID | Seam | Decisions |
| --- | --- | --- |
| AC1 | `tests/layered-config.test.ts` — `resolveConfig` diagnostics for each legacy source when it is used | D1–D4 |
| AC2 | `tests/layered-config.test.ts` — the same sources when a newer layer replaces them | D1–D4 |
| AC3 | `tests/carrier-enrollment-gate-contract.test.ts`, `tests/plugin-package-runtime.test.ts` — Planner carrier section text | D5 |
| AC4 | `tests/pi-only-current-contracts.test.ts` — user guide "Legacy Sources" text and mirror identity | D6 |
| AC5 | `bun scripts/build-claude-plugin.ts --check && bun run typecheck` | D7 |

## Discovery evidence

- Warning builder and calls: `layered_config.ts:20-25,121-138,175-183`.
- Consumers of the diagnostics: `plugins/immune-brain/runtime/git_integration_preference.ts:20` reads `source`, not `message`. The other matches for the two codes are tests, Specs, intents and audit records.
- Planner text: `plugins/immune-brain/dist/draw-up.md:219-245`. It is an owned packaged contract with no mirror (`scripts/dist-sync-manifest.ts:128-133`).
- User guide: `docs/reference/immune-brain-config.md:124-143`, mirrored to `plugins/immune-brain/dist/docs/reference/immune-brain-config.md` (`scripts/dist-sync-manifest.ts:32`).
- Test prior art: `tests/layered-config.test.ts:123-166` (legacy sources), `tests/carrier-enrollment-gate-contract.test.ts:20-36` (carrier order), `tests/plugin-package-runtime.test.ts:573-596` (packed carrier text), `tests/pi-only-current-contracts.test.ts:73-86` (user guide legacy table and mirror).

## Out of scope

- Changing which layer wins or when a legacy source is ignored, including the all-or-nothing ignore of `.imm/decision-bindings.json` when only one half is replaced.
- Removing the legacy sources (deferred to the next major by layered-config D9).
- The user-level Host instruction-file carrier directive (Planner step 3), which is unchanged.
