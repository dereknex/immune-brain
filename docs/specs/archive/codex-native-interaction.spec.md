# Spec: Codex-native interaction contract

**任务 ID**: IMM-CODEX-001
**负责人**: Planner
**状态**: Draft

## 1. 目标

让 Immune-Brain 在 Codex 中表现为清晰的交互式工作流，而不是一组需要用户手动记忆切换顺序的 skill。首版聚焦统一输出契约和下一步路由提示，充分利用 Codex 的可点击上下文、结构化状态和工具建议能力，同时保持现有小步闭环与角色权限边界。

## 2. 功能需求

- **交互契约**：
  - 每个面向用户的 Immune-Brain 阶段应能明确说明当前状态、允许动作、禁止动作和推荐下一步。
  - `Next Action` 应包含下一 skill、原因、是否需要用户确认、允许动作和阻塞动作。
  - 后续实现请求在缺少 validated plan 或 active step 时，必须被路由回规划或协调阶段。
- **Codex 上下文呈现**：
  - 重要 plan、spec、active step、验证证据和相关 skill 应尽量用可点击文件引用呈现。
  - 面向 review 的输出应保留定位到文件和行的能力，避免只给不可追踪的自然语言总结。
  - 输出应面向“聪明但没有在看代码的人”，用简短结论说明状态和下一步。
- **状态适配**：
  - `imm-work status` 的输出应适合 Codex 消费，至少能表达当前 step、验证要求、停止条件和下一 skill。
  - `next_action` 仍是路由提示，不是自动执行权限。
  - `pass` 后最多报告下一个可继续 step，不默认自动跑完整 plan。
- **能力钩子**：
  - Browser QA、GitHub PR、automation、sub-agent、Notion 等 Codex 能力可以作为按需建议。
  - 能力钩子不得默认扩大当前 step，也不得替代 `imm-executor` 或 `imm-qa`。
  - 每个钩子必须说明触发条件、收益和不触发时的 fallback。

## 3. 验收标准

- [ ] Spec 明确 Codex-native interaction contract 的首版边界，不包含全自动 router 或完整工具生态重写。
- [ ] 相关 skill 输出约定包含 `Next Action`、`Allowed`、`Blocked` 和 workflow guard。
- [ ] `imm-work status` 或其文档能说明 Codex 如何消费下一步状态。
- [ ] 文档中列出 Codex 能力钩子的触发条件与边界。
- [ ] 至少一个端到端示例能展示用户说“继续”时，系统如何在不绕过计划和验收的前提下给出下一步。

## 4. 非目标

- 不新增全局 centralized router。
- 不让 `imm-work` 自动执行完整 plan。
- 不让 Codex 工具钩子拥有执行或验收权限。
- 不要求支持所有 Codex 插件环境；缺少插件时必须保留普通文本 fallback。

## 5. 首版交互契约

每个面向用户的 Immune-Brain 阶段在 Codex 中应尽量输出以下字段。字段可以用自然语言呈现，但含义必须稳定，方便后续阶段消费。

- **State**: 当前 workflow 状态，包括 active plan、active step、verification requirement、completed steps 和 stop condition。没有 validated plan 或 active step 时，必须明确说明缺失项。
- **Next Action**: 推荐下一步，包括 `skill`、`reason`、`requires_user_confirmation`、`allowed_actions` 和 `blocked_actions`。`Next Action` 是路由提示，不是自动执行授权。
- **Allowed**: 当前阶段允许做什么。例如 `imm-work` 可以激活 step 和读取状态，`imm-executor` 可以只围绕 active step 改文件，`imm-qa` 可以记录验收决定。
- **Blocked**: 当前阶段禁止做什么。例如没有 plan 时禁止直接实现，`imm-work` 禁止改实现文件，`imm-executor` 禁止修改 plan 结构或记录 QA 结论。
- **References**: 关键上下文应使用 Codex 可点击文件引用，包括 plan、spec、active step 来源、验证证据和相关 skill 文件。
- **Capability Hooks**: 当 Browser QA、GitHub PR、automation、sub-agent 或外部笔记能力有明显收益时，只能作为建议项出现，并说明触发条件、边界和 fallback。
- **Workflow Guard**: 输出结尾必须说明后续实现、验收或重排应该进入哪个 Immune-Brain skill，避免后续 turn 绕过计划、执行或 QA 边界。

## 6. Codex 能力钩子

能力钩子只作为 `Next Action` 建议或补充验证路径出现，不能替代 Immune-Brain 的规划、执行或验收权限。

| Hook | 触发条件 | 边界 | Fallback |
|---|---|---|---|
| Browser QA | 当前 step 涉及 UI、浏览器行为、响应式布局或可访问性检查 | 只收集截图、交互证据和问题定位；不记录 `pass / rework / replan` | 用人工复现路径、截图说明或测试输出作为证据 |
| GitHub PR | 当前工作进入 PR 创建、CI 失败、review feedback 或合并阻塞 | 只作为 PR 发布、检查或反馈收集入口；修复仍回到 `imm-pr-fix` 或 `imm-executor` | 用本地 `git diff`、测试输出和手动 PR 描述继续 |
| Automation | 用户明确要求稍后提醒、持续观察或定时跟进 | 只创建提醒或监控任务；不自动推进 active step 或完整 plan | 输出下一次手动检查条件和推荐命令 |
| Sub-agent advisory | 用户明确请求多角色/并行会诊，且任务可清晰拆分为只读意见 | 只产出 advisory handoff；scope 仍由 `imm-preplan-review` 或 `imm-planner` 判断 | 使用 solo 模式总结不同角色视角 |
| External notes | 用户要求同步到 Notion、文档或外部知识库 | 只同步结论、证据和链接；不把外部记录当作 QA 通过依据 | 写入本地 `docs/brainstorms/`、`docs/solutions/` 或最终回复 |

## 7. 依赖项

- 依赖 `docs/solutions/skill-local-workflow-guards.md` 的跨 turn 路由守卫模式。
- 依赖 `docs/solutions/single-step-orchestration-entry.md` 的 `next_action` 路由模式。
- 依赖现有 `imm-brainstorm`、`imm-preplan-review`、`imm-planner` 和 `imm-work` 的角色边界。
