# Spec: ai-eval-planner slice

**任务 ID**: IMM-EVAL-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 定义下一条 project-specific subagent slice：`ai-eval-planner`。
这个 agent 面向 AI / agent 项目中的行为变化、评估集、rubric、guardrail 与 production
monitoring 设计，负责给出只读的 eval-design 建议与风险提示。

首版只收敛 standalone contract、最小 activation host 需求、fallback，以及验证路径；
不实现通用 registry，不扩成 benchmark harness，不授予写 plan、改代码、改测试或改 workflow
state 的权限。

## 2. 问题背景

仓库已经完成两层与本任务直接相关的前置工作：

- `system-subagents-design` 已把 `ai-eval-planner` 放在 AI / agent 项目的 project-specific 层，
  并明确它不属于 conditional-risk reviewers。
- `prompt-contract-reviewer` 已闭环 standalone contract 与 dedicated activation host，证明
  project-specific slice 可以先以窄 contract + fallback + focused regression 的方式落地，
  而不必先做 registry 或多 reviewer framework。

当前缺口在于：`ai-eval-planner` 仍只存在于 README / roster prose 中，还没有一份可独立引用、
可验证、可被后续 planner / orchestrator 消费的 contract slice。

这条 slice 可以独立推进，也可以作为后续 batch rollout 中的一个独立成员执行；关键约束仍是它必须
保持 standalone contract，而不是被并入共享 reviewer framework。

## 3. 功能需求

### R1. Trigger boundary

- `ai-eval-planner` 只在以下变化面被显式触发：
  - LLM / AI 行为需要被定义或更新
  - eval set / reference set 需要补齐或调整
  - rubric / scoring dimensions 需要被定义或更新
  - guardrail checks 需要被定义或更新
  - production monitoring / observable failure signals 需要被定义或更新
- 首版不因为“AI 项目通常需要 eval”而默认常驻；必须由任务内容、diff 或交付面显式触发。

### R2. Standalone contract

- 首版必须定义独立 contract，至少包含：
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
- 首版把 `authority_class` 保持为 `advisory`。
  - 理由：虽然名称是 `planner`，但首版不应复制 `imm-planner` 的 plan-write authority；
    它只提供 eval-design 建议，由 `imm-planner` 决定是否吸收进正式 spec / plan。
- `write_boundary` 必须保持只读，不允许写 `.imm/specs/`、`docs/plans/`、实现代码、测试或
  workflow state。

推荐 contract 形状：

```yaml
id: ai-eval-planner
version: v1
role: Design AI/agent evaluation recommendations for behavior, rubric, guardrails, and monitoring changes
trigger:
  - behavior changes
  - eval set changes
  - rubric changes
  - guardrail changes
  - monitoring changes
invocation_stage:
  - plan
  - review
authority_class: advisory
tools_allowed: []
write_boundary: read-only; no plan writes, no code edits, no test edits, no workflow-state mutation
input_schema:
  behavior_surface:
    - model_behavior
    - tool_usage
    - response_contract
    - safety_guardrail
    - monitoring_signal
  success_target: required
  relevant_artifacts:
    - optional diff summary
    - optional spec or README references
    - optional prompt / schema excerpts
output_schema:
  status: ok | partial | blocked | failed
  summary: string
  eval_dimensions: []
  failure_modes: []
  reference_set_suggestion: []
  rubric_notes: []
  guardrail_checks: []
  monitoring_notes: []
  recommendations: []
  risks: []
  confidence: 0.0-1.0
failure_mode:
  unavailable_specialist: fallback to imm-planner minimal eval plan or manual acceptance path
  ambiguous_trigger: do not activate by default; require explicit trigger evidence
```

### R3. Output and fallback

- 输出必须聚焦：
  - eval dimensions
  - failure modes
  - reference set suggestion
  - rubric notes
  - guardrail checks
  - monitoring notes
- 当 dedicated `ai-eval-planner` 不可用时，fallback 必须回到：
  - `imm-planner` 明确最小 eval 方案；或
  - 若当前任务不适合补正式 eval 设计，则显式退回人工验收路径
- fallback 不得被描述成 dedicated specialist 的完整等价替代。

### R4. Minimal activation host

- 首版 runtime 目标必须定义一个最小 activation host，推荐为独立本地 skill：
  `skills/ai-eval-planner/SKILL.md`
- 该 host 必须保持：
  - trigger-only
  - advisory
  - read-only
  - no tools
  - no plan writes
  - no code edits
  - no test edits
  - no workflow-state mutation
- 不得为了激活它，直接引入 registry、自动 dispatch、多 agent 编排或评测基础设施平台。

### R5. Validation path

- 本地 focused regression 至少要覆盖：
  - standalone contract exists
  - explicit trigger surface
  - advisory-only / read-only boundary
  - fallback wording
  - minimal activation host requirement
- 若 repo 不能自动端到端证明真实 activation，可接受 Codex runtime manual validation，
  但必须写清 specialist available / unavailable 两类预期行为。

## 4. 验收标准

- [ ] `ai-eval-planner` 有独立、可引用的 contract slice，而不只是 README 中的一行 roster 描述。
- [ ] trigger 面明确覆盖 behavior / eval set / rubric / guardrail / monitoring 变化。
- [ ] contract 明确保持 `advisory` authority 与只读 write boundary。
- [ ] fallback 明确指向 `imm-planner` 的最小 eval 方案或人工验收路径。
- [ ] spec 说明独立 activation host 的目标与边界。
- [ ] focused regression 或人工验证路径证明这条 slice 不是纯文档承诺。
- [ ] 本切片不引入 registry、自动 dispatch、benchmark harness 或 plan-write authority 升级。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不构建 benchmark harness、数据标注平台、production telemetry 平台或自动评分器。
- 不把 `ai-eval-planner` 升级成默认 gate 或跨项目默认 reviewer。
- 不授予写 spec、写 plan、改代码、改测试或改 workflow state 的权限。
- 不与其他 slice 共享 registry、dispatch、benchmark harness 或写权限升级。

## 6. 依赖项

- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  对 project-specific 层、authority class 和 manifest vocabulary 的定义。
- 依赖 [project-specific-reviewer-contract-slices.md](docs/solutions/project-specific-reviewer-contract-slices.md)
  提供 standalone contract + fallback + focused regression 的收敛模式。
- 依赖 [dedicated-reviewer-activation-hosts.md](docs/solutions/dedicated-reviewer-activation-hosts.md)
  提供最小 activation host 的切片模式。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动端到端模拟真实 activation 时，使用以下人工验证路径：

### Scenario A. specialist available

1. 在支持本地 skill activation 的 Codex runtime 中，准备一次明确涉及 AI / agent 行为、
   eval set、rubric、guardrail 或 monitoring 变化的任务。
2. 显式请求 `ai-eval-planner` 参与该变更的 eval-design 审查。
3. 预期行为：
   - specialist 只以 `advisory` 身份参与；
   - 输出聚焦 eval dimensions、failure modes、reference set suggestion、rubric notes、
     guardrail checks 与 monitoring notes；
   - specialist 不写 spec、不写 plan、不改代码、不记录 QA 决策。

### Scenario B. specialist unavailable

1. 在当前环境没有 dedicated `ai-eval-planner` 路径时，触发同类 AI/agent eval-design 任务。
2. 预期行为：
   - 系统不会伪装成已有 dedicated specialist；
   - fallback 明确回到 `imm-planner` 的最小 eval 方案或人工验收路径；
   - 输出应说明这是基础替代，而不是完整等价替代。
