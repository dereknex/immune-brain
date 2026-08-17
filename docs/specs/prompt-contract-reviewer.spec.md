# Spec: prompt-contract-reviewer slice

**任务 ID**: IMM-PROMPT-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 定义下一条 project-specific subagent slice：`prompt-contract-reviewer`。
这个 reviewer 面向 AI / agent 项目中的 system prompt、tool contract、agent
instruction、structured output 与 safety boundary 变更，负责做只读一致性与风险审查。

首版只收敛 docs-first manifest contract、fallback、以及验证路径；不实现通用
system subagent runtime registry，不扩大到条件风险层全量 reviewer，也不授予任何执行权限。

## 2. 问题背景

仓库已经完成两层与本任务直接相关的前置工作：

- `system-subagents-design` 已明确 project-specific 层与 conditional-risk 层的分离，并把
  `prompt-contract-reviewer` 放在 AI / agent 项目的 project-specific 层。
- `imm-party` explicit delegation slice 已证明：对只读 advisory 能力，先收敛 execution-ready
  packet、固定 fallback names 和人工 runtime 验证路径，比直接跳到 registry 更稳。

当前缺口在于：`prompt-contract-reviewer` 虽然已经在 README / spec 中被点名，但还没有一份可独立执行、
可被后续 planner / reviewer / orchestrator 消费的 contract slice。结果是它仍停留在 roster 名称层，而不是可验证能力。

## 3. 功能需求

### R1. Trigger boundary

- `prompt-contract-reviewer` 只在以下变化面被显式触发：
  - system prompt
  - tool contract
  - agent instruction
  - structured output schema
  - safety boundary
- 首版不因为“AI 项目通常有风险”而默认常驻；必须由任务内容、diff 或交付面显式触发。

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
id: prompt-contract-reviewer
version: v1
role: Review prompt, tool, instruction, and structured-output contract changes in AI/agent projects
trigger:
  - system prompt changes
  - tool contract changes
  - agent instruction changes
  - structured output schema changes
  - safety boundary changes
invocation_stage:
  - review
authority_class: advisory
tools_allowed: []
write_boundary: read-only; no plan writes, no code edits, no test edits, no workflow-state mutation
input_schema:
  changed_surface:
    - prompt
    - tool_contract
    - instruction
    - structured_output
    - safety_boundary
  context_summary: required
  relevant_artifacts:
    - optional diff summary
    - optional spec or README references
output_schema:
  status: ok | partial | blocked | failed
  summary: string
  findings:
    - instruction_conflicts
    - output_schema_risks
    - safety_regressions
  recommendations: []
  risks: []
  confidence: 0.0-1.0
failure_mode:
  unavailable_reviewer: fallback to scope-reviewer plus imm-code-review
  ambiguous_trigger: do not activate by default; require explicit trigger evidence
```

### R3. Output and fallback

- 输出必须聚焦：
  - instruction conflicts
  - output schema risk
  - safety regression
- 当 dedicated reviewer 不可用时，fallback 必须回到 README 已声明的基础路径：
  `scope-reviewer` + `imm-code-review`。
- fallback 不得被描述成“等价完整替代”；它只负责基础一致性审查。

### R4. Validation path

- 首版必须至少有一条 focused regression 或可复现检查，证明 contract 字段、trigger 面、
  advisory-only boundary 和 fallback 路径没有只留在文档里。
- 若 repo 无法自动模拟真实 reviewer delegation，则 spec 或 plan 必须提供人工 runtime
  验证路径，明确 delegation available / unavailable 时的预期行为。

## 4. 验收标准

- [ ] `prompt-contract-reviewer` 有独立、可引用的 docs-first contract slice，而不只是 README 中的一行 roster 描述。
- [ ] trigger 面明确覆盖 prompt / tool contract / instruction / structured output / safety boundary。
- [ ] contract 明确保持 `advisory` authority 与只读 write boundary。
- [ ] fallback 明确指向 `scope-reviewer` + `imm-code-review`。
- [ ] focused regression 或人工验证路径证明该 reviewer slice 不是纯文档承诺。
- [ ] 本切片不引入 registry、自动 reviewer 派发、agent-to-agent 通信或执行权限升级。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不把 `prompt-contract-reviewer` 升级成默认 gate 或跨项目默认 reviewer。
- 不与 `security-reviewer`、`api-contract-reviewer`、`reliability-reviewer` 绑定成交付。
- 不授予写 plan、改代码、改测试、写 workflow state 的权限。
- 不在首版引入新的持久 reviewer state。

## 6. 依赖项

- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  对 project-specific 层、manifest vocabulary 和 authority boundary 的定义。
- 依赖 [bounded-advisory-delegation-packets.md](docs/solutions/bounded-advisory-delegation-packets.md)
  提供只读 reviewer 进入真实 delegation 前的最小 packet / fallback / manual validation 模式。
- 依赖 [tested-skill-contracts.md](docs/solutions/tested-skill-contracts.md)
  作为 focused regression 的首选收敛思路。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动模拟真实 reviewer delegation 时，使用以下人工验证路径：

### Scenario A. reviewer available

1. 在支持 sub-agent delegation 的 Codex runtime 中，准备一次明确涉及 prompt / tool contract / instruction / structured output / safety boundary 的 AI/agent 变更。
2. 显式请求 `prompt-contract-reviewer` 参与该变更审查。
3. 预期行为：
   - reviewer 只以 `advisory` 身份参与；
   - 输出聚焦 instruction conflicts、output schema risks、safety regressions；
   - reviewer 不写 plan、不改代码、不记录 QA 决策。

### Scenario B. reviewer unavailable

1. 在当前环境没有 dedicated reviewer 路径时，触发同类 AI/agent contract review。
2. 预期行为：
   - 系统不会伪装成已有 dedicated reviewer；
   - fallback 明确回到 `scope-reviewer` + `imm-code-review`；
   - 输出应说明这是基础一致性审查，而不是完整等价替代。
