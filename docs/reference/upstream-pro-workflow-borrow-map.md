# Upstream Borrow Map: pro-workflow

**Upstream**: [rohitg00/pro-workflow](https://github.com/rohitg00/pro-workflow)
**Submodule**: `upstreams/pro-workflow`
**Date**: 2026-05-19

Adaptation follows [`docs/solutions/upstream-pattern-integration-boundary-discipline.md`](../solutions/upstream-pattern-integration-boundary-discipline.md).

## P0 — High fit, low conflict (this slice)

| Pattern | Upstream source | Immune-Brain adaptation |
|---------|----------------|------------------------|
| Session compaction | [`commands/compact-guard.md`](../../upstreams/pro-workflow/commands/compact-guard.md), [`scripts/pre-compact.js`](../../upstreams/pro-workflow/scripts/pre-compact.js), [`scripts/post-compact.js`](../../upstreams/pro-workflow/scripts/post-compact.js) | `HANDOFF.md` remains advisory; Pi and Magic Context own compaction, so no upstream host hooks are shipped |

## P1 — Valuable, needs boundary design (future slices)

| Pattern | Upstream source | Notes |
|---------|----------------|-------|
| Deterministic hooks (secret-scan, read-before-write, git guards) | `hooks/hooks.json`, `scripts/quality-gate.js`, `scripts/secret-scan.js` | Optional user-installed hooks pack; do not embed in executor authority |
| bug-capture (domain-language issues) | `skills/bug-capture/SKILL.md` | New skill or extend `imm-pr-fix`; keep "no leaked paths" rule |
| permission-tuner / cost-tracker / mcp-audit | `skills/*/SKILL.md` | Feed into `imm-heal` or `imm-dev-insights` fields |
| thoroughness-scoring / deslop | `skills/*/SKILL.md` | Optional lens for `imm-code-review` / `imm-qa` via activation plan |
| module-map | `skills/module-map/SKILL.md` | Supplement `imm-arch-explorer` Domain Mapper output |
| Confidence scoring (research gate) | `agents/orchestrator.md` (5-dim 0–100) | Optional gate before `imm-planner`; integrate into brainstorm or planner bootstrap |
| plan-interrogate (decision tree) | `skills/plan-interrogate/SKILL.md` | Align with `imm-brainstorm` `adversarial` mode or planner opt-in gate |
| Subagent telemetry | `hooks/hooks.json` (SubagentStart, SubagentStop events) | Pi native subagent runtime owns execution visibility; host hooks are not imported |

## P2 — High cost or philosophy conflict (defer)

| Pattern | Why not import |
|---------|----------------|
| SQLite + FTS5 global memory | Conflicts with `FileSystem-as-Brain` and `docs/solutions/`; third storage alongside gstack `learnings.jsonl` |
| Wiki knowledge plane + auto-research BFS | Research infrastructure; disperses Step boundary execution; user-level opt-in only if ever adopted |
| LLM prompt hooks (`type: "prompt"`) | Host-bound, expensive, hard to regression-test |
| llm-council / hybrid RRF | No direct coupling to imm plan/QA loop |
| npm plugin distribution | imm uses `mise run install-local` + skill symlinks; no dual track |

## P3 — Already covered in Immune-Brain

| pro-workflow | Immune-Brain equivalent |
|--------------|------------------------|
| RPI three-phase orchestrator | `imm-brainstorm` → `imm-planner` → `imm-work` → `imm-qa` |
| wrap-up / learn-rule | `imm-finish` + `imm-compounder` → `docs/solutions/` |
| parallel-worktrees | `ce-worktree` / upstream gstack |
| sprint-status | State Ledger + `HANDOFF.md` |
| context-optimizer | State Ledger history bound / `HANDOFF.md` / `CONTEXT.md` |

## Non-goals (explicit)

- **No SQLite authority**: `.imm/memory/` and `docs/solutions/` remain the sole memory authority.
- **No orchestrator replacement**: `imm-work` + State Ledger remain the execution loop; pro-workflow orchestrator is reference-only.
- **No hook bundling**: pro-workflow hooks stay in the submodule for historical comparison; Pi runtime owns active hooks and subagent lifecycle.
- **No shared registry / generic dispatcher**: per `docs/solutions/rejected-shared-registry-generic-dispatcher.md`.
