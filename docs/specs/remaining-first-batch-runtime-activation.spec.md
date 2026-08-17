# Spec: remaining first-batch runtime activation

**任务 ID**: IMM-BATCH-002
**负责人**: Planner
**状态**: Superseded（当前事实：`security-reviewer` 与 `api-contract-reviewer` 独立 skill surface 已删除；条件风险审查通过 `imm-advisory-reviewer` 的 `security` / `api_contract` lenses 触发）

## 1. 目标

把 `first-subagent-batch` 中尚未进入可激活状态的最后两条 reviewer slice，
`security-reviewer` 与 `api-contract-reviewer`，推进到最小 runtime activation-host 层。

本轮历史目标不是继续扩 roster，也不是把 README 里所有已命名 subagents 一次性全部补齐，
而是让“首批已承诺要进入 activation roadmap 的 4 条 slice”真正都具备可显式触发入口。当前入口已合并为 `imm-advisory-reviewer` lenses。

## 2. 问题背景

当前仓库里，`prompt-contract-reviewer`、`ai-eval-planner` 与 `docs-verifier` 已经完成了
project-specific runtime activation-host 闭环：

- 存在独立或 lens-based activation surface
- 存在 runtime slice spec
- 存在 focused regression 与 manual validation 路径

与此同时，`security-reviewer` 与 `api-contract-reviewer` 仍停留在 docs-first contract 层：

- 已有 standalone slice spec
- 已有 batch 级与 slice 级计划
- 尚无独立的 runtime activation host

这造成两个问题：

1. `first-subagent-batch` 的 4 条 slice 仍未全部进入“可激活使用”状态；
2. README 中“已命名的 subagents”与“当前真的可激活的 subagents”之间仍存在能力落差。

当前更合理的最小真相是：先补齐首批剩余的两条 conditional-risk reviewer runtime slices，
而不是一次性把 `data-integrity-reviewer`、`reliability-reviewer`、
`release-readiness-checker`、`debug-investigator` 也纳入本轮。

## 3. 功能需求

### R1. Scope boundary

- 本轮只覆盖：
  - `security-reviewer`
  - `api-contract-reviewer`
- 本轮必须保持：
  - `advisory`
  - read-only
  - trigger-only
  - non-default
- 本轮不得引入：
  - shared runtime registry
  - shared dispatch / capability detection
  - multi-reviewer composition
  - agent-to-agent communication
  - 非只读权限

### R2. security-reviewer runtime host

- 当前 runtime 不再定义独立 `security-reviewer` skill；使用 `imm-advisory-reviewer` 的 `security` lens。
- host 必须可被显式触发，用于以下变化面：
  - authentication / authorization changes
  - input validation or deserialization changes
  - public endpoints or externally reachable surfaces
  - secrets handling or credential flow changes
  - permission model or access policy changes
  - security-sensitive configuration changes
- host 必须明确：
  - advisory-only / read-only boundary
  - required inputs
  - output focus
  - unavailable fallback
  - non-default gate posture

### R3. api-contract-reviewer runtime host

- 当前 runtime 不再定义独立 `api-contract-reviewer` skill；使用 `imm-advisory-reviewer` 的 `api_contract` lens。
- host 必须可被显式触发，用于以下变化面：
  - API route changes
  - request schema changes
  - response schema changes
  - serialization changes
  - versioning changes
  - exported type contract changes
  - public SDK / CLI contract surface changes
- host 必须明确：
  - advisory-only / read-only boundary
  - required inputs
  - output focus
  - unavailable fallback
  - non-default gate posture

### R4. Truthful activation and verification contract

- repo contract 必须能真实表达：
  - `prompt-contract-reviewer`
  - `ai-eval-planner`
  - `docs-verifier`
  - `security-reviewer`
  - `api-contract-reviewer`
  都已进入可激活 skill-host 层
- focused regression 必须至少覆盖：
  - 两个新 host 存在
  - trigger-only / read-only boundary
  - fallback wording
  - non-default posture
- 若 repo 无法自动证明真实 reviewer activation，则必须继续保留 Codex runtime manual
  validation 路径，并明确 available / unavailable 两类预期行为。

## 4. 验收标准

- [x] `security` lens 存在可引用 runtime activation path。
- [x] `api_contract` lens 存在可引用 runtime activation path。
- [x] 两条 lens 都保持 `advisory`、只读和 trigger-only posture。
- [x] `security` lens fallback 仍收敛到 `imm-code-review` 与最小 security notes。
- [x] `api_contract` lens fallback 仍收敛到 `imm-code-review` 与最小 contract notes。
- [x] focused regression 与 manual runtime validation 至少共同证明：首批相关能力已进入可激活功能层。
- [x] 本轮没有把 scope 扩成 data / reliability / release / debug reviewer backlog，也没有引入 shared runtime 平台。

## 5. 非目标

- 不新增 `data-integrity-reviewer` 的 docs-first 或 runtime slice。
- 不新增 `reliability-reviewer` 的 docs-first 或 runtime slice。
- 不新增 `release-readiness-checker` 的 docs-first 或 runtime slice。
- 不新增 `debug-investigator` 的 docs-first 或 runtime slice。
- 不实现 runtime registry、自动 reviewer selection 或共享 orchestration 框架。
- 不把 conditional-risk reviewers 升级成默认 gate。

## 6. 依赖项

- 依赖 [first-subagent-batch.spec.md](docs/specs/first-subagent-batch.spec.md)
  作为首批 4 条 slice 的 batch boundary。
- 依赖 [security-reviewer.spec.md](docs/specs/security-reviewer.spec.md)
  与 [api-contract-reviewer.spec.md](docs/specs/api-contract-reviewer.spec.md)
  作为两条 conditional-risk docs-first contract 的基线。
- 依赖 [dedicated-reviewer-activation-hosts.md](docs/solutions/dedicated-reviewer-activation-hosts.md)
  作为“先补独立 host，再谈 shared runtime”的模式来源。
- 依赖 [first-subagent-batch-rollout.md](docs/solutions/first-subagent-batch-rollout.md)
  作为 batch 内独立闭合 slice 的 rollout 模式。
