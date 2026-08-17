# Pattern: Skill-local Workflow Guards

**领域**: Agent workflow / Skill routing  
**描述**: 当不同项目的 `AGENTS.md` 内容不可控时，把关键流程约束写进可安装 skill 自身，避免后续对话绕过计划或验收阶段。

## 场景

- 一个 workflow skill 只在当前 turn 生效，后续用户说 "continue" 或 "do it" 时，默认 coding agent 可能直接实现。
- 各项目的 `AGENTS.md` 不一致，不能假设项目级指令会继续维护同一条流程边界。
- 某个阶段的输出需要被后续阶段消费，而不是只停留在自然语言建议里。

## 方案模板

1. **入口描述写触发条件**: 在上游 skill 的 `description` 中写明后续实现请求必须继续走工作流。
2. **输出产物带 guard**: 在 handoff artifact 中加入明确的 `Workflow guard`，说明下一步允许的 skill。
3. **下游角色重复拦截**: 在 preplan、planner、work、executor 等下游 skill 中分别声明缺少 plan 或 active step 时必须停止实现。
4. **避免依赖项目文件**: 不把关键路由规则只放在 `AGENTS.md`，因为目标项目可能没有相同内容。

## 可复用前提

- 约束属于跨项目 workflow 规则，而不是某个项目的局部代码规范。
- 相关 skill 会被安装到使用环境，且其 `description` 会进入模型的 skill 选择上下文。
- 后续阶段有明确的可检查状态，例如 plan、validated plan、active step 或 handoff artifact。

## 验证依据

- 本次分析发现 `imm-brainstorm` 已禁止实现，但该限制只约束当前使用该 skill 的 turn。
- 修复已把 guard 写入 `imm-brainstorm` 输出、`imm-preplan-review` 和 `imm-planner` 的继续场景，以及 `imm-work` / `imm-executor` 的 plan 与 active step 边界。
- 关键词检查确认相关 skill 中已出现 `Workflow guard`、`validated plan`、`active step` 和不依赖 `AGENTS.md` 的说明。

## 约束与建议

- 这类 guard 能降低误路由概率，但不能替代真正的工具级强制状态机。
- 不要把每个 skill 都写成全局总控；只在上游 handoff 和直接下游拦截点重复关键约束。
- 如果未来有 centralized router，应优先用工具状态判断 plan / active step，而不是只依赖自然语言描述。

---
*沉淀日期: 2026-05-07 | 来源: imm-brainstorm 后续实现绕过 plan/work 的分析与修复*
