# Spec: api-contract-reviewer slice

**任务 ID**: IMM-API-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 定义第二条 conditional-risk reviewer slice：`api-contract-reviewer`。
这个 reviewer 面向跨项目的 API route、request / response schema、serialization、versioning
与 exported type contract 变化，负责输出只读的 contract 兼容性审查结论。

首版只收敛 docs-first manifest contract、fallback 与验证路径；不实现通用 runtime registry，
不把它升级成默认 gate，也不授予任何写 plan、改代码、改测试或改 workflow state 的权限。

## 2. 问题背景

仓库已经完成两层与本任务直接相关的前置工作：

- `system-subagents-design` 已把 `api-contract-reviewer` 放进 conditional-risk 层，并明确这类
  agent 只应在 contract 风险面被触发时加入，而不是默认常驻。
- `security-reviewer` 与 `prompt-contract-reviewer` 的相邻 contract work 证明：当前 repo 更适合
  先把 reviewer 从 roster prose 收敛成 standalone contract，再考虑独立 activation host，而不是先做
  registry、API diff engine 或多 reviewer framework。

当前缺口在于：`api-contract-reviewer` 虽然已经在 README / spec 里被点名，但还没有一份独立、可验证、
可被后续 planner / reviewer / orchestrator 消费的 contract slice。

## 3. 功能需求

### R1. Trigger boundary

- `api-contract-reviewer` 只在以下变化面被显式触发：
  - API route changes
  - request schema changes
  - response schema changes
  - serialization changes
  - versioning changes
  - exported type contract changes
  - public SDK / CLI contract surface changes
- 首版不因为“有接口”而默认常驻；必须由任务内容、diff 或交付面显式触发。

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
id: api-contract-reviewer
version: v1
role: Review API and exported contract changes for breaking or incompatible behavior
trigger:
  - API route changes
  - request schema changes
  - response schema changes
  - serialization changes
  - versioning changes
  - exported type contract changes
  - public SDK or CLI contract changes
invocation_stage:
  - review
authority_class: advisory
tools_allowed: []
write_boundary: read-only; no plan writes, no code edits, no test edits, no workflow-state mutation
input_schema:
  changed_surface:
    - api_route
    - request_schema
    - response_schema
    - serialization
    - versioning
    - exported_type
    - public_contract
  context_summary: required
  relevant_artifacts:
    - optional diff summary
    - optional spec or README references
    - optional API or type excerpts
output_schema:
  status: ok | partial | blocked | failed
  summary: string
  breaking_change_risk: []
  compatibility_notes: []
  consumer_impact: []
  recommendations: []
  risks: []
  confidence: 0.0-1.0
failure_mode:
  unavailable_reviewer: fallback to imm-code-review plus planner or executor contract notes
  ambiguous_trigger: do not activate by default; require explicit trigger evidence
```

### R3. Output and fallback

- 输出必须聚焦：
  - breaking-change risk
  - compatibility notes
  - consumer impact
- 当 dedicated reviewer 不可用时，fallback 必须回到：
  - `imm-code-review` 的基础技术审查；以及
  - `imm-planner` / `executor` 在当前变更范围内补最小 contract notes
- fallback 不得被描述成 dedicated reviewer 的等价完整替代。

### R4. Validation path

- 首版必须至少有一条 focused regression 或可复现检查，证明 contract 字段、trigger 面、
  advisory-only boundary 和 fallback 路径没有只留在文档里。
- 若 repo 无法自动模拟真实 reviewer activation，则 spec 或 plan 必须提供人工 runtime
  验证路径，明确 reviewer available / unavailable 时的预期行为。

## 4. 验收标准

- [ ] `api-contract-reviewer` 有独立、可引用的 docs-first contract slice，而不只是 README 中的一行 roster 描述。
- [ ] trigger 面明确覆盖 API route、request / response schema、serialization、versioning、exported types、public contract surface 变化。
- [ ] contract 明确保持 `advisory` authority 与只读 write boundary。
- [ ] fallback 明确指向 `imm-code-review` 与最小 contract notes 路径。
- [ ] focused regression 或人工验证路径证明该 reviewer slice 不是纯文档承诺。
- [ ] 本切片不引入 registry、自动 reviewer 派发、API diff 平台或执行权限升级。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不把 `api-contract-reviewer` 升级成默认 gate 或跨所有接口变更的常驻 reviewer。
- 不授予写 plan、改代码、改测试、写 workflow state 的权限。
- 不构建 consumer-compatibility 平台、API diff engine 或 version-policy framework。
- 不与 `security-reviewer`、`docs-verifier`、`ai-eval-planner` 打包成交付。

## 6. 依赖项

- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  对 conditional-risk 层、manifest vocabulary 和 authority boundary 的定义。
- 依赖 [tested-skill-contracts.md](docs/solutions/tested-skill-contracts.md)
  作为 focused regression 的首选收敛思路。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动模拟真实 reviewer activation 时，使用以下人工验证路径：

### Scenario A. reviewer available

1. 在支持本地 skill / reviewer activation 的 Codex runtime 中，准备一次明确涉及 API route、
   request / response schema、serialization、versioning、exported types 或 public contract
   变化的任务。
2. 显式请求 `api-contract-reviewer` 参与审查。
3. 预期行为：
   - reviewer 只以 `advisory` 身份参与；
   - 输出聚焦 breaking-change risk、compatibility notes、consumer impact；
   - reviewer 不写 plan、不改代码、不记录 QA 决策。

### Scenario B. reviewer unavailable

1. 在当前环境没有 dedicated reviewer 路径时，触发同类 API / contract review。
2. 预期行为：
   - 系统不会伪装成已有 dedicated reviewer；
   - fallback 明确回到 `imm-code-review` 与最小 contract notes；
   - 输出应说明这是基础 contract 审查，而不是完整等价替代。
