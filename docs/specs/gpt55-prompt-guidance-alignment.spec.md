# Spec: GPT-5.5 Prompt Guidance Alignment

**任务 ID**: IMM-GPT55-ALIGN-001
**负责人**: Planner
**状态**: Draft

## 1. 目标

根据 OpenAI GPT-5.5 Prompting Guide 的核心建议，对 imm-* skill 体系进行三项对齐改进：

1. BASELINE 四原则从过程导向重写为结果+成功标准导向，并补充 Collaboration Posture 共享块
2. 执行链路（imm-work / imm-executor）增加自评估停止循环（stop-check loop）和 preamble 约定
3. Research Dispatch 增加 retrieval budget 停止规则；imm-planner 输出构件补充 `failure_behavior` 和 `security_considerations` 字段

## 2. 问题背景

GPT-5.5 指南核心建议：
- **结果优先**：描述"好的结果是什么"而非每个步骤
- **停止条件明确**：每轮工具调用后自问"我现在能回答了吗"
- **Personality/Collaboration 分离**：明确"如何说话"和"如何工作"两类短块
- **Retrieval budget**：搜索/探针有明确停止判断，有足够证据时停止继续 dispatch
- **实施计划 traceability**：完整字段覆盖 failure behavior 和 privacy/security

当前缺口：
- BASELINE 四原则是过程导向（"先做什么、再做什么"）
- 无 Collaboration Posture 共享块（何时提问、何时凭合理假设推进）
- imm-work / imm-executor 无自评估停止循环
- 无 preamble 约定（多步任务开始前先发可见用户更新）
- Research Dispatch 有触发条件但无 retrieval budget 上限规则
- imm-planner 输出构件不包含 `failure_behavior` / `security_considerations` 字段

## 3. 功能需求

### R1. BASELINE 成功标准重写 + Collaboration Posture

- Shared Guards 的四原则从"做什么"改为"什么时候算成功"的成功标准形式
- 新增 Collaboration Posture 块：何时提问（缺失信息会实质改变答案或产生风险）、何时凭合理假设推进、不确定时如何处理
- 保留所有现有章节（Output Style、Boundary Baseline、Subagent Delegation Packet、Hub skill anatomy）不删除
- 只重写措辞和补充新块，不改变 authority chain 或 boundary 规则

### R2. 执行链路停止循环 + Preamble

- imm-work 和 imm-executor 各在 Workflow Rules 节增加一条 stop-check rule：每次执行轮次后自评估当前步骤是否已有足够证据闭合
- imm-work 和 imm-executor 各增加 preamble 约定：多步/工具密集任务进入执行前先发一条可见用户更新（确认请求 + 第一步说明）
- 规则简短，嵌入现有 Workflow Rules 节，不新增独立章节

### R3. Retrieval Budget + Planner Traceability

- imm-brainstorm 和 imm-planner 的 Research Dispatch 节各增加 retrieval budget 规则：当已有证据足以回答核心问题时停止继续 dispatch；仅在结果仍不足时继续
- imm-planner 的 Output artifact 节显式列出 `failure_behavior` 和 `security_considerations` 为可选字段
- 不改变 dispatch 触发条件（multi_domain >= 2），budget 规则是触发后的停止判断

## 4. 核心不变量

- BASELINE 章节结构保持：不删除 Shared Guards、Output Style、Boundary Baseline、Subagent Delegation Packet、Hub skill anatomy
- Authority chain 不变（planner 拥有计划权威；executor 拥有执行权威；qa 拥有验收权威）
- 所有改动仅为 skill 文本层；不改 .imm/ 工具 Python 代码
- 不引入 phase parameter（依赖具体 API 集成决策）
- 不重写 personality block（取决于产品定位）

## 5. 验收标准

- [ ] BASELINE Shared Guards 节以成功标准形式呈现四原则，且包含 Collaboration Posture 块
- [ ] imm-work 和 imm-executor 各包含 stop-check 自评估规则和 preamble 约定
- [ ] imm-brainstorm 和 imm-planner Research Dispatch 节各包含 retrieval budget 停止规则
- [ ] imm-planner Output artifact 节显式列出 `failure_behavior` 和 `security_considerations`
- [ ] `python3 -m unittest tests.test_skill_contracts` 退出零

## 6. 非目标

- 不引入 phase parameter 或 streaming preamble API 集成
- 不重写全局 personality block
- 不改变任何 Python .imm/ 工具代码
- 不修改计划验证器或现有 spec 结构
- 不在本切片进行 MUST/NEVER/ALWAYS 绝对指令全库审计（延后到独立切片）
