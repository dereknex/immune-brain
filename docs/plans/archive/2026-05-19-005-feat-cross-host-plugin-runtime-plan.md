---
title: "feat: migrate runtime to cross-host plugins"
type: feat
status: proposed
date: 2026-05-19
origin: "User requested a design plan for supporting Codex, Claude Code, and Cursor with bin and scripts adapted to each host, with legacy-installer.sh removable."
---

# Iteration Plan

## Task
- Summary: Move Immune-Brain distribution from a managed local installer to host-native plugin packaging for Codex, Claude Code, and Cursor, with plugin-local runtime tools replacing global `imm-*` shell wrappers.
- Origin: Conversation framing after `imm-brainstorm`: Codex should use plugin Skills plus MCP rather than Claude-style `bin`; Claude Code can use plugin `bin`; Cursor should use MCP as the reliable baseline and plugin metadata where locally verified.
- Spec: docs/specs/cross-host-plugin-runtime.spec.md
- Brainstorm manifest: BR-REQ-1, BR-REQ-2, BR-REQ-3, BR-REQ-4, BR-REQ-5, BR-DEC-1, BR-DEC-2, BR-OUT-1, BR-OUT-2, BR-OUT-3
- Research: `CONTEXT.md` defines Skill, Plan, State Ledger, and Architecture Map; current runtime is `.imm/imm-work.py`, `.imm/imm_core/`, and `.imm/memory/current_iteration.json`; current Skill source is `skills -> plugins/immune-brain/skills`; existing Codex plugin manifest is `plugins/immune-brain/.codex-plugin/plugin.json`; current public sync still copies root `skills/` plus `scripts/legacy-installer.sh`; Claude Code plugin reference supports plugin `bin/`; Codex plugin public structure supports Skills, MCP, apps, and assets; Cursor support should treat MCP as the stable baseline.
- Decisions:
    - D1: Keep `plugins/immune-brain/skills/` as the single Skill source for all hosts.
    - D2: Replace global `imm-*` as a required user surface with host-local runtime tools.
    - D3: Use Codex and Cursor MCP for runtime commands; use Claude Code `bin/` only as a host-specific adapter.
    - D4: Remove `legacy-installer.sh` only after parity is proven by plugin-local smoke validation and documentation checks.
    - D5: Keep root `skills` as a development compatibility symlink unless a later cleanup proves it is no longer needed.
- Assumptions:
    - Codex plugin support should not be treated as having Claude-style `bin` PATH behavior.
    - Cursor local plugin Skill discovery may require additional verification; MCP is sufficient as the baseline runtime adapter.
    - Users can accept host-local workflow tools instead of globally installed `imm-work` terminal commands.
- Scope Mode: Selective Migration
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/`, `.agents/plugins/marketplace.json`, potential `.claude-plugin/` and Cursor metadata, plugin-local runtime scripts or MCP server, `scripts/sync-to-public.sh`, public templates, README, focused tests
  - dependencies_known: partial; Cursor plugin metadata format must be verified during U1 before implementation relies on it
  - verification_path: host manifest JSON validation, plugin-local runtime smoke checks, public artifact checks, focused regression tests
  - blockers: none for Codex and Claude Code packaging; Cursor plugin Skill discovery must fall back to MCP if not verifiable
  - replan_condition: if Codex or Cursor require a runtime install mechanism that cannot be represented by plugin-local MCP or host metadata

## Brainstorm Manifest
| ID | Item |
|----|------|
| BR-REQ-1 | One canonical Skill source under `plugins/immune-brain/skills/` |
| BR-REQ-2 | Codex, Claude Code, and Cursor each get host-native plugin adapters |
| BR-REQ-3 | Runtime commands are host-local tools, not required global shell commands |
| BR-REQ-4 | Public release outputs plugin-first content |
| BR-REQ-5 | Bin and scripts are adapted per host: Claude `bin`, Codex MCP or Skill scripts, Cursor MCP-first |
| BR-DEC-1 | `legacy-installer.sh` is removable after parity validation, not before |
| BR-DEC-2 | Do not promise Codex or Cursor Claude-style `bin` PATH behavior |
| BR-OUT-1 | No three copies of the same Skill tree |
| BR-OUT-2 | No new generic cross-host installer |
| BR-OUT-3 | No PyPI or global default dependency for `imm_core` |

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-1 | covered_by_step | U1 | Host manifests point at one plugin Skill tree |
| BR-REQ-2 | covered_by_step | U1 | Host adapters and metadata are introduced together |
| BR-REQ-3 | covered_by_step | U2 | Runtime commands move to MCP or host-local wrappers |
| BR-REQ-4 | covered_by_step | U3 | Public sync changes to plugin-first output |
| BR-REQ-5 | covered_by_step | U2 | Bin and script behavior is implemented per host |
| BR-DEC-1 | covered_by_step | U4 | Installer removal waits for parity validation |
| BR-DEC-2 | captured_as_decision | D3 | Codex and Cursor use MCP rather than assumed PATH behavior |
| BR-OUT-1 | out_of_scope | out_of_scope | Duplication would create version drift across hosts |
| BR-OUT-2 | out_of_scope | out_of_scope | Host plugin managers remain the install authority |
| BR-OUT-3 | out_of_scope | out_of_scope | Prior rejected decision keeps `imm_core` internal |

## Steps

### Step 1
- Step ID: U1
- Result: Host plugin adapters expose the canonical Skill tree
- Verification Type: automated
- Verification: `python3 -m json.tool plugins/immune-brain/.codex-plugin/plugin.json && test -d plugins/immune-brain/skills && test -f .agents/plugins/marketplace.json && python3 -m unittest tests.test_skill_contracts`
- Depends on: none
- Scope: `plugins/immune-brain/.codex-plugin/plugin.json`, `plugins/immune-brain/.claude-plugin/`, Cursor metadata if verified, `.agents/plugins/marketplace.json`, README host install sections, `tests/test_skill_contracts.py`
- Discovery cache: plugins/immune-brain/.codex-plugin/plugin.json (existing Codex manifest); .agents/plugins/marketplace.json (Codex marketplace entry); plugins/immune-brain/skills/registry.yaml (Skill inventory); README.md (current local install docs)
- parallel_probes:
    - scope: `plugins/immune-brain/.codex-plugin`, `.agents/plugins`, `README.md`
      output: Codex manifest and marketplace gaps with exact paths
      readonly: true
    - scope: `upstreams/compound-engineering`, `docs/reference/compaction-handoff-hosts.md`
      output: Claude Code plugin and bin packaging constraints already present in repo references
      readonly: true
    - scope: `docs/specs`, `docs/solutions`, `public-release/templates`
      output: Existing installer assumptions that must be preserved or removed
      readonly: true
- Test scenarios: Codex manifest remains valid; Claude Code adapter metadata points at the same Skill tree; Cursor adapter either has verified metadata or explicitly falls back to MCP; Skill contract tests still pass.

### Step 2
- Step ID: U2
- Result: Plugin-local runtime tools replace required global shell wrappers
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_imm_work tests.test_imm_plan && python3 -m json.tool plugins/immune-brain/.mcp.json`
- Depends on: 1
- Scope: `plugins/immune-brain/.mcp.json`, plugin-local runtime scripts, `plugins/immune-brain/bin/`, `.imm/imm_core/`, `.imm/imm-work.py`, `.imm/imm-plan.py`, `.imm/imm-review.py`, `.imm/imm-heal.py`, tests for runtime smoke coverage
- Discovery cache: .imm/imm-work.py (workflow driver); .imm/imm-plan.py (Plan validator); .imm/imm-review.py (QA transition entry); .imm/imm-heal.py (health check); scripts/legacy-cli-launcher (legacy wrapper behavior to replace)
- failure_behavior: If MCP cannot cover required runtime actions, stop before removing installer and replan around a smaller compatibility layer.
- Test scenarios: MCP exposes status and plan validation; Claude `bin` wrappers call plugin-local runtime without source checkout assumptions; global `imm-*` commands are no longer required for the default workflow.

### Step 3
- Step ID: U3
- Result: Public release sync emits a plugin-first artifact
- Verification Type: automated
- Verification: `rm -rf /tmp/test-public-plugin && bash scripts/sync-to-public.sh --output-dir /tmp/test-public-plugin && test -d /tmp/test-public-plugin/plugins/immune-brain && test -f /tmp/test-public-plugin/plugins/immune-brain/.codex-plugin/plugin.json && find /tmp/test-public-plugin -name '.git' -o -name 'upstreams' -o -name 'IMMUNE.md' -o -name 'CONTEXT.md' | grep -q . && exit 1 || exit 0`
- Depends on: 1, 2
- Scope: `scripts/sync-to-public.sh`, `public-release/templates/`, `README.md`, `mise.toml`, public release tests
- Discovery cache: scripts/sync-to-public.sh (current whitelist); docs/specs/public-release-engine-sync.spec.md (superseded installer-first release contract); public-release/templates/README.md (public install docs)
- Test scenarios: Output includes plugin package and host metadata; output excludes internal private paths; output no longer treats `scripts/legacy-installer.sh` as primary install material.

### Step 4
- Step ID: U4
- Result: Legacy managed-copy installer is removed after parity checks
- Verification Type: automated
- Verification: `test ! -f scripts/legacy-installer.sh && test ! -f scripts/legacy-cli-launcher && ! rg -n "legacy-installer|legacy-cli-launcher|plugin skill registry" README.md public-release docs/specs docs/plans tests plugins`
- Depends on: 2, 3
- Scope: `scripts/legacy-installer.sh`, `scripts/legacy-cli-launcher`, `mise.toml`, README, public templates, installer tests, migration notes
- Discovery cache: scripts/legacy-installer.sh (legacy managed-copy responsibilities); tests/test_install_local.py (legacy regression surface); docs/solutions/repo-agnostic-managed-copy-markers.md (removal risks); docs/solutions/rejected-wave3-dev-install-boundaries.md (prior rejected installer changes)
- failure_behavior: If any host still requires a global shell wrapper for the default workflow, keep the installer as deprecated and split removal into a later Plan.
- Test scenarios: No user-facing docs require legacy install; no test suite assumes managed-copy installation; plugin-local smoke validation covers the removed installer responsibilities.
