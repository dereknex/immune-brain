# Pattern: Codex-native Interaction Contract

**领域**: Agent workflow / Codex interaction
**描述**: 当 workflow skill 需要在 Codex 中连续协作时，把状态、下一动作、权限边界和可选工具能力做成显式交互契约，而不是依赖自然语言提醒或扩大协调角色权限。

## 场景

- 用户在 Codex 中通过多个 skill 连续推进同一任务，容易忘记下一步该用哪个角色。
- 现有 workflow 已经有明确的 plan、active step、review state，但用户界面需要更清楚的状态摘要。
- Codex 提供 Browser、GitHub、automation、sub-agent、外部笔记等能力，但这些能力不应自动变成执行或验收权限。

## 方案模板

1. **定义稳定输出字段**: 在用户可见 skill 中统一 `Next Action`、`Allowed`、`Blocked` 和 `Workflow guard`。
2. **提供 Codex 状态摘要**: 让协调工具输出 `codex_status`，至少包含 active plan、active step、verification requirement、completed steps、next skill、stop condition 和 one-step-at-a-time 标记。
3. **把工具生态做成 hooks**: Browser QA、GitHub PR、Automation、Sub-agent advisory、External notes 只作为按需建议，必须写明触发条件、边界和 fallback。
4. **保留角色权限**: 协调角色只路由，executor 只执行当前 step，QA 只记录闭合判断。
5. **明确非目标**: 不新增 centralized router，不自动跑完整 plan，不让工具钩子替代执行或验收。

## 可复用前提

- workflow 已有可检查状态，例如 validated plan、active step、completed steps 和 review decision。
- 后续角色能通过显式 skill 或工具入口调用。
- 目标是降低 Codex 交互摩擦，而不是把人类确认和 QA gate 自动化掉。
- 插件能力可能缺失，因此每个 hook 都需要文本或本地文件 fallback。

## 验证依据

- `.imm/specs/codex-native-interaction.spec.md` 定义了首版交互契约、非目标和 capability hooks。
- 六个核心 workflow skill 已统一声明 `Next Action`、`Allowed`、`Blocked` 和 `Workflow guard`。
- `.imm/imm-work.py status` 已返回 `codex_status`，并保持 `next_action` 作为路由提示。
- `README.md` 说明了 Codex 如何消费 `codex_status`，并列出 Browser QA、GitHub PR、Automation、Sub-agent advisory、External notes 的触发条件、边界和 fallback。
- `python3 .imm/imm-plan.py docs/plans/2026-05-07-004-feat-codex-native-interaction-plan.md --json`、`python3 -m py_compile .imm/imm-work.py` 和相关 `rg` 字段检查均通过。
- `python3 .imm/imm-work.py status` 显示 Step 1-4 全部 pass，下一动作是 `imm-compounder`。

## 约束与建议

- 不要把 `codex_status` 当作新的状态源；真实状态仍来自 `.imm/memory/current_iteration.json` 和计划文件。
- 不要让 capability hooks 直接改 active step、记录 QA 或创建隐藏的后台执行链路。
- 如果 hook 的 fallback 说不清楚，说明它还不适合进入默认工作流。
- 对用户输出要优先展示下一步和停止条件，细节证据用可点击文件引用承载。

---
*沉淀日期: 2026-05-07 | 来源: Codex-native interaction contract 全步骤验收*
