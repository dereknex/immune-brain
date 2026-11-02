# Layered configuration: one user file, one project file, one resolver

**Status**: Candidate; no execution authority.
**Initiative**: `layered-config` (source issue #360), six Slices S1–S6.
**Design risk**: High — it replaces four configuration sources that the runtime, the Parent and the Planner read today, moves a shipped-code boundary (the decision-model component enters the plugin runtime), and adds a user-level file outside the repository that every Host and every Lane reads. A wrong precedence rule silently changes Git integration, egress of sensitive input, or batch parallelism.
**Design views**: data flow (user file + tracked project file + legacy sources → one resolver → `imm-kernel config --json`, the `status` projection, `decide()`, the Git integration reader, the Parent's Lane resolution and the Planner's carrier resolution).
**Document language**: English, following Planner's default document policy.

## Outcome

Immune-Brain configuration comes from two files and one resolver:

- a **user file**, `$XDG_CONFIG_HOME/immune-brain/config.json` (default `~/.config/immune-brain/config.json`), shared by Claude Code and Pi, holding personal settings, with per-repository overrides;
- a **project file**, tracked `.imm/config.json`, holding repository facts and policy;
- one **resolver** in the plugin runtime that both Hosts, every Lane worktree and the offline eval scripts call, and that reports every effective value with its source.

The decision-model component moves from `scripts/decision-model/` into `plugins/immune-brain/runtime/decision_model/`, so it ships with the plugin. Legacy sources keep working for one major version with a deprecation warning.

Slice results (each a TaskIntent):

| Slice | Task | Result when it lands |
|---|---|---|
| S1 | `config-decision-model-move` | `decide()`, its providers and the point registry live under `plugins/immune-brain/runtime/decision_model/`; the eval scripts import them from there; behaviour is unchanged. |
| S2 | `config-resolver` | The resolver, `imm-kernel config --json`, the `config` field of `status` on both Hosts, legacy reading, test isolation, ADR 0034 and the repository's own `.imm/config.json`. No consumer reads it yet. |
| S3 | `config-decision-model-consumer` | `decide()` takes profiles, bindings, egress and enabled points from the resolver. `.imm/decision-bindings.json` is deleted. |
| S4 | `config-git-carrier` | The Git integration reader and the Planner's carrier resolution use the resolver; `AGENTS.md` drops its carrier directive. |
| S5 | `config-lanes` | The Parent's Lane Preferences and batch final verification resolve through the resolver. |
| S6 | `config-docs` | The preference reference, its packaged mirror, both READMEs and `IMMUNE.md` describe the layered model. |

Remaining gap after S6: the legacy sources are still read (D9). Removing them is a later major release, explicitly deferred. No live decision point is enabled; rollout of A14 and A4 stays with #204.

## Sources

- **#360** — issue body as created 2026-11-02 (https://github.com/dereknex/immune-brain/issues/360): Problem table, Confirmed decisions 1–3, Proposed design, Decisions superseded, Open questions. Cited as `#360-C1..C3` for the three confirmed decisions and `#360-P` for the proposed design.
- **Owner confirmation, 2026-11-02 (this conversation)** — "1. 同意 2. 搬 3. 搬，lane配置也搬": user file location (C1), move the component (C2), Git integration, Initiative carrier and Lane configuration move into the layered config (C3). No upstream `clarify` manifest; scenarios are Spec-local `SCN-*`.
- Repository evidence:
  - `plugins/immune-brain/runtime/git_integration_preference.ts:19-55` — the runtime parses the first `- Git integration:` line of the tracked root `AGENTS.md`, else `CLAUDE.md`; invalid or absent means `manual`. Callers: `assurance/coordinator.ts:438-440` (status), `assurance/workflow_autocommit.ts`, `assurance/enrollment_git_base.ts`, `unattended/batch_final_report.ts`, `unattended/batch_integration.ts`, `kernel/storage_layout_migration.ts`.
  - `plugins/immune-brain/runtime/assurance/coordinator.ts:407,449` — `projectTaskStatus` returns `{ ...result, git_integration, batch?, warnings? }`; `plugins/immune-brain/.pi-extension/imm-canary-work.ts:742-744` copies `git_integration` and `batch` into the Pi status output field by field.
  - `plugins/immune-brain/runtime/claude/mcp_server.ts:33` — `status` reads the projection "for an exact task"; there is no task-free status, so the Planner has no runtime read before a task exists.
  - `plugins/immune-brain/runtime/v4_runtime.ts:170-200` and `plugins/immune-brain/bin/imm-kernel` — `imm-kernel` subcommands (`intent`, `status --json`, `inspect --json`, `migrate`, `audit`) dispatch here; the wrapper runs the TypeScript source with `bun`, so runtime source is what ships.
  - `plugins/immune-brain/.pi-extension/imm-canary-enroll.ts:16-18` — the Pi extension imports `../runtime/...` directly.
  - `scripts/decision-model/config.ts:26-27,70-227` — `.imm/decision-bindings.json` (tracked, `contract`, `default_profile`, `bindings`, `egress`) and `.imm/decision-models.local.json` (ignored, `profiles`); strict parsers with `config_invalid` diagnostics. `scripts/decision-model/decide.ts:43-60` — resolution: binding, then local profile; `no_binding`, `no_local_config`, `unknown_profile`.
  - `docs/specs/decision-model-core.spec.md` D1 (`scripts/` placement, "the live A14 slice can move it under `plugins/immune-brain/`"), D3 (two files), D4 (egress gate), AC4 (import scan), AC7 (tracked file, ignored local file, CONTEXT vocabulary). `tests/decision-model.test.ts:422-466` pins the import ban, the ignore rule and `CONTEXT.md` naming `scripts/decision-model/`.
  - `docs/adr/0006-unattended-review-dispatch-authority.md:28-29` — the runtime never invokes an Executor or reviewer model.
  - `docs/adr/0033-lane-preferences-local-preset.md` — Lane preset in `.imm/lanes.local.json`, read by the Parent alone; `plugins/immune-brain/dist/drive-batch.md` `#### Lane Preferences` states it, locked by `tests/role-prompt-bridge.test.ts:383-410`.
  - `docs/adr/0024-git-integration-preference.md` — item 1, the instruction-file directive as the source.
  - `plugins/immune-brain/dist/draw-up.md:220-240` — carrier resolution: request, repository instruction file directive, user-level Host instruction file directive, ask; repository overrides user; no silent default.
  - `docs/reference/immune-brain-config.md` and its mirror `plugins/immune-brain/dist/docs/reference/immune-brain-config.md` — "does not load an agent-local TOML file", locked by `tests/pi-only-current-contracts.test.ts:73-84`.
  - `docs/adr/0023-project-declared-risk-floor.md` — `.imm/risk-floor.json` stays separate; an unreadable floor resolves to `critical`.
  - `bunfig.toml` — `preload = ["./tests/helpers/test-timeout.ts"]`; every `bun test` run passes through it.
  - Observed 2026-11-02: the retained `revisit-evidence-chain` Lane worktrees contain `.imm/audit`, `.imm/state`, `.imm/risk-floor.json`, and neither `*.local.json` file.
  - `AGENTS.md:42-44` (`CLAUDE.md` is a symlink to it) — `## Immune-Brain Preferences` / `- Initiative carrier default: github`; no `Git integration` line.

## User scenarios

| ID | Actor | Given | When | Then |
|---|---|---|---|---|
| SCN-1 | Maintainer | a Lane profile `laptop` set as `lanes.active` in the user file, and two clones of the repository | they start a batch from either clone | the Parent's preference line shows `max_parallel`, Host, model and effort from `laptop` with source `user`, in both clones |
| SCN-2 | Maintainer | a decision-model profile in the user file and a binding for `a14_pr_comment_triage` | they run the A14 offline eval from a Lane worktree | the eval calls the bound provider instead of reporting `no_local_config` |
| SCN-3 | Maintainer | `.imm/config.json` with `"git_integration": "auto"` committed | they read `status` for a task | `git_integration` shows `auto` with source `.imm/config.json` |
| SCN-4 | Maintainer | the user file lists `finding` in `egress.clef` and the project ceiling does not | they run `imm-kernel config --json` and then an A4 eval with a `clef` profile | the CLI reports `egress_beyond_project_ceiling` for `clef`/`finding`, and every A4 case is `unavailable` with `egress_denied` |
| SCN-5 | Maintainer | an upgraded plugin and an existing `.imm/lanes.local.json`, `.imm/decision-models.local.json` and `- Initiative carrier default: github` directive | they run `imm-kernel config --json` | each value still applies with source `legacy:<path>`, and a `deprecated_config_source` warning names the replacement key |
| SCN-6 | Maintainer | a user file where `token_env` holds a pasted token instead of a variable name | they run `imm-kernel config --json` or start a batch | the CLI names the file and the key path `decision_models.profiles.<name>.token_env`, never echoes the value, and exits 1 |

## Decisions and technical design

### D1 — Two files, one resolver (source: #360-C1, #360-C3)

- **User file**: `$XDG_CONFIG_HOME/immune-brain/config.json` when `XDG_CONFIG_HOME` is set to an absolute path, else `<home>/.config/immune-brain/config.json` with `<home>` from `os.homedir()`. One file for both Hosts. Absent is valid and means "no user settings".
- **Project file**: `.imm/config.json` at the checkout root, honoured only when Git tracks it (`git ls-files --error-unmatch`), the rule `git_integration_preference.ts:23-25` already applies to instruction files. A tracked file is read from the working tree, as today's instruction-file reader does; the tracked rule only excludes an untracked file. Absent is valid.
- **Resolver**: `plugins/immune-brain/runtime/config/layered_config.ts` exports `resolveConfig(root, options?)` returning `{ contract: "immune_brain/effective_config/v1", project_key, files, decision_models, lanes, git_integration, initiative_carrier, batch, diagnostics }`. Every leaf value is `{ value, source }`, where `source` is one of `user`, `user:project`, `project`, `legacy:<repo-relative path>`, `default`. The function never throws; it never reads a credential value, only checks that the named environment variable is set when asked (D6).
- `.imm/risk-floor.json` stays a separate file with its own fail-to-`critical` rule (ADR 0023). The resolver does not read it.

Supported environment: macOS and Linux. Windows resolves `<home>/.config/...` through `os.homedir()` but is not tested.

### D2 — Schemas (source: #360-P; delegated technical choice for key names)

User file:

```json
{
  "contract": "immune_brain/user_config/v1",
  "decision_models": {
    "profiles": { "<name>": { "kind": "clef", "model": "clef", "account_id_env": "CLOUDFLARE_ACCOUNT_ID", "token_env": "CLOUDFLARE_AUTH_TOKEN" } },
    "default_profile": "<name>",
    "bindings": { "<point id>": "<name>" },
    "egress": { "<provider kind>": ["finding"] }
  },
  "lanes": {
    "active": "<name>",
    "profiles": { "<name>": { "max_parallel": 4, "executor_host": "claude-code", "executor_model": "claude-sonnet-5-5", "executor_effort": "high" } }
  },
  "initiative_carrier": "github",
  "projects": {
    "github.com/owner/repo": {
      "decision_models": { "default_profile": "<name>", "bindings": {}, "egress": {} },
      "lanes": { "active": "<name>" },
      "initiative_carrier": "local"
    }
  }
}
```

Project file:

```json
{
  "contract": "immune_brain/project_config/v1",
  "git_integration": "manual",
  "initiative_carrier": "github",
  "decision_models": { "enabled_points": ["a14_pr_comment_triage"], "egress": { "clef": [] } },
  "lanes": { "max_parallel": 2, "executor_host": "pi", "executor_model": "...", "executor_effort": "..." },
  "batch": { "final_verification": ["bun run typecheck"] }
}
```

- Every key is optional except `contract`. Unknown keys at any level are invalid (the strict pattern of `scripts/decision-model/config.ts:62-65`).
- Profiles are defined only at the user file's top level. A `projects` entry may select profiles (`default_profile`, `bindings`, `lanes.active`) but not define them, so credentials-env names live in one place.
- Decision-model profile fields are exactly today's D2 fields of `decision-model-core.spec.md` (`clef`, `jev`, `fake`), validated by the moved parsers (S1). Every `*_env` value must match `^[A-Z_][A-Z0-9_]*$`.
- Lane profile fields and value domains are exactly ADR 0033's (`max_parallel` positive integer; `executor_host` `claude-code` or `pi`; model and effort strings).
- `batch.final_verification` is at most 8 plain command strings, the constraint `start_unattended_batch` already enforces (`runtime/claude/mcp_server.ts:70`).

### D3 — Project identity for per-repository overrides (source: #360 open question 1; delegated technical choice)

The `projects` key is the normalized `origin` fetch URL: scheme, `user@`, port and a trailing `.git` or `/` removed, the scp form `git@host:owner/repo` rewritten to `host/owner/repo`, the host lower-cased (`https://github.com/O/R.git`, `ssh://git@github.com/O/R`, `git@github.com:O/R.git` → `github.com/O/R`). With no `origin`, the key is the real path of the main checkout root, the parent of `git rev-parse --path-format=absolute --git-common-dir`. Both rules give a Lane worktree the same key as its main checkout. The resolver reports the key it used as `project_key`.

### D4 — Precedence (source: #360-P "Resolution", which already separates personal from policy keys; delegated choices noted per row)

| Kind | Keys | Order (first set wins) |
|---|---|---|
| personal | `decision_models.default_profile`, `decision_models.bindings.<point>`, `lanes.active` | request → `user:project` → `user` |
| personal, field-wise | `lanes.max_parallel`, `lanes.executor_host`, `lanes.executor_model`, `lanes.executor_effort` | request → selected user Lane profile → project `lanes` → `default` |
| repository fact | `initiative_carrier` | request → `project` → `user:project` → `user` → none (the Planner asks) |
| policy | `git_integration` | `project` → `default` (`manual`) |
| policy | `decision_models.enabled_points` | `project` → `default` (every registered point) |
| policy ceiling | `decision_models.egress.<kind>` | project list, intersected with `user:project` if set, else with `user` if set; no user entry means the project list |
| repository fact | `batch.final_verification` | request → `project` → repository prose commands → none |

- **Request** values are applied by the caller (the Parent or the Planner); the resolver resolves the file layers and the caller overlays the literal request, as ADR 0033 already has the Parent do.
- **Lane model and effort** apply only with an `executor_host` from the same layer (ADR 0033's rule, extended to the project layer). A model or effort whose host was overridden by a higher layer is reported as `not_applied` and dropped.
- **Project Lane values are defaults, not caps** (#360 open question 2; delegated). No evidence in the repository shows a need for a ceiling, and a cap is new policy the owner did not ask for.
- **`initiative_carrier`** keeps today's order, repository over user (`draw-up.md:228-234`), because where a repository's Initiatives live is a fact about the repository.
- **`enabled_points` absent means every registered point** (delegated). No runtime path calls `decide()` today (D8), so a gate that defaults closed would only break the offline evals; a project that wants to restrict lists the points.
- **Egress**: a user category outside the project ceiling is dropped and reported as `egress_beyond_project_ceiling` naming the kind and category. The user level can only narrow egress (#360-P).

### D5 — Diagnostics and fail-closed behaviour (source: #360-P "malformed config fails closed with a named diagnostic"; ADR 0033 refusal pattern)

Each diagnostic is `{ code, severity, file, key_path, message }`; `severity` is `error` or `warning`. Codes: `config_invalid` (malformed JSON, wrong `contract`, unknown key, wrong type, invalid value, invalid env var name), `unknown_profile` (an `active`, `default_profile` or binding naming no defined profile), `egress_beyond_project_ceiling`, `not_applied`, `deprecated_config_source`, `legacy_source_ignored`. Messages name the file and key path and never contain a configured value of a `*_env` key or any environment variable's value.

On an error in one section, only that section fails closed; the rest still resolves:

- `decision_models` invalid → `decide()` returns `unavailable` / `config_invalid` (D7).
- `lanes` invalid → `lanes.valid: false`; the Parent reports it and starts no batch (ADR 0033's rule, unchanged).
- `git_integration` invalid → `manual` with the diagnostic (today's rule, `git_integration_preference.ts:46-52`).
- `initiative_carrier` invalid → none; the Planner reports and asks (today's rule).
- A malformed file as a whole (not JSON, wrong `contract`) fails every section that file could set.

### D6 — Read surfaces (source: #360-P "one runtime resolver used by Claude MCP server and Pi extension"; repository evidence `mcp_server.ts:33`)

- **`imm-kernel config --json`** prints the effective config object. Exit status 0 when no diagnostic has severity `error`, else 1. `--check-env` additionally reports, per decision-model profile, whether each named variable is set (`set`/`unset`), never its value. The Planner and the Parent read it with the Host's shell, which both Hosts already use for `imm-kernel intent author`.
- **`status`** on both Hosts adds a `config` field with the same object, and adds every `error` diagnostic to `warnings` with code `config_invalid`. The Pi status copies the field like `git_integration` (`imm-canary-work.ts:742`).

### D7 — Decision models through the resolver (source: #360-C2, #360-P; `decision-model-core.spec.md` D3–D5)

`resolveProfile` reads `config.decision_models`: `enabled_points` first (a point not listed → `unavailable` / `point_disabled`, a new reason), then `bindings[point]` else `default_profile` (`no_binding` when neither), then the user profile (`unknown_profile` when undefined, `no_local_config` when the user file defines no profiles and no legacy file supplies one). The egress gate uses the effective egress of D4. The existing reason codes keep their names so eval reports stay comparable; their detail text names `~/.config/immune-brain/config.json` instead of the legacy file. `.imm/decision-bindings.json` is deleted from this repository; its values (`default_profile: "default"`, empty bindings and egress) carry no decision.

### D8 — Component placement (source: #360-C2; `decision-model-core.spec.md` D1, which anticipated the move; ADR 0006)

`scripts/decision-model/*` moves to `plugins/immune-brain/runtime/decision_model/` unchanged in behaviour (S1). `scripts/decision-eval/*` imports it from there and stays in `scripts/`. ADR 0006 still holds: no file under `runtime/kernel/`, `runtime/assurance/`, `runtime/unattended/`, `runtime/claude/` or `.pi-extension/` imports `runtime/decision_model/` in this Initiative; the code ships, but nothing in an authority path calls it. A live call site is a later amendment under #204. The import scan of `decision-model-core.spec.md` AC4 is replaced by this rule.

### D9 — Legacy sources (source: #360-P "Migration"; delegated precedence)

Read for one major version, each only when no new layer sets the same section:

| Legacy source | Section it fills | Replacement key |
|---|---|---|
| `.imm/lanes.local.json` | `lanes` profiles and `active` | user `lanes` |
| `.imm/decision-models.local.json` | `decision_models.profiles` | user `decision_models.profiles` |
| `.imm/decision-bindings.json` | `default_profile`, `bindings` (personal) and `egress` (policy ceiling) | user `decision_models` / project `decision_models.egress` |
| `- Git integration:` in tracked `AGENTS.md`/`CLAUDE.md` | `git_integration` | project `git_integration` |
| `- Initiative carrier default:` in tracked `AGENTS.md`/`CLAUDE.md` | `initiative_carrier` | project `initiative_carrier` |

A legacy value has source `legacy:<path>` and adds a `deprecated_config_source` warning naming the replacement key. When a new layer sets the section, the legacy source is not used and `legacy_source_ignored` names it. The user-level Host instruction-file carrier directive is read by the Planner, not the runtime, and is kept as the Planner's last step before asking, also reported as deprecated (S4). Changesets are minor: nothing stops working in this Initiative. Removal is deferred to a later major.

### D10 — Test isolation (source: delegated technical choice; `bunfig.toml` preload)

`tests/helpers/test-timeout.ts` (the existing preload) sets `XDG_CONFIG_HOME` to a fresh empty directory under the OS temp directory unless the variable already points inside the temp directory, so no test reads a maintainer's real user file. Tests that need a user file write one under that directory or pass `options.userConfigPath`.

### D11 — Records superseded (source: #360 "Decisions superseded")

ADR 0034 `docs/adr/0034-layered-configuration.md` (S2) records D1–D10 and supersedes ADR 0033 and ADR 0024 item 1. Both ADRs get a status line pointing to 0034 in S2. `decision-model-core.spec.md` D1 and D3 carry superseded notes written with this Spec, before any Slice, so the bound Spec of S1 and S3 already records the replacement. The reference doc's "loads no agent-local file" principle is rewritten in S6.

## Threat model

- **Input**: the user file (owned by the maintainer, outside the repository), the tracked project file (anyone with commit access), legacy files, and the `origin` URL.
- **Assets**: credential values (never stored; only variable names), sensitive input categories (`finding`, `diff`, `goal_scope`, `spec_source`), and the Git integration mode (whether the runtime commits).
- **Trust rules**: a tracked project file can set policy, so a malicious commit could widen egress; that is today's trust in `.imm/decision-bindings.json` and is unchanged. The user file can only narrow egress. An untracked `.imm/config.json` (for example created inside a Lane) is ignored, so a Lane cannot switch Git integration to `auto`. A pasted secret in an `*_env` key fails validation and is never echoed. The resolver performs no network call.
- **Out of scope**: protecting the user file from other local users (file-system permissions are the Host's concern); Windows path rules.

## Acceptance

| ID | Slice | Case set (+ accepted, − refused) |
|---|---|---|
| AC-S1-1 | S1 | +`decision-model.test.ts` passes importing from `runtime/decision_model/`; −`scripts/decision-model/` no longer exists |
| AC-S1-2 | S1 | +eval tests pass; −no authority-path file imports `runtime/decision_model/`; −no runtime file imports `scripts/` |
| AC-S2-1 | S2 | +each D4 row with sources; +egress intersection; +Lane model dropped as `not_applied` under a higher-layer host |
| AC-S2-2 | S2 | +https/ssh/scp `origin` give one key; +Lane worktree key equals main checkout; +no `origin` → main checkout real path |
| AC-S2-3 | S2 | −malformed JSON, −wrong `contract`, −unknown nested key, −unknown profile, −invalid `executor_host`, −pasted token in `token_env` (value absent from output), −untracked `.imm/config.json` ignored; each with file and key path |
| AC-S2-4 | S2 | +each D9 legacy source resolves with `legacy:<path>` and `deprecated_config_source`; +new layer wins with `legacy_source_ignored` |
| AC-S2-5 | S2 | +`imm-kernel config --json` exit 0/1; +`--check-env` reports `set`/`unset` without values; +`status` `config` field on Claude and Pi |
| AC-S2-6 | S2 | +preload isolates `XDG_CONFIG_HOME`; +bundle current; +typecheck |
| AC-S3-1 | S3 | +profile from user, binding from `user:project`, egress intersection; −`point_disabled`; +legacy files still work with warning; −`.imm/decision-bindings.json` absent |
| AC-S4-1 | S4 | +`.imm/config.json` `git_integration` wins over directive; +directive alone with warning; −invalid value → `manual` |
| AC-S4-2 | S4 | +draw-up carrier resolution reads `imm-kernel config --json`; +`AGENTS.md` has no carrier directive; +repository resolves `github` from `project` |
| AC-S5-1 | S5 | +drive-batch Lane Preferences resolves through `imm-kernel config --json` with the D4 field order and sources; +final verification order |
| AC-S6-1 | S6 | +reference doc and mirror describe both files, precedence and legacy; +READMEs name both paths |

## Brainstorm trace

No `clarify` manifest. #360 items map:

| #360 item | Result | Where |
|---|---|---|
| C1 user file location | covered | D1; S2 |
| C2 move component | covered | D8; S1 |
| C3 Git integration, carrier, Lane into layered config | covered | D4, D9; S4, S5 |
| P user-level contents | covered | D2; S2 |
| P project-level contents | covered | D2; S2, S3, S4, S5 |
| P resolution order | covered: personal vs policy order as in #360-P | D4; S2 |
| P readers: one resolver, both Hosts, Lanes | covered | D1, D3, D6; S2 |
| P observability | covered | D5, D6; S2 |
| P migration | covered: read one major with warning; removal deferred | D9; S2–S5 |
| Superseded decisions | covered | D11; S1, S2, S3, S6 |
| Open question 1 (no `origin`) | resolved, delegated | D3 |
| Open question 2 (Lane defaults vs caps) | resolved, delegated: defaults | D4 |
| Open question 3 (carrier Skill-read vs runtime) | resolved, delegated: runtime resolves, Planner reads `imm-kernel config --json` and still asks when none | D4, D6; S4 |

## Rollback resilience

S1 is a move; reverting it restores `scripts/decision-model/`. S2 adds new files and a read-only `config` field; no consumer depends on it until S3–S5, so reverting S2 alone is safe only before them. S3–S5 each keep the legacy path, so reverting one restores the previous reader without data loss. No persisted Kernel record changes shape.
