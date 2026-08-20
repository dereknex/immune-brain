# Spec: All-skills Natural Output Contract

**任务 ID**: IMM-WORKFLOW-UX-004
**负责人**: Planner
**状态**: Proposed

## 1. 目标
把本仓库全部本地 `imm-*` skills 的默认用户输出收敛成更自然、更短、更直接的风格，减少“表单感”“协议字段逐项外显”和不必要的过程播报，同时保留 Codex-facing contract、workflow guard 与调试展开路径。

## 2. 需求

### R1. 全体 skills 共享自然输出基线
- 作用范围为 `skills/` 下全部 13 个本地 `imm-*` skill。
- 每个 skill 的默认成功路径输出都应优先服务“用户现在最想知道什么”，而不是优先展示 schema 字段。
- 默认输出应避免把 `Output artifact` 里的每个字段都当成用户界面的必填清单。

### R2. 统一的是密度规则，不是单一模板
- 不要求所有 skill 使用相同的 3 行模板。
- 不同角色仍保留最适合自己的默认顺序：
  - framing / planning 类优先给结论、范围、下一步；
  - workflow / execution 类优先给结论、证据、下一步；
  - review / QA 类优先给决定或 findings，再给最短必要证据。
- 允许 role-specific 例外，但必须解释何时简短、何时展开。

### R3. 结构字段改为 Codex-facing 或按需显式
- `Next Action` 继续保留。
- `Allowed`、`Blocked`、`Workflow guard`、packet schema、raw state、history 等结构字段不能默认每轮都完整外显给用户。
- 这些字段应只在阻塞、失败、边界风险、路由变化、用户要求 debug/full state 时展开。

### R4. 各 skill 必须显式定义默认输出规则
- 目前缺少 `Output style` 或默认用户输出密度说明的 skill，必须补齐。
- 已有 `Output style` 的 skill，需要收敛措辞，避免同时存在“默认简短”和“默认输出完整 schema”两套冲突口径。
- `Output artifact` 保留给 traceability；用户默认输出只暴露当前轮最小必要信息。

### R5. 共享守卫需要覆盖 repo 级一致性
- 至少一层 focused regression 要显式检查：
  - 全体 skill 都有自然输出约束；
  - 允许按角色分流；
  - 默认输出不会慢慢回漂成 rigid template。
- 相关 repo-facing 文档或 pattern doc 需要说明这是 repo-wide contract，而不是只属于 `imm-brainstorm`。

## 3. 验收标准
- [ ] `skills/` 下全部本地 `imm-*` skills 都有明确的默认用户输出密度规则。
- [ ] 默认成功路径不再把 artifact schema 当成用户回复模板逐项展开。
- [ ] `Allowed` / `Blocked` / `Workflow guard` 等结构字段在各 skill 中仍保留，但被定义为按需展开而非默认外显。
- [ ] review / QA / workflow / framing / planner 等不同角色保留适合自己的输出顺序，而不是被强行压成同一种格式。
- [ ] 至少一处回归守卫能检查 repo-wide 的自然输出 contract。

## 4. 依赖项
- 依赖 [IMMUNE.md](IMMUNE.md) 的角色边界与 workflow 分层。
- 依赖 [docs/solutions/default-debug-workflow-output-split.md](docs/solutions/default-debug-workflow-output-split.md) 的默认/调试分流模式。
- 依赖 [docs/solutions/framing-stage-terse-handoff.md](docs/solutions/framing-stage-terse-handoff.md) 已沉淀的 framing-stage 轻量 handoff。
- 依赖 [docs/solutions/tested-skill-contracts.md](docs/solutions/tested-skill-contracts.md) 的契约测试模式。

## 5. 非目标
- 不在本轮改动仓库外部的系统 skill、插件 skill 或 Codex 全局提示。
- 不改 `.imm` runtime 工具的机器输出结构。
- 不删除 `Output artifact`、workflow guard、review findings schema 或 step tracing 字段。
- 不把所有 skill 回复压成完全统一的句式模板。
