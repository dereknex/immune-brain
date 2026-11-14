# User-level `git_integration` configuration

**Status**: Candidate; no execution authority.
**Document language**: English (repository default for Specs; user discussion remains Chinese).
**Design risk**: Medium — extends the shared `immune_brain/user_config/v1` schema, changes `resolveConfig` precedence for `git_integration`, updates `readGitIntegrationPreference` error/source attribution across status and delivery consumers, and updates packaged docs and plugin bundles.
**Design views**: service/component interfaces and data flow. Existing state transitions, architecture layers, and temporal sequences are unchanged.

## Outcome

Users can configure `"git_integration": "manual" | "auto"` at the top level of their user configuration file (`$XDG_CONFIG_HOME/immune-brain/config.json`, default `~/.config/immune-brain/config.json`, contract `immune_brain/user_config/v1`). `resolveConfig` resolves `git_integration` in order `user` → `project` (tracked `.imm/config.json`) → `legacy` (tracked `AGENTS.md` / `CLAUDE.md`) → `default` (`"manual"`), and `readGitIntegrationPreference` propagates the resolved mode, file-path `source`, and fail-closed diagnostics to `status`, `imm-kernel config --json`, and all existing commit/delivery callers.

**Threat model and supported environment**: Inputs are the user configuration file outside the repository (maintainer-owned), tracked `.imm/config.json`, and tracked root `AGENTS.md` / `CLAUDE.md` directives; untracked project config and untracked instruction files remain ignored so an unreviewed Lane file cannot enable `auto`. Malformed JSON, wrong `contract`, unknown top-level keys, `projects.<project_key>.git_integration` overrides, or non-`"manual"|"auto"` values fail `git_integration` closed to `"manual"` with a `config_invalid` diagnostic naming the offending file and key path, without leaking environment secrets. Supported platforms match existing layered configuration (macOS and Linux; Windows resolves via `os.homedir()` and is untested), with no new Git object format, encoding, or sandbox guarantees beyond the repository's existing tooling.

## Sources and Brainstorm Trace

Upstream `Brainstorm manifest` from `/immune-brain:clarify` (2026-11-14) mapped completely:

| Upstream ID | Classification | Mapping in this Spec |
|---|---|---|
| `BR-REQ-1` | Requirement | Covered by `AC2`, Technical Design §1–§2 |
| `BR-REQ-2` | Requirement | Covered by `AC3`, Technical Design §3 |
| `BR-DEC-1` | Confirmed decision | Covered by `AC1`, Technical Design §1 (`user → project → legacy → default`) |
| `BR-DEC-2` | Confirmed decision | Covered by `AC1`, Technical Design §1 (top-level only; keep `immune_brain/user_config/v1`) |
| `BR-DEC-3` | Confirmed decision | Covered by `AC1`, `AC2`, Technical Design §1–§2 (fail closed to `"manual"`) |
| `BR-DEC-4` | Confirmed decision | Covered by `AC2`, Technical Design §2 (`config.files.user` as `status.git_integration.source`) |
| `BR-OUT-1` | Non-goal | Explicitly excluded: `projects.<project_key>.git_integration` stays rejected as unknown key |
| `BR-OUT-2` | Non-goal | Explicitly excluded: legacy `- Git integration:` reader retained per D9; commit semantics unchanged |
| `BR-SCN-1` | Scenario | Mapped to `User scenarios` (`BR-SCN-1` → `AC1`, `AC2`) |
| `BR-SCN-2` | Scenario | Mapped to `User scenarios` (`BR-SCN-2` → `AC1`, `AC2`) |
| `BR-SCN-3` | Scenario | Mapped to `User scenarios` (`BR-SCN-3` → `AC1`, `AC2`) |

Repository discovery evidence:

- `plugins/immune-brain/runtime/config/layered_config.ts:60-260` — `user` top-level `validKeys` (`96`), `projects.<key>` `validKeys` (`101`, `171`), file-level `failed` propagation (`94`, `180`), `git_integration` validation (`148`), legacy directive handling (`250-255`), and `choose(...)` return (`259`).
- `plugins/immune-brain/runtime/git_integration_preference.ts:6-29` — `GitIntegrationPreference` interface and `readGitIntegrationPreference(root)` error matching and `source` mapping.
- `plugins/immune-brain/runtime/assurance/coordinator.ts:391-459` — `projectTaskStatus` populates `status.git_integration`, `status.config`, and `status.warnings` (`invalid_git_integration`, `deprecated_git_integration`, `config_invalid`).
- Runtime callers reading `readGitIntegrationPreference`: `plugins/immune-brain/runtime/assurance/workflow_autocommit.ts:253`, `plugins/immune-brain/runtime/unattended/checkout_delivery.ts:53,61`, `plugins/immune-brain/runtime/unattended/batch_integration.ts:516`, `plugins/immune-brain/runtime/unattended/batch_final_report.ts:43,105`, `plugins/immune-brain/runtime/kernel/storage_layout_migration.ts:213,226`.
- Existing test prior art and doc-sync contracts: `tests/layered-config.test.ts:27-160`, `tests/git-integration-preference.test.ts:59-77` (note lines `59-72` previously used top-level `user.git_integration` as an unknown-key fixture and must be updated to use a genuinely unknown top-level key), `tests/pi-only-current-contracts.test.ts:73-99`, `docs/agents/derived-files.json`, `scripts/dist-sync-manifest.ts`.

## User scenarios

| ID | Actor | Given | When | Then | Mode / Mapping |
|---|---|---|---|---|---|
| `BR-SCN-1` | Maintainer | `~/.config/immune-brain/config.json` sets top-level `"git_integration": "auto"` and tracked `.imm/config.json` sets `"git_integration": "manual"` | the Maintainer runs `imm-kernel config --json` or checks `status` for a task | `config.git_integration` shows `{ "value": "auto", "source": "user" }` and `status.git_integration` shows `mode: "auto"` with the user config file path as `source` | `automated`: `AC1`, `AC2` |
| `BR-SCN-2` | Maintainer | `~/.config/immune-brain/config.json` omits `git_integration` and tracked `.imm/config.json` sets `"git_integration": "auto"` | the Maintainer runs `imm-kernel config --json` or checks `status` for a task | `config.git_integration` shows `{ "value": "auto", "source": "project" }` and `status.git_integration` shows `{ "mode": "auto", "source": ".imm/config.json" }` | `automated`: `AC1`, `AC2` |
| `BR-SCN-3` | Maintainer | `~/.config/immune-brain/config.json` sets an invalid top-level `"git_integration": "sometimes"` (or sets `"git_integration"` under `projects.<project_key>`) while tracked `.imm/config.json` sets `"git_integration": "auto"` | the Maintainer runs `imm-kernel config --json` or checks `status` for a task | `imm-kernel config --json` exits 1 with a `config_invalid` diagnostic naming the user config file and key path, `config.git_integration` resolves to `{ "value": "manual", "source": "default" }`, and `status.warnings` reports `invalid_git_integration` / `config_invalid` | `automated`: `AC1`, `AC2` |

## Technical Design

### 1. Layered config schema and precedence (`BR-DEC-1`, `BR-DEC-2`, `BR-DEC-3`)

- **Component interface (`plugins/immune-brain/runtime/config/layered_config.ts`)**:
  - Keep contract id `immune_brain/user_config/v1` (additive optional field; existing user config semantics unchanged per `ADR 0029`).
  - Add `"git_integration"` to user top-level `validKeys` (`["contract", "decision_models", "lanes", "initiative_carrier", "git_integration", "projects"]`).
  - Keep `projects.<project_key>` `validKeys` unchanged (`["decision_models", "lanes", "initiative_carrier"]`) at both the active project override (`line 101`) and sibling project validation (`line 171`), so `projects.<key>.git_integration` produces `config_invalid` (`unknown key`) and fails `"user_file"`.
  - Add `"git_integration"` to the `user === null` and `failed.has("user_file")` section failure lists (`lines 94, 180`), because the user file can now set `git_integration` (`layered-config.spec.md` D5: a malformed file as a whole fails every section it could set).
  - Validate `user.git_integration` when present (`has(user, "git_integration")`): require `"manual"` or `"auto"`, else emit `invalid(userPath, "git_integration", "expected manual or auto")` and `failed.add("git_integration")`.
  - Update legacy directive checks (`lines 252, 254`): `gitLegacy` is `used` (and validated as `"manual" | "auto"`) only when `!has(user ?? undefined, "git_integration") && !has(project ?? undefined, "git_integration")`. When either `user` or `project` sets `git_integration`, emit `legacy_source_ignored` (keeping target `[{ layer: "project", key: "git_integration" }]` per `legacy-config-hints.spec.md` D3).
  - Resolve `git_integration` (`line 259`) as:
    `failed.has("git_integration") ? leaf("manual", "default") : choose([user?.git_integration, "user"], [project?.git_integration, "project"], [gitLegacy?.value, \`legacy:${gitLegacy?.file}\`], ["manual", "default"])`.

### 2. Preference reader and status/caller data flow (`BR-REQ-1`, `BR-DEC-3`, `BR-DEC-4`)

- **Interface & data flow (`plugins/immune-brain/runtime/git_integration_preference.ts`)**:
  - Widen `GitIntegrationPreference["source"]` to `".imm/config.json" | "AGENTS.md" | "CLAUDE.md" | string | null` (specifically `config.files.user` when sourced from or failed in user config; keep `".imm/config.json"`, `"AGENTS.md"`, `"CLAUDE.md"`, and `null` unchanged).
  - Error matching in `readGitIntegrationPreference(root)`: treat an `error` diagnostic in `config.diagnostics` as affecting `git_integration` when:
    - `d.file === config.files.user` and (`d.key_path === "git_integration"` || `["$", "contract"].includes(d.key_path)` || `(!d.key_path.includes(".") && d.message.endsWith("unknown key"))` || `(d.key_path.startsWith("projects.") && (d.message === "expected object" || d.message.endsWith("unknown key")))`), matching every condition that triggers `failed.has("user_file")` or `failed.has("git_integration")` in `layered_config.ts`; OR
    - `d.file === ".imm/config.json"` with the existing `git_integration` / `project_file` match; OR
    - `(d.file === "AGENTS.md" || d.file === "CLAUDE.md")` and `d.key_path === "git_integration"`.
  - When `config.git_integration.source === "user"` (and no error overrides it) or when the matched `error.file === config.files.user`, set `source = config.files.user`.
  - Return `mode: config.git_integration.value as GitIntegrationMode` (already `"manual"` when `failed.has("git_integration")`), `source`, and `diagnostic: error ? \`${error.message}; using manual\` : legacy ? \`${legacy}: Git integration is deprecated; use git_integration in .imm/config.json\` : null`.
  - `projectTaskStatus` (`plugins/immune-brain/runtime/assurance/coordinator.ts:444-457`) and all downstream consumers (`workflow_autocommit.ts`, `checkout_delivery.ts`, `batch_integration.ts`, `batch_final_report.ts`, `storage_layout_migration.ts`) require no signature changes because they already consume `readGitIntegrationPreference(root)` and `resolveConfig(root)`.

### 3. Documentation, ADR, tests, and derived artifacts (`BR-REQ-2`)

- Update `docs/reference/immune-brain-config.md`:
  - Add `"git_integration": "manual"` example to `## User File`.
  - Update the `## Precedence` table row for `git_integration` from `policy | project → default (manual)` to `user → project → default (manual)` (personal/checkout commit preference, project provides default).
  - Update `## Git Integration` prose to explain top-level `git_integration` in `~/.config/immune-brain/config.json` overriding `.imm/config.json`, while keeping the `## Legacy Sources` table row text containing ``project `git_integration` `` so `tests/pi-only-current-contracts.test.ts:82` stays accurate.
- Update `docs/adr/0034-layered-configuration.md` with an amendment note recording user-level `git_integration` (`user → project → default`).
- Update `plugins/immune-brain/BASELINE.md` lines 18–21 to note `git_integration` can be set in user `~/.config/immune-brain/config.json` or tracked `.imm/config.json` (retaining `` `.imm/config.json` `` and `` `Git integration` preference `` required by `tests/git-integration-preference.test.ts:137-138`).
- Regenerate all derived files via `bun scripts/sync-dist-docs.ts`, `bun scripts/build-claude-plugin.ts`, and `bun scripts/build-antigravity-plugin.ts`.
- Add `.changeset/user-git-integration.md` (minor bump for additive user config key / precedence change).

**False-compromise check**: No false compromise detected — failing `git_integration` closed to `"manual"` when the user config file is unreadable or top-level invalid (`user_file` error) is an intentional safety boundary (`BR-DEC-3` / `ADR 0034`), preventing a broken user file from silently falling through to project `"auto"` commits.

## Devil's Advocate Audit

- **Rollback resilience**: All changes are in two runtime modules (`layered_config.ts`, `git_integration_preference.ts`), docs, tests, and regenerated bundles; no SQLite schema, TaskRecord, or TaskIntent format changes. Reverting the change restores project-only `git_integration` resolution cleanly without data migration.
- **Verification vanity**: Positive tests alone would pass even if `user` did not override `project`, if `projects.<key>.git_integration` were silently accepted, or if invalid `user.git_integration` fell back to `project: "auto"` instead of failing closed to `"manual"`. Acceptance explicitly pins those negative and precedence controls at `resolveConfig`, `imm-kernel config --json`, `readGitIntegrationPreference`, and `projectTaskStatus`. Note `tests/git-integration-preference.test.ts:59-72` previously used `user.git_integration` as an unknown top-level key fixture; replace that unknown key with a genuinely unsupported key (e.g. `unknown_top_level_key`) while adding explicit tests for valid and invalid `user.git_integration`.
- **Spec dilution**: No reduction to runtime-only without docs/bundles or `project`-overrides-`user`. Every `BR-*` item including `BR-OUT-1` (`projects.<key>.git_integration` exclusion) is tested or explicitly verified.

## Acceptance and verification mapping

| Acceptance | Observable invariant and enumerated controls | Agreed seam & done-looks-like | Focused descriptor | Single source |
|---|---|---|---|---|
| `AC1` | `resolveConfig` and `imm-kernel config --json` accept optional top-level `git_integration` (`"manual" \| "auto"`) in `immune_brain/user_config/v1` with precedence `user → project → legacy → default`. Positive: `user: "auto"` overrides `project: "manual"` with `source: "user"`; `user: "manual"` overrides `project: "auto"` with `source: "user"`; omitted `user.git_integration` preserves `project: "auto"` with `source: "project"`; `user` or `project` set ignores legacy `AGENTS.md` directive with `legacy_source_ignored`. Negative: `projects.<project_key>.git_integration` fails with `config_invalid` (`unknown key`); invalid `user.git_integration` (`"sometimes"`), malformed user JSON, or wrong user `contract` exits `imm-kernel config --json` with 1 and resolves `git_integration` to `{ value: "manual", source: "default" }` even when `project` declares `"auto"`; untracked `.imm/config.json` remains ignored. | `tests/layered-config.test.ts` (`resolveConfig` & `imm-kernel config --json`); Maintainer sees `config.git_integration` reflect `user` over `project`, reject `projects.<key>.git_integration`, and fail closed to `manual` on invalid user config. | `bun test tests/layered-config.test.ts` | `BR-DEC-1` |
| `AC2` | `readGitIntegrationPreference` and `projectTaskStatus` return `user`-resolved `mode` with `config.files.user` as `status.git_integration.source` (and `status.config.git_integration.source === "user"`), preserve `".imm/config.json"` / `"AGENTS.md"` / `"CLAUDE.md"` / `null` when user config omits `git_integration`, and fail closed to `mode: "manual"` with `invalid_git_integration` (naming `config.files.user` in `warnings[].paths` and message) and `config_invalid` when `user.git_integration` is invalid, `projects.<key>.git_integration` is set, or the user file is malformed — even when `project` declares `"auto"`. Existing test `tests/git-integration-preference.test.ts` unknown-user-key isolation check uses a genuinely unknown key in `projects.<key>` / unrelated invalid section check or updated fixture without weakening fail-closed invariants. | `tests/git-integration-preference.test.ts` (`readGitIntegrationPreference` & `projectTaskStatus`); Maintainer sees `status.git_integration` and warnings attribute `config.files.user` accurately and never auto-commit on invalid user config. | `bun test tests/git-integration-preference.test.ts` | `BR-REQ-1` |
| `AC3` | `docs/reference/immune-brain-config.md`, `docs/adr/0034-layered-configuration.md`, and `plugins/immune-brain/BASELINE.md` document top-level user `git_integration` and `user → project → default` precedence; `.changeset/user-git-integration.md` is present; all generated doc/BASELINE mirrors, Claude MCP bundle, and Antigravity outputs pass parity checks (`sync-dist-docs.ts --check`, `build-claude-plugin.ts --check`, `build-antigravity-plugin.ts --check`) and doc/packaging contract tests pass. | `tests/pi-only-current-contracts.test.ts`, `tests/dist-docs-sync-contract.test.ts`, `tests/baseline-packaging-contract.test.ts`, and parity scripts; Maintainer sees docs and all host packages in sync with the new user-level behavior. | `sh -c "bun scripts/sync-dist-docs.ts --check && bun scripts/build-claude-plugin.ts --check && bun scripts/build-antigravity-plugin.ts --check && bun test tests/pi-only-current-contracts.test.ts tests/dist-docs-sync-contract.test.ts tests/baseline-packaging-contract.test.ts"` | `BR-REQ-2` |

## Handoff completeness

- **Single Slice result**: One coherent TaskIntent `user-git-integration` delivers the complete confirmed outcome (`user → project → legacy → default` top-level `git_integration`, fail-closed validation, status/caller attribution, docs, and packaged bundles).
- **Remaining gap**: Implementation, bundle regeneration, typecheck, and execution of `AC1`–`AC3` await literal-user Enrollment via `/immune-brain:drive`.
