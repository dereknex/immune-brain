# Spec: release-readiness-checker slice

**任务 ID**: IMM-RRC-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 定义一条 project-specific reviewer slice：`release-readiness-checker`。
这个 reviewer 面向 ship、deploy、rollback、migration rollout、feature flag 与生产开关变化，
负责输出只读的发布就绪性审查结论。

首版只收敛 docs-first manifest contract、fallback 与验证路径；不实现通用 runtime registry，
不把它升级成默认 gate，也不授予任何写 plan、改代码、改测试或改 workflow state 的权限。

## 2. 问题背景

仓库已经完成两层与本任务直接相关的前置工作：

- `system-subagents-design` 已把 `release-readiness-checker` 放进 project-specific 层，并明确它的存在理由是
  发布时机与 rollout evidence，而不是所有任务共享的风险面。
- `prompt-contract-reviewer`、`ai-eval-planner` 与 `docs-verifier` 的相邻 contract work 证明：
  当前 repo 更适合先把 project-specific reviewer 从 roster prose 收敛成 standalone contract，
  再考虑独立 activation host，而不是先做发布自动化或共享 reviewer framework。

当前缺口在于：`release-readiness-checker` 虽然已经在 README / spec 里被点名，但还没有一份独立、
可验证、可被后续 planner / reviewer / orchestrator 消费的 contract slice。

## 3. 功能需求

### R1. Trigger boundary

- `release-readiness-checker` 只在以下变化面被显式触发：
  - ship readiness changes
  - deploy procedure changes
  - rollback plan changes
  - migration rollout changes
  - feature flag changes
  - production switch changes
- 首版不因为“最终都会发布”而默认常驻；必须由任务内容、diff 或交付面显式触发。

### R2. Docs-first manifest contract

- 首版必须沿用 `system-subagents-design` 已定义的 manifest field vocabulary，至少包含：
  - `id`
  - `version`
  - `role`
  - `trigger`
  - `invocation_stage`
  - `authority_class`
  - `tools_allowed`
  - `write_boundary`
  - `input_schema`
  - `output_schema`
  - `failure_mode`
- `authority_class` 必须保持 `advisory`。
- `write_boundary` 必须保持只读，不允许写 plan、实现代码、测试或 workflow state。

推荐 contract 形状：

```yaml
id: release-readiness-checker
version: v1
role: Review release-sensitive changes for go/no-go concerns, validation gaps, and rollback readiness
trigger:
  - ship readiness changes
  - deploy procedure changes
  - rollback plan changes
  - migration rollout changes
  - feature flag changes
  - production switch changes
invocation_stage:
  - review
authority_class: advisory
tools_allowed: []
write_boundary: read-only; no plan writes, no code edits, no test edits, no workflow-state mutation
input_schema:
  changed_surface:
    - ship_readiness
    - deploy_procedure
    - rollback_plan
    - migration_rollout
    - feature_flag
    - production_switch
  context_summary: required
  relevant_artifacts:
    - optional diff summary
    - optional spec or README references
    - optional rollout notes
output_schema:
  status: ok | partial | blocked | failed
  summary: string
  go_no_go_concerns: []
  validation_checklist: []
  rollback_notes: []
  recommendations: []
  risks: []
  confidence: 0.0-1.0
failure_mode:
  unavailable_reviewer: fallback to imm-code-review or manual release checklist
  ambiguous_trigger: do not activate by default; require explicit trigger evidence
```

### R3. Output and fallback

- 输出必须聚焦：
  - go/no-go concerns
  - validation checklist
  - rollback notes
- 当 dedicated reviewer 不可用时，fallback 必须回到：
  - `imm-code-review` 的基础技术审查；或
  - 人工 release checklist
- fallback 不得被描述成 dedicated reviewer 的等价完整替代。

### R4. Validation path

- 首版必须至少有一条 focused regression 或可复现检查，证明 contract 字段、trigger 面、
  advisory-only boundary 和 fallback 路径没有只留在文档里。
- 若 repo 无法自动模拟真实 reviewer activation，则 spec 或 plan 必须提供人工 runtime
  验证路径，明确 reviewer available / unavailable 时的预期行为。

## 4. 验收标准

- [ ] `release-readiness-checker` 有独立、可引用的 docs-first contract slice，而不只是 README 中的一行 roster 描述。
- [ ] trigger 面明确覆盖 ship、deploy、rollback、migration rollout、feature flag、production switch 变化。
- [ ] contract 明确保持 `advisory` authority 与只读 write boundary。
- [ ] fallback 明确指向 `imm-code-review` / manual release checklist。
- [ ] focused regression 或人工验证路径证明该 reviewer slice 不是纯文档承诺。
- [ ] 本切片不引入 registry、自动 reviewer 派发、release automation 或执行权限升级。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不把 `release-readiness-checker` 升级成默认 gate 或所有任务的常驻 reviewer。
- 不授予写 plan、改代码、改测试、写 workflow state 的权限。
- 不构建 CI/CD 编排、自动 deploy 管线或生产变更审批系统。
- 不与 `debug-investigator` 打包成交付。

## 6. 依赖项

- 依赖 [system-subagents-design.spec.md](docs/specs/archive/system-subagents-design.spec.md)
  对 project-specific 层、manifest vocabulary 和 authority boundary 的定义。
- 依赖 [project-specific-reviewer-contract-slices.md](docs/solutions/project-specific-reviewer-contract-slices.md)
  作为 standalone contract + fallback + focused regression 的收敛模式。
- 依赖 [dedicated-reviewer-activation-hosts.md](docs/solutions/dedicated-reviewer-activation-hosts.md)
  作为独立 activation host 的相邻模式。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动模拟真实 reviewer activation 时，使用以下人工验证路径：

### Scenario A. reviewer available

1. 在支持本地 skill / reviewer activation 的 Codex runtime 中，准备一次明确涉及 ship、deploy、
   rollback、migration rollout、feature flag 或 production switch 的任务。
2. 显式请求 `release-readiness-checker` 参与审查。
3. 预期行为：
   - reviewer 只以 `advisory` 身份参与；
   - 输出聚焦 go/no-go concerns、validation checklist、rollback notes；
   - reviewer 不写 plan、不改代码、不记录 QA 决策。

### Scenario B. reviewer unavailable

1. 在当前环境没有 dedicated reviewer 路径时，触发同类 release-readiness review。
2. 预期行为：
   - 系统不会伪装成已有 dedicated reviewer；
   - fallback 明确回到 `imm-code-review` 或 manual release checklist；
   - 输出应说明这是基础发布核对，而不是完整等价替代。
