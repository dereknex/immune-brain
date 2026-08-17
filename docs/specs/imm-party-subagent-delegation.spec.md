# Spec: imm-party subagent delegation

**任务 ID**: IMM-PARTY-002
**负责人**: Planner
**状态**: Accepted（验收证据：skills/imm-party/SKILL.md 含 Dispatch Protocol 段落 + delegation packet contract + named fallback reasons；focused regression 在 tests/test_skill_contracts.py；§7 Codex manual validation path 已定义）

## 1. 目标

把 `imm-party` 在显式 `party mode` / `multi-agent discussion` /
`independent agents` 请求下的 sub-agent delegation，收敛成首个可执行、可验证的
runtime-level subagent slice。

本规格只覆盖 `imm-party` 的只读 advisory delegation path，不实现通用 system
subagent registry、自动 trigger engine、条件风险层 runtime 接入，或长期
subagent memory。

## 2. 问题背景

仓库已经完成两层前置工作：

- `system-subagents-design` 已把 authority boundary、manifest contract 和
  non-goals 讲清楚。
- `workflow-trigger-repair` 已把“subagents 从未激活过”收窄为：显式 multi-agent
  请求时必须有最小可验证激活路径或明确 fallback。

当前缺口不在治理文档，而在 `imm-party` 的运行态接面：现有 skill 已声明
“支持 sub-agents 的环境必须使用 delegation mechanism”，但 repo 里还没有把这条
规则进一步收敛为 execution-ready 的 delegation packet、named fallback
reasons、以及本地 contract regression + Codex runtime manual check 的组合验证。

## 3. 功能需求

### R1. 显式激活边界

- 只有当用户显式请求 `party mode`、`multi-agent discussion`、
  `independent agents` 或 `parallel agent perspectives` 时，`imm-party`
  才尝试真实 sub-agent delegation。
- delegation 默认使用 `2` 个只读 advisory roles；只有在分歧影响 scope posture
  时才升到 `3`，只有在 verification / UX / handoff 风险仍不清时才升到 `4`。
- 真实 delegation 不得改变 `imm-party` 的 advisory 身份；scope、plan、execution
  和 QA authority 仍保留给现有 `imm-*` role。

### R2. Delegation packet contract

- `imm-party` 必须定义最小 delegation packet，至少包含：
  - one shared context for all selected roles per round
  - role identity and per-role focus delta
  - current user question / decision under discussion
  - read-only boundary
  - no tools / no file edits / no workflow-state mutation instruction
  - concise advisory-only output expectation
- contract 必须保持 provider-agnostic；首版不为某一运行时实现 registry 或共享
  capability layer。
- execution-ready contract 必须允许父 orchestrator 直接把 packet 映射成一次
  sub-agent delegation，而不需要额外发明共享 registry 字段。

推荐 packet 形状：

```text
- delegation_context:
  - shared_context_summary: <shared background for all selected roles>
- delegation_packet:
  - role: <selected advisory role>
  - focus_delta: <specific delta lens for this role>
  - decision_under_discussion: <user question or tradeoff>
  - boundary: read-only advisory only; no code edits, no plan writes, no workflow-state mutation, no QA closure
  - tool_policy: no tools
  - output_expectation: delta-only advisory perspective only
```

### R3. Fallback contract

- 当环境不支持 sub-agents、成本不合适、或用户并未显式请求 independent agents
  时，`imm-party` 必须明确走 solo fallback。
- fallback 输出必须命名原因，而不是静默模拟“已激活 sub-agents”。
- fallback 不得被描述成失败；它是符合边界的受控降级路径。
- 首版 fallback reason 固定为：
  - `unavailable_environment`
  - `cost_scope_mismatch`
  - `no_explicit_subagent_request`

### R4. 验证路径

- 本地 focused regression 必须覆盖 delegation contract 本身：
  - explicit-request-only trigger
  - default-2 role policy plus escalation triggers
  - bounded prompt fields
  - named fallback reasons
  - no direct scope / plan / execution / QA authority escalation
- 若真实 delegation 无法在本地单测中可靠模拟，计划与文档必须提供 Codex runtime
  manual validation path。

## 4. 验收标准

- [ ] `imm-party` 的 skill contract 可直接指导显式 independent-agent 请求下的真实 delegation。
- [ ] delegation packet 至少定义角色、问题、压缩上下文、只读边界与 advisory-only 输出约束。
- [ ] solo fallback 会明确说明原因，不会静默冒充真实 sub-agent activation。
- [ ] focused regression 守住上述 contract，避免未来回退成纯文档承诺。
- [ ] 真实 delegation 若依赖 Codex runtime，计划中有清晰的人工验证步骤。
- [ ] 本切片不引入通用 registry、自动 subagent 选择、agent-to-agent 通信或长期 memory。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不实现自动按 diff 或项目类型选择 subagents。
- 不把 `security-reviewer`、`api-contract-reviewer`、`executor` 等非 advisory 类
  system subagents 一并接入 runtime。
- 不引入长期 subagent state、agent-to-agent 通信、后台任务或 heartbeat。
- 不修改 `imm-preplan-review`、`imm-planner`、`imm-work`、`imm-executor`、
  `imm-qa` 的 authority boundary。

## 6. 依赖项

- 依赖 [party-mode-advisory.spec.md](docs/specs/party-mode-advisory.spec.md)
  的 advisory layer 语义与 solo fallback 前提。
- 依赖 [workflow-trigger-repair.spec.md](docs/specs/workflow-trigger-repair.spec.md)
  对显式 sub-agent 激活路径的收口。
- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  的 non-goals 与 authority boundary。
- 依赖 [tested-skill-contracts.md](docs/solutions/tested-skill-contracts.md)
  的 focused contract regression 模式。

## 7. Codex Runtime Manual Validation

当 repo 内无法端到端自动模拟真实 delegation 时，使用以下人工验证路径：

### Scenario A. delegation available

1. 在支持 sub-agent delegation 的 Codex runtime 中，请求一次显式独立会诊，例如：
   `[$imm-party] ... use independent agents for Product and QA to debate whether this task should hold scope`
2. 预期行为：
   - 父 orchestrator 为默认 `2` 个只读 advisory roles 使用真实 delegation mechanism；
     只有在触发升级条件时才升到 `3/4`。
   - 每个 delegated role 都收到一份 bounded packet，至少包含 role、focus、
     decision under discussion、compressed context、read-only boundary、`no tools`
     与 advisory-only output expectation。
   - 最终聚合输出仍保持 `imm-party` advisory 身份，不直接写 plan、不改代码、不记录 QA 决策。

### Scenario B. delegation unavailable

1. 在不支持 delegation 的 runtime 中，或在当前环境无法调用 sub-agents 时，发起同类显式 independent-agent 请求。
2. 预期行为：
   - 系统不会假装已经生成独立 agents。
   - 输出明确声明进入 solo fallback。
   - fallback reason 使用固定命名 `unavailable_environment`。

### Scenario C. no explicit independent-agent request

1. 请求普通 `party mode` / `roundtable`，但不要求 independent agents。
2. 预期行为：
   - 系统可以直接使用 solo mode。
   - fallback reason 使用固定命名 `no_explicit_subagent_request`，而不是把 solo mode 伪装成 delegation failure。
