# Antigravity plugin package isolation

**Status**: Candidate; planning only.
**Design risk**: High — this changes a host's install root and its package/reference closure across build, distribution, and native component discovery. Kernel authority and persistence protocols do not change.
**Output language**: English, following the Planner document-language default.
**Execution posture**: characterization-first; preserve the recorded native-loader failure, then add package-boundary regression cases before changing packaging.
**Threat model and supported environment**: Repository-controlled plugin assets and host-supplied hook JSON; this task repairs asset discovery and executable resolution, not hook payload trust or Kernel authorization. Native validation targets the observed Antigravity CLI `agy 1.5.1` on macOS; deterministic packaging checks target the existing macOS/Linux Bun/Node toolchain and UTF-8 paths, including paths containing spaces. Windows shell-wrapper support is not added.

## Outcome

Deliver an independently installable Antigravity plugin under `plugins/immune-brain-antigravity/`, in the same npm release and version as Pi and Claude. Its own manifest, hooks, MCP configuration, native agent definitions, skills, CLI wrappers, runtime dependencies, contracts, and role prompts resolve inside that root. Antigravity no longer discovers Claude agent definitions, and its hooks run without a `PLUGIN_ROOT` environment variable.

The request is the user's instruction to plan repairs for the directory layout and native-loading defects established in this conversation. It does not request a redesign of the other hosts or full Managed lifecycle certification.

## Evidence

| ID | Evidence |
| --- | --- |
| E1 | [Official plugin directory structure](https://antigravity.google/docs/build-plugins#directory-structure): `.antigravity-plugin/plugin.json` is supported for multi-provider repositories; component directories and `mcp_config.json`/`hooks.json` remain relative to the selected plugin root. |
| E2 | Recorded local run: `agy --version` returned `1.5.1`; `agy plugin validate plugins/immune-brain --strict --json` exited 1 with 5 errors and 6 warnings. The five Claude `agents/*.md` files were skipped because string-valued `tools` is not a YAML array. Four hook commands used unsupported `${PLUGIN_ROOT}`; `.mcp.json` and `hooks/hooks.json` were ignored. |
| E3 | Recorded temporary-copy experiment: moving only the manifest to `.antigravity-plugin/plugin.json` retained all 5 errors and 6 warnings. Removing Claude component inputs and changing hook commands to relative paths yielded exit 0, zero errors, zero warnings, but zero agents. This last result is layout evidence, not proof of complete functionality. |
| E4 | `scripts/build-antigravity-plugin.ts:8` currently bundles `runtime/antigravity/mcp_server.ts`, stamps the shared-root manifest, and checks only bundle bytes. `package.json:99` publishes the three Antigravity root files. `.github/workflows/ci.yml:47` already runs the Antigravity build check. |
| E5 | `plugins/immune-brain/skills/drive/SKILL.md:8` and `skills/draw-up/SKILL.md:8` reference `../../dist/`; `bin/imm-kernel:3` and `bin/imm-plan:3` invoke the sibling `runtime/v4_runtime.ts`. `runtime/role_prompt_bridge.ts:155` resolves packaged role prompts relative to the runtime/bundle. A plugin consisting only of three JSON files and a server is incomplete. |
| E6 | `runtime/antigravity/review_host.ts:21` names the native reviewer and verifier. Shared role prompts live under `runtime/prompts/`; `scripts/build-claude-plugin.ts:28` demonstrates generating host-specific agent frontmatter from those prompts. `runtime/antigravity/mcp_server.ts:3` imports the Claude MCP transport implementation, so transitive runtime source dependencies cannot simply be excluded by host name. |
| E7 | `scripts/plugin_versioning.ts:6` currently validates only the Claude manifest and shared version module. `tests/claude-host-package.test.ts:66` and `tests/pi-only-release-contract.test.ts:10` assert that exact version inventory. `docs/agents/derived-files.json:3` currently declares only the Claude bundle. |
| E8 | Prior verification: `bun scripts/build-antigravity-plugin.ts --check` passed; `bun test tests/antigravity-assurance-conformance.test.ts` passed 12 tests. These checks did not catch E2. |

## Decisions and provenance

Each decision has one source; evidence references above explain the inputs to delegated implementation choices.

| ID | Decision | Source |
| --- | --- | --- |
| D1 | Use a dedicated `plugins/immune-brain-antigravity/` install root; retain `plugins/immune-brain/` as the existing Pi/Claude and shared-source root. Keep one npm package and one root version authority. | Delegated technical choice: isolate automatic host discovery with the smallest change to existing consumers. |
| D2 | Move the canonical Antigravity manifest to the new root's `.antigravity-plugin/plugin.json`, and the MCP/hook files to that root. Delete the three obsolete shared-root files in the same change; retain no fallback discovery path. | E1. |
| D3 | Hooks use `node "./dist/antigravity/mcp-server.mjs" --hook` from the plugin cwd. MCP uses `${PLUGIN_ROOT}/dist/antigravity/mcp-server.mjs`; that interpolation is supported for MCP configuration. | E2. |
| D4 | Generate Antigravity-native definitions for the five currently colliding role names from the existing shared role prompts and role restrictions, using native YAML arrays and native tool names. Reviewer/verifier remain read-only; do not introduce shell or write capabilities as a formatting fix. No Claude frontmatter is copied into this root. | Delegated technical choice: replace invalid discovered components with native definitions while conserving the existing role inventory. |
| D5 | Extend the existing Antigravity builder to generate the new root's shared delivery assets deterministically from existing canonical sources. Preserve the `skills/`, `dist/`, `bin/`, and runtime-relative layout. Copy the runtime dependency closure already shipped by the package, including required `runtime/claude/` implementation modules, but exclude Pi extensions and Claude loader-facing manifests, hooks, and agents. Do not use symlinks or parent-relative runtime links. | E5. |
| D6 | Integrate the relocated manifest into existing stamp/validate functions; declare the Antigravity generated outputs and their sources in the derived-files registry. `--check` covers all generated delivery assets and is read-only. Add its check to release verification as well as the existing CI check. | E7. |
| D7 | Require native strict validation and package subprocess/reference tests in addition to existing adapter unit tests. Missing native validator is a failed prerequisite, never a successful skip. | E8. |

## User scenarios

Source for each scenario: the user's repair-planning request applied to the previously verified plugin loading defects.

| Scenario | Observable result | Verification mapping |
| --- | --- | --- |
| SCN-1 — Install the Antigravity artifact from the npm package | The documented Antigravity root contains the public skills and valid native agents without discovering Claude components. | automated: AC1, AC4, AC6 |
| SCN-2 — Run a configured hook from the installed plugin | Its command starts successfully with `PLUGIN_ROOT` absent, including when the installed path contains spaces. | automated: AC2 |
| SCN-3 — Follow a skill's contract and CLI references | References, role prompts, `imm-plan`, and `imm-kernel` work from a relocated copy without the source repository beside it. | automated: AC3 |
| SCN-4 — Continue using Pi or Claude after the packaging fix | Existing install roots, loader configuration, and host behavior remain supported. | automated: AC5 |

## Technical Design

**Design views**: package/data shape and build interfaces. No new runtime state machine or authority owner is introduced.

### Package shape and ownership

```text
plugins/
  immune-brain/                         existing Pi/Claude root; shared source
    runtime/antigravity/                 canonical adapter implementation
    runtime/prompts/                     canonical role instructions
    skills/, bin/, dist/                 canonical/shared delivery inputs
  immune-brain-antigravity/              Antigravity install root
    .antigravity-plugin/plugin.json      canonical host metadata, stamped version
    mcp_config.json                      canonical MCP configuration
    hooks.json                           canonical native hooks
    agents/*.md                         generated native definitions
    skills/, bin/, runtime/              generated shared delivery closure
    dist/antigravity/mcp-server.mjs       generated server bundle
    dist/*.md, dist/docs/, dist/role-prompts/ and registry assets
    README.md, BASELINE.md               generated/shared delivery documentation
```

The final generated inventory is derived from actual references and the existing package runtime allowlist, rather than copying the entire repository. Exclude host output directories from shared `dist/` copying so generation cannot recursively include itself or embed the Claude bundle. Native configuration remains authoritative only for host loading; all task authority stays with the existing Kernel.

The Antigravity builder owns these copies. Shared source edits continue at their existing canonical paths. The derived-files entry records source patterns, output patterns, generator, and checker; generated files are not independently maintained. The existing docs sync stays the owner of shared canonical `dist/` copies, and Antigravity packaging consumes those bytes after sync.

### Build and version interfaces

- Keep `buildAntigravityPlugin(root)` and `checkAntigravityPlugin(root)` as the build/check seams; update returned output paths and every caller for the new root.
- Build validates required source/configuration inputs before generating assets. Missing manifest, missing referenced contract, and missing role prompt produce explicit failure. A required manifest must not be silently ignored.
- `--check` generates expected assets in a temporary directory, compares content and the owned generated-file inventory, and fails for changed, missing, or stale generated files. It must not stamp manifests, repair files, alter the index, or leave temporary output after success/failure.
- Root `package.json` remains version authority. Existing stamping updates both native manifests and the shared runtime version; validation rejects a missing or mismatched Antigravity manifest. Update existing exact-list assertions rather than weakening version checks.
- The npm allowlist includes the complete new artifact and removes the three obsolete Antigravity entries. Existing Pi/Claude paths and package exports are preserved.
- Existing CI invokes the expanded `--check`, and deterministic package tests run without an `agy` dependency. Reuse that existing CI invocation without editing the protected `.github/workflows/` files. Native CLI validation is an additional mandatory local acceptance command; it is not simulated by those tests and is not silently skipped on an environment without `agy`.

### Failure and compatibility

The new root is the sole supported Antigravity install target. Update install instructions to point to it; do not automatically change any installed plugin, settings, or credentials. Existing Antigravity consumers need to reinstall from that target when adopting this release. This is an install-path correction, not a second compatibility adapter.

Retire the shared-root `plugin.json`, `mcp_config.json`, `hooks.json`, and the old Antigravity bundle location atomically with the new artifact and allowlist. No transition shim is introduced. Existing Pi/Claude source and install roots remain valid. Rollback is a revert of this complete packaging change; it needs no persisted-data migration, but restores the known native-loader defects and is not claimed to restore Antigravity correctness.

## Acceptance and verification

Descriptor prerequisites: Bun, Node, Git, and npm are supplied by the existing development/QA environment; existing dependencies come from the installed project dependencies and no descriptor installs them. AC6 additionally requires the already observed `agy 1.5.1` CLI on PATH. Tests create disposable fixtures under the system temporary directory and clean them on success/failure. No acceptance installs a plugin, invokes a model, accesses the network, or mutates host configuration.

| Acceptance | Source | Agreed seam and controls |
| --- | --- | --- |
| AC1 — Correct artifact boundary and native role inventory | E2 | New `tests/antigravity-host-package.test.ts`: new manifest location and complete five-role inventory; shared-root Antigravity files absent; no copied Claude/Pi loader components; native tool restrictions and prompt content preserved. Negative controls: a Claude string-valued tools fixture and a cross-host component fixture are rejected by the package checks. Bound: only declared host delivery components are included; `runtime/claude/` transitive implementation is permitted. |
| AC2 — Configured executable paths work | E2 | Same package test file, spawning the actual configured hook commands from a relocated fixture in a path with spaces and no `PLUGIN_ROOT`; exercise each configured event with an isolated payload that causes no authority mutation. Check MCP configuration resolves its bundled server. Negative: missing bundle produces a nonzero launch result, not a false successful hook check. |
| AC3 — Relocatable dependency/reference closure | E5 | Same package test file, copied without siblings: all public skill/contract links and role prompt references stay inside the artifact; invoke `bin/imm-plan --routing-status --json`, read-only `bin/imm-kernel inspect --json`, and bundled MCP `initialize`/`tools/list`. Negative: removing a referenced contract, runtime dependency, or role prompt fails the corresponding check. |
| AC4 — Distribution, version, and generated-output integrity | E7 | New package test file plus existing `tests/pi-only-release-contract.test.ts`: npm dry-run includes the artifact, excludes obsolete entrypoints, preserves other host paths; validate/stamp covers the relocated manifest. Negative: missing/mismatched Antigravity manifest, modified/copied source, missing generated output, stale extra generated output. Bound: check-only mode leaves worktree/index unchanged and cleans temporary generation; repeat builds in fixtures produce identical owned bytes. |
| AC5 — Existing host behavior preserved | E6 | Existing `tests/claude-host-package.test.ts`, `tests/pi-only-package-surface.test.ts`, `tests/pi-only-release-contract.test.ts`, and `tests/antigravity-assurance-conformance.test.ts`; update version/path expectations as required while retaining native MCP, reviewer, package, and authorization behavior assertions. |
| AC6 — Official native validation succeeds | E2 | `agy plugin validate plugins/immune-brain-antigravity --strict --json` exits 0 with zero errors/warnings. AC1 independently prevents a misleading pass with zero agents or missing components. The known old-root/string-frontmatter failures remain recorded characterization evidence; native validator errors must not be filtered out. |

Additional implementation completion checks: both host bundle checks, docs sync check, `bun run typecheck`, and the full existing test suite because shared build/release contracts change. These supplement focused acceptance descriptors; planning does not run future acceptance suites or claim they pass.

## Implementation order and single-task boundary

1. Capture the current loader failures in package fixtures; finalize the source-to-artifact inventory from the proven reference closure.
2. Move canonical host files, correct hook commands, and extend the existing builder for the independent artifact and native agents. Keep generated shared content sourced from existing modules.
3. Update npm inclusion, unified versioning, derived-file ownership, release checks, install documentation, and the relevant existing assertions. Regenerate owned outputs.
4. Run focused checks, native strict validation, then shared build/type/regression checks. Inspect the npm artifact and disclose the install-path change.

One TaskIntent owns this coherent package correction: moving discovery roots without their dependency closure, role definitions, configuration, or release rules would leave an unusable intermediate artifact. These are implementation batches, not separately authorized tasks.

## Devil's Advocate Audit

- **Rollback resilience**: no Kernel state/schema migration or installed-host mutation is required. A partial implementation is not deliverable; missing-output/version/reference tests reject it. Revert source and generated inventory together if abandoning the change.
- **Verification vanity**: E3 showed that zero native errors can mean zero agents. AC1 requires the expected inventory and role restrictions; AC2/AC3 execute installed paths without repository siblings. Existing unit-test success cannot substitute for AC6.
- **Spec dilution detection**: a manifest-only move, removal of agents without native replacements, symlink to shared assets, ignored native warnings, or a bare server without usable public skills/CLI closure fails acceptance. This task does not claim a real model review or full Managed lifecycle certification.

## Scope and handoff completeness

All required repair outcomes map once: discovery/layout and component isolation to AC1; executable-path correction to AC2; independent installation/reference closure to AC3; package/version/release delivery to AC4; host regressions to AC5; official native-loader verification to AC6. Each implementation batch contributes to the same closable result; no separate unfinished Slice is required for this artifact to load.

No upstream Brainstorm manifest was supplied. All decisions and acceptance items have one source above. Remaining gap at planning handoff: implementation and all post-change verification are pending. The recorded old-root failures are evidence, not repaired outcomes.

Out of scope: moving Pi/Claude roots, changing Kernel authority/SQLite schemas, repairing unrelated Antigravity review-receipt or hook payload protocols, installing/updating the host, modifying user plugin settings, publishing, pushing, and real model calls. Any newly discovered runtime defect that prevents this bounded package acceptance must be reported with concrete evidence before broadening the design.
