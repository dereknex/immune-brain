---
title: "feat: make subagent activation MCP-first"
type: feat
status: proposed
date: 2026-05-23
origin: "User requested a plan to unify Codex, Cursor, and Claude Code around MCP and reduce repeated explicit subagent prompts."
---

# Iteration Plan

## Task
- Summary: Make Immune-Brain subagent activation MCP-first across Codex, Cursor, and Claude Code, then define a standing authorization contract that reduces repeated subagent confirmation without bypassing host tool policy.
- Origin: User confirmed that unified MCP is cleaner than PATH-based CLI wrappers and asked whether AGENTS.md can define automatic subagent invocation.
- Spec: docs/specs/mcp-first-subagent-activation.spec.md
- Research: `README.md` currently describes host-native plugin adapters and plugin-local runtime. `plugins/immune-brain/.mcp.json` exposes the shared runtime adapter, while `plugins/immune-brain/bin/imm-*` wrappers remain available but are not automatically added to PATH by Codex or Cursor. `docs/reference/automatic-subagent-activation-policy.md` keeps activation planning pure and host-bound. The current Codex `spawn_agent` tool policy requires explicit user authorization, so Skill text alone cannot safely promise unconditional automatic spawning. Upstream patterns from Compound Engineering, GSD, BMAD, and pro-workflow all separate framework eligibility from host capability or authorization gates.
- Decisions:
    - D1: Treat MCP as the primary runtime path for Codex, Cursor, and Claude Code.
    - D2: Keep `bin/` wrappers as manual/debug fallback only.
    - D3: Split subagent decisioning into eligibility and authorization.
    - D4: Add `host_authorization_required` for cases where eligibility passes but the host does not accept standing authorization.
    - D5: Let AGENTS.md express project standing authorization, but do not claim it overrides host tool policy.
- Assumptions:
    - Current hosts can load the plugin MCP server from `.mcp.json`.
    - Runtime planner behavior remains pure; user config and authorization are resolved by host Skills or runtime callers.
    - A session-level user phrase is the most reliable way to avoid repeated Codex confirmations.
- Scope Mode: Four-step feature slice
- Engineering Closure Check:
  - architecture_surface: `plugins/immune-brain/dist/immune_brain_runtime.py`, plugin MCP tests, activation policy docs, dispatch protocol docs, subagent host skill docs, AGENTS template docs
  - dependencies_known: yes; Python standard library and existing unittest coverage are sufficient
  - verification_path: focused MCP runtime tests plus skill contract tests and `imm-plan` validation
  - blockers: none
  - replan_condition: if a host exposes a first-class plugin manifest field for standing subagent authorization that supersedes AGENTS.md wording

## Steps

### Step 1
- Step ID: U1
- Result: Plugin MCP exposes activation planning as the canonical host runtime entry
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_plugin_local_runtime_surfaces_exist tests.test_skill_contracts.SkillContractTests.test_plugin_local_runtime_works_from_plugin_only_copy`
- Test scenarios: MCP tool list contains `imm_activation_plan`; plugin-only copy builds an activation plan through MCP; activation plan supports `activation_mode` without using PATH; existing `bin/imm-activation-plan` still works as manual fallback
- Discovery cache: plugins/immune-brain/dist/immune_brain_runtime.py (MCP runtime adapter); plugins/immune-brain/.mcp.json (host MCP entrypoint); tests/test_skill_contracts.py (plugin-only runtime contract)
- Execution note: test-first
- failure_behavior: If MCP activation planning cannot work from plugin-only copies, stop and fix runtime root resolution before changing host Skill wording.
- security_considerations: MCP activation planning only produces JSON; it must not dispatch agents or grant write authority.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Runtime docs establish MCP-first usage
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts`
- Test scenarios: README states Codex/Cursor/Claude use MCP as the primary runtime path; docs state `bin/` is manual/debug fallback; policy docs describe `imm_activation_plan` for catalog validation; stale managed-copy wrapper wording is no longer presented as the primary path
- Discovery cache: README.md (host adapter docs); docs/reference/automatic-subagent-activation-policy.md (activation policy); plugins/immune-brain/dist/docs/reference/automatic-subagent-activation-policy.md (packaged policy copy); tests/test_skill_contracts.py (doc contract tests)
- failure_behavior: If docs need to preserve host-specific install details, keep them under fallback/manual sections without changing the MCP-first default.
- security_considerations: Documentation must not encourage bypassing host authorization or adding broad PATH overrides.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Subagent activation policy distinguishes eligibility from authorization
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan`
- Test scenarios: policy docs define authorization sources; `host_authorization_required` appears in fallback reason docs; `explicit_required` remains config-only; `trigger_not_hit` remains trigger-only; no docs claim AGENTS.md can override host tool policy
- Discovery cache: docs/reference/automatic-subagent-activation-policy.md (fallback reasons and input contract); docs/reference/subagent-dispatch-protocol.md (dispatch lifecycle); docs/reference/immune-brain-config.md (local activation config); docs/specs/mcp-first-subagent-activation.spec.md (source spec)
- Execution note: test-first
- failure_behavior: If fallback reason expansion requires runtime schema changes, land docs and contract tests first, then defer runtime emission to a follow-up implementation slice.
- security_considerations: Authorization wording must preserve user-requested solo as the highest priority.
- Depends on: 2

### Step 4
- Step ID: U4
- Result: Standing authorization contract is documented
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts`
- Test scenarios: `imm-code-review`, `imm-ui-review`, `imm-work`, `imm-arch-explorer`, and `imm-party` describe MCP-first eligibility then authorization flow; AGENTS template includes standing authorization wording; host docs offer a one-line session authorization phrase; docs state fallback to `host_authorization_required` when host policy does not accept project standing authorization
- Discovery cache: plugins/immune-brain/dist/imm-code-review.md (catalog review host); plugins/immune-brain/dist/imm-ui-review.md (UI review host); plugins/immune-brain/dist/imm-work.md (parallel probes host); plugins/immune-brain/dist/imm-arch-explorer.md (Domain Mapper host); plugins/immune-brain/dist/imm-party.md (advisory party host); plugins/immune-brain/skills/imm-init/templates/AGENTS.md (project instruction template)
- failure_behavior: If some hosts do not support subagent dispatch at all, keep their fallback reason as `unavailable_environment` and do not add standing authorization wording there.
- security_considerations: Standing authorization applies only to bounded advisory or readonly probe work; implementation/editing subagents still need explicit scope and host policy compliance.
- Depends on: 3
