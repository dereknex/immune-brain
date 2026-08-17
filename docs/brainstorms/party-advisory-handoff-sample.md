---
date: 2026-05-07
topic: party-advisory-handoff-sample
---

# Party Advisory Handoff Sample

## Scenario

用户想把 BMAD Party Mode 融入 Immune-Brain，但存在一个 planning dispute：应该把 party 做成新的执行层，还是只作为 planning 前的只读会诊层。

## Sample `imm-party` Handoff

### Problem

是否引入 `imm-party`，以及它应该进入 Immune-Brain 的哪个流程位置。

### Roles consulted

- Product: 判断多角色讨论是否真的提升用户决策质量。
- Architecture: 判断 party 是否会破坏现有 `plan -> work -> review` 小步闭环。
- Implementation: 判断首版需要多少实现面。
- QA: 判断 party 输出如何被后续验收，不把讨论当成完成证据。

### Agreements

- `imm-party` 适合处理复杂取舍、跨角色分歧和可能 replan 的场景。
- `imm-party` 不应写计划、执行代码或记录 QA 结论。
- party 输出应该被压缩成 handoff，而不是把完整讨论塞给 planner。

### Disagreements

- Product 倾向让 party 出现在更多需求澄清场景。
- Implementation 倾向只在用户显式请求或 preplan/QA 需要时触发，避免流程成本扩散。

### Risks

- 如果 party consensus 被当成 scope 决策，会绕过 `imm-preplan-review`。
- 如果保留完整长对话，`imm-planner` 可能吸收噪音并扩大步骤。
- 如果没有 solo fallback，在不支持 sub-agent 的环境里会不可用。

### Scope posture suggestion

`Selective Expansion`: 新增一个只读 `imm-party` skill，但不新增运行态状态机，也不改变 `imm-executor` 或 `imm-qa` 权限。

### Recommended next skill

`imm-preplan-review`

### Handoff fields

- Origin: 用户要求分析 BMAD 多角色 party 讨论如何融合进 Immune-Brain。
- Research: 已检查 BMAD Party Mode 机制、Immune-Brain 角色边界和当前小步闭环。
- Decisions: party 作为 advisory layer；handoff 进入 preplan；preplan 保留最终 scope posture 权限。
- Assumptions: 首版只需要 skill 和文档接入；不需要新增运行态状态。

## Mapping To `imm-preplan-review`

| `imm-party` handoff field | `imm-preplan-review` field | Mapping |
|---|---|---|
| Problem | Origin | 作为本次 preplan 的问题来源。 |
| Roles consulted | Research | 说明 party 覆盖了哪些判断角度。 |
| Agreements | Research / Decisions | 可携带为已验证的共同判断，但仍需 preplan 复核。 |
| Disagreements | Assumptions / Engineering Closure Check | 标记尚未闭合的取舍或工程风险。 |
| Risks | Engineering Closure Check / Blocked By | 区分可接受风险和阻塞项。 |
| Scope posture suggestion | Scope Mode | 只能作为建议；实际 `Scope Mode` 由 `imm-preplan-review` 决定。 |
| Handoff fields | Task | 直接转写为 `Origin`、`Research`、`Decisions`、`Assumptions`。 |

## Expected Preplan Decision

- Scope Mode: `Selective Expansion`
- Research: party 建议有用，但只作为 advisory research。
- Decisions: 新增 `imm-party` skill；不新增运行态状态；不授予 planner、executor 或 QA 权限。
- Assumptions: 后续如果 party 使用频繁，再考虑是否需要 durable notes 或自动化入口。
- Engineering Closure Check: 首版验证方式是 skill 文件存在、安装入口可发现、handoff 能映射到 preplan 字段。

