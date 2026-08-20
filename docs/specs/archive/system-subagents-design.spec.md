# Spec: System subagents design

**任务 ID**: IMM-SUBAGENTS-001
**负责人**: Planner
**状态**: Accepted（验收证据：三层 roster + manifest contract + authority boundary 已落地至 README/IMMUNE.md/skill contracts；所有首版核心 subagent 有 SKILL.md；条件风险层 trigger-only；tests/test_skill_contracts.py 通过）

## 1. 目标
为 Immune-Brain 定义一套系统级 subagent 设计：既能覆盖不同用户场景和项目类型，又不破坏现有 `brainstorm -> preplan -> plan -> work -> review -> compound` 小步闭环。

本规格只定义 subagent roster、启用边界、契约和验证要求。首版不创建自动调度平台，不允许 subagent 直接绕过 `imm-work`、`imm-executor` 或 `imm-qa`。
首轮规划与实现优先收敛治理与文档契约：authority matrix、routing boundary、manifest/output contract，以及项目专用层的最小首版范围。

## 2. 上游依据
- **BMAD**: 提供 Analyst、PM、Architect、Dev、UX、Writer 等角色范式，以及 Party Mode 的多角色讨论体验。可借鉴角色视角，但不得把讨论共识直接转成执行权限。
- **Compound Engineering**: 提供大量条件触发 reviewer/researcher agents。可借鉴专家库，但首版必须避免 50+ agents 的维护成本。
- **GSD**: 提供 thin orchestrator、fresh context、file-based state、agent contracts 和 verifier 模型。应作为系统架构主参考。
- **gstack**: 提供实战 review、QA、ship、fix-first 和发布前闸门。适合作为 PR/QA/发布类 subagent 的行为参考。
- **impeccable**: 提供 UI 质量、设计上下文、可访问性、响应式和 polish gates。只应作为 UI 项目专用能力，不应成为所有项目默认流程。

### 2.1 上游取舍原则
首版 system subagents 不是上游 roster 的搬运版，而是只吸收能落到现有 `imm-*` 闭环里的模式：

- **BMAD**: 借 Party Mode 的多角色会诊和规格驱动意识；拒绝把 advisory 角色升级成计划、执行或验收 authority。
- **Compound Engineering**: 借专家型 reviewer / worker 分工与 docs-first 知识复利；拒绝大规模默认专家 roster。
- **GSD**: 借 orchestrator 控制权、file-based state 和 agent contract；拒绝完整项目管理层级和阶段常驻 agent。
- **gstack**: 借 review、QA、release 等闸门式角色分离；拒绝让每个任务默认经过所有闸门。
- **impeccable**: 借 UI 质量与设计一致性视角；拒绝把 UI 审查扩展成所有项目的默认 gate。

## 3. 功能需求

### R1. 分层 roster
系统 subagents 必须分为三层：

- **核心闭环层**: 默认可用，覆盖理解项目、控制范围、计划、执行、验收、沉淀。
- **条件风险层**: 仅在 diff 或任务触及对应风险时启用，例如 security、data、API、reliability、UI。
- **项目专用层**: 仅在特定项目类型中启用，例如 AI eval、prompt contract、docs verification、release readiness、debug investigation。

### R2. 核心 subagents
首版核心集合不得超过 8 个，推荐为：

- `context-mapper`
- `scope-reviewer`
- `planner`
- `executor`
- `qa-verifier`
- `code-reviewer`
- `ui-reviewer`
- `knowledge-compounder`

其中 `planner`、`executor`、`qa-verifier`、`knowledge-compounder` 应映射到现有 Immune-Brain skill 边界，而不是另起平行流程。

### R3. authority 与 routing 边界
系统必须显式区分只读 advisory 能力与受控执行能力：

- `imm-party` 是独立的只读会诊层，不等同于系统 subagent roster。
- system subagents 可以提供 advisory、planning artifact 生成、active-step bounded execution 或 review evidence，但必须写清楚哪一类能力适用。
- 最终 scope posture、计划拆步、active-step 执行权限和闭合判断，仍分别保留给 `imm-preplan-review`、`imm-planner`、`imm-executor` / `imm-work`、`imm-qa`。
- 不允许任何 subagent 通过“研究结论”或“并行意见”静默升级成 scope authority 或 execution authority。

### R4. 条件风险 subagents
第二阶段可增加以下条件触发 agents：

- `security-reviewer`
- `data-integrity-reviewer`
- `api-contract-reviewer`
- `reliability-reviewer`

每个风险 agent 必须有清晰触发条件、只读/可写边界、输出 schema 和失败处理。条件风险层只保留跨项目高复用、主要由 diff 或任务风险面触发的 reviewer；不把交付方式或项目类型驱动的 agent 混进来。

### R5. 项目专用层
项目专用层必须保持最小、按项目类型显式启用，首版只要求定义高信号候选而不默认常驻：

- AI / agent 项目：`ai-eval-planner`、`prompt-contract-reviewer`
- docs-heavy / public package 项目：`docs-verifier`
- release / incident / tricky bug 场景：`release-readiness-checker`、`debug-investigator`

项目专用层必须写清楚触发条件、为什么不属于核心层或条件风险层，以及不用时的 fallback。其存在理由是项目类型、交付方式或故障场景，而不是所有任务共享的通用风险面。

### R6. 场景化启用
系统必须支持按用户和项目场景选择最小集合：

- 个人开发者: 偏 `context-mapper`、`executor`、`qa-verifier`、`code-reviewer`。
- 创业产品团队: 增加 `scope-reviewer`、`ui-reviewer`；在 ship 前按需加入 `release-readiness-checker`。
- 成熟 SaaS 或企业系统: 增加 `security-reviewer`、`data-integrity-reviewer`、`api-contract-reviewer`、`reliability-reviewer`。
- AI 或 Agent 项目: 增加 `security-reviewer`；需要行为契约或评估时再加入 `prompt-contract-reviewer`、`ai-eval-planner`、`docs-verifier`。
- 开源 SDK 或 CLI: 增加 `api-contract-reviewer`、`security-reviewer`；需要 public docs 或 release 说明时再加入 `docs-verifier`、`release-readiness-checker`。

### R7. Subagent manifest
每个 subagent 必须有可机器读取或可稳定解析的契约字段。首版先定义 docs-first 的最小必填集合：

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

首版可以先以 Markdown/YAML 文档形式落地，不要求实现 runtime registry，也不要求为了这些字段引入 provider-specific execution layer。

如未来要把文档契约升级为 runtime registry，可在不改变首版治理边界的前提下追加以下保留字段：

- `state_access`
- `timeout_ms`
- `max_retries`

其中：

- `invocation_stage` 至少要说明该 agent 主要服务于 brainstorm / preplan / plan / work / review / compound 的哪一段。
- `authority_class` 至少区分 `advisory`、`planning-artifact-writer`、`active-step-bounded-executor`、`review-evidence-producer`。
- `write_boundary` 至少要说明该 agent 是否只读，还是只允许写 planning artifact、当前 active step 范围文件、或 `docs/solutions/` 这类受控目标。

首版 contract 适用于三层 roster：

- 核心闭环层必须逐个公布完整 manifest-style contract。
- 条件风险层至少要先公开 trigger、authority class、write/tool boundary 和输出摘要，避免被默认拉进流程。
- 项目专用层只在项目类型明确需要时补充 manifest entry；未启用时必须写明 fallback，而不是把它们伪装成核心默认成员。

### R8. 输出契约
所有系统 subagent 输出必须可被 orchestrator 验证和汇总，推荐字段：

```json
{
  "status": "ok | partial | blocked | failed",
  "summary": "...",
  "findings": [],
  "recommendations": [],
  "risks": [],
  "needs_user_input": false,
  "confidence": 0.0
}
```

自由散文只能作为用户展示层，不能作为唯一系统接口。

### R9. 权限边界
- 默认只读。
- 默认不写 `.imm/memory/current_iteration.json`。
- 默认不修改实现文件。
- 默认不自行派生新的 subagent。
- 可写 subagent 必须绑定明确文件范围、active step 或 PR blocker。
- 最终执行、验收、scope posture 仍分别由 `imm-executor`、`imm-qa`、`imm-preplan-review` 所在流程负责。

### R10. 验证要求
落地后至少能验证：

- README 或治理文档能解释三层 roster 和场景化启用。
- README 或治理文档能解释 `imm-party` 与 system subagents 的边界，以及 advisory / bounded execution 的 authority 区分。
- 每个首版核心 subagent 都有职责、触发条件、权限和输出契约。
- manifest 字段至少能表达 trigger、invocation stage、authority class、write/tool boundary 和最小输出契约。
- 风险 subagent 只作为条件触发清单，不会默认扩大流程。
- 项目专用层只保留最小首版集合，并写明 trigger 与 fallback。
- 计划或文档明确说明哪些上游模式被采纳，哪些被拒绝。
- `python3 .imm/imm-plan.py <plan-path> --json` 通过。

## 4. 非目标
- 不实现完整自动调度平台、后台队列、跨会话 scheduler 或 shared runtime registry。
- 不禁止显式 host skill 在单次会话内使用确定性规则表选择 bounded child
  subagents；这类 session-scoped activation table 只能输出 activation plan，
  不拥有 execution、scope 或 QA authority。
- 不一次性引入上游所有 CE/GSD/gstack agents。
- 不允许 subagent 直接绕过 `imm-work` 激活步骤。
- 不引入 agent-to-agent 通信。
- 不创建长期 party state 或全局 subagent memory。
- 不在首版默认常驻大规模项目专用 roster。

## 5. 验收标准
- [ ] 系统 subagent 设计规格存在，并记录上游依据、分层原则、权限边界和非目标。
- [ ] 后续计划按可独立闭合结果拆分，并通过本地 plan validator。
- [ ] 用户可从文档中理解不同场景应启用哪些 subagents。
- [ ] 首版核心集合不超过 8 个，且与现有 `imm-*` skill 边界不冲突。
- [ ] 条件风险 agents 不默认启用，必须通过触发条件进入流程。
- [ ] 文档显式区分 `imm-party`、system subagents、以及 `imm-*` authority roles 的边界。
- [ ] 文档为首版核心 subagents 提供 manifest-style contract，并把同一 contract 复用于条件风险层和项目专用层。
