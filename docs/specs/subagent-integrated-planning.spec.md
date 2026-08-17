# Spec: Subagent-Integrated Planning

**任务 ID**: IMM-SUBAGENT-PLAN-001
**负责人**: Planner
**状态**: Draft

## 1. 目标

把 subagent 从「执行期的即兴优化」升级为「规划期的一等公民」：planner 拆 step 时就定义哪些子任务可以并行委派、由谁做、产出什么；同时扩展审查覆盖、引入调研并行、补充对抗视角、建立度量闭环。

覆盖五个递进阶段：

1. **扩展审查 catalog**：把已有条件风险 reviewer 接入确定性触发目录
2. **并行调研**：brainstorm/planner 阶段允许只读并行摸底
3. **执行辅助（规划期内嵌）**：planner 在 step 结构里定义 `parallel_probes`，executor 按 plan 拿证据再改代码
4. **对抗视角**：preplan 阶段可选 dispatch fresh-context 对抗审查
5. **度量闭环**：记录 dispatch 结果并收紧触发

## 2. 问题背景

当前 subagent 体系的治理、协议、宿主三层已完备。核心缺口：

- `subagent-trigger-catalog.yaml` 只覆盖 `imm-code-review` 的 2 个 child（security-reviewer、api-contract-reviewer）；其余 7 个 reviewer 未接入 catalog
- brainstorm / planner 阶段无显式 subagent dispatch 路径
- planner 的 step schema 无「并行子任务」结构；executor 只能顺序做
- preplan 无对抗 subagent；party 部分覆盖但不在 preplan 链路
- 无 dispatch 效果度量

## 3. 功能需求

### R1. 扩展审查 catalog

- `subagent-trigger-catalog.yaml` 新增 `data-integrity-reviewer` 和 `reliability-reviewer` 的 trigger surface
- `imm-code-review` 的 `max_parallel_children` 从 2 调整为 3
- `imm-ui-review` 的 trigger matching 从纯叙事补充为 catalog 级条目（可选，本切片仅评估可行性）
- 新增 child 的 trigger 必须与各 reviewer SKILL.md 的 "When to use" 段对齐
- 新增的契约测试覆盖 catalog 解析与新 child entry

### R2. 并行调研

- `imm-brainstorm` 和 `imm-planner` 可选引用 dispatch protocol 做只读并行调研
- 触发条件：`multi_domain >= 2` 或用户显式要求
- 调研 subagent 用 `generalPurpose` readonly，prompt 限定 scope 和 output 格式
- 调研产出汇总回主线程后才进入决策
- 不写 `.imm/` 状态、不写 spec/plan 文件、不改实现

### R3. 执行辅助（规划期定义）

- planner 的 step 结构允许可选 `parallel_probes` 或等效叙事字段
- 每个 probe 定义 `scope`（文件/目录）、`output`（预期产出）、`readonly: true`
- `imm-work` 识别 step 有 probe 定义时，先 dispatch readonly subagent 收集证据，再进 executor
- executor 接收 probe 结果作为输入上下文，不自行 spawn
- probe 只在 step 涉及 3+ 个不重叠文件区域时由 planner 标记
- probe 失败时 executor 顺序内联完成同等调查，记录 fallback reason

### R4. 对抗视角

- `imm-preplan-review` 可选 dispatch 一个 readonly adversarial subagent
- 触发条件：scope 有重大架构变更、跨模块影响、或用户显式要求
- subagent 用 fresh context 独立审视 spec/brainstorm 结论
- 产出标注 `source: adversarial_voice`，preplan 宿主决定采纳或记录
- 失败不 gate（preplan 继续）

### R5. 度量闭环

- `imm-compounder` 沉淀 dispatch 结果时增加可选字段：`dispatch_count`、`solo_fallback_count`、`fallback_reasons` 分布
- planner / code-review 在输出 artifact 里可选记录 dispatch 摘要
- 未来可据此收紧或松弛 catalog 触发面

## 4. 核心不变量

- `imm-planner` 拥有计划权威，subagent 不直接写 plan
- `imm-executor` 拥有执行权威，subagent 只提供证据
- `imm-qa` 拥有验收权威，subagent 不关闭 step
- 所有 subagent 默认 readonly
- dispatch protocol 六阶段不变
- authority class 不升级

## 5. 验收标准

- [ ] catalog 扩展覆盖 data-integrity-reviewer 和 reliability-reviewer
- [ ] brainstorm/planner 有可选调研 dispatch 段落且引用 protocol
- [ ] planner step schema 支持 parallel_probes 或等效结构
- [ ] imm-work 能识别 probe 并 dispatch
- [ ] preplan 有可选对抗 dispatch 段落
- [ ] compounder 有可选 dispatch 度量字段
- [ ] 所有新增契约测试通过
- [ ] plan validator 通过

## 6. 非目标

- 不实现通用 subagent registry 或后台 scheduler
- 不引入 agent-to-agent 通信
- 不允许 probe subagent 写代码
- 不改变 authority chain
- 不在本切片覆盖项目专用层 reviewer
- 不强制每个 step 都有 probe（planner 按需标记）
