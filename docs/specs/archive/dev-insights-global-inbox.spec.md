# Spec: Developer insights global inbox

**任务 ID**: IMM-DEV-INSIGHTS-001
**负责人**: Planner
**状态**: Draft

## 1. 目标

为 Immune-Brain 系统开发者提供一个默认关闭的本机全局开关。当开发者在任意项目中使用 Immune-Brain workflow 时，可以把本轮暴露出的 workflow 改进洞察追加到同一个本机 inbox，供后续周期性复盘和改进规划使用。

首版只解决跨项目收集入口和安装配置体验，不实现周期性分析器，不自动生成计划，也不把 insight 记录等同于正式 `docs/solutions/` 沉淀。

## 2. 功能需求

- **全局路径**:
  - 默认 inbox 路径为 `~/.immune-brain/insights/workflow-improvement-inbox.md`。
  - 默认配置路径为 `~/.immune-brain/config.toml`。
  - 路径属于本机用户级状态，不写入当前项目的 `.imm/memory/`。
- **开发者开关**:
  - 默认关闭。
  - `IMM_DEV_INSIGHTS=1` 应作为最高优先级开关。
  - 安装脚本应提供显式参数，用于初始化或启用本机全局 dev insights 配置。
  - 普通安装不应默认开启 dev insights。
- **记录内容**:
  - 记录对象是 workflow 改进洞察，不是完整 telemetry。
  - 每条记录必须包含日期、项目名、项目路径、workflow context、friction、suggested improvement、severity 和 status。
  - 不默认记录完整对话、prompt、代码内容、diff 或敏感上下文。
- **写入行为**:
  - 当开关关闭时，不创建全局 inbox，不追加记录。
  - 当开关开启时，缺失的全局目录和 inbox 可以被创建。
  - 写入失败不应阻塞当前 workflow，应给出明确提示。
- **安装体验**:
  - `scripts/legacy-installer.sh --help` 必须说明 dev insights 开关参数。
  - `scripts/legacy-installer.sh --check` 应能报告本地 skill 安装状态，并在 dev insights 已开启时检查全局 inbox 配置是否可用。
  - 安装脚本参数不得改变默认 skill symlink 安装行为。

## 3. 验收标准

- [ ] Spec 明确 dev insights 是本机全局、跨项目、默认关闭的开发者能力。
- [ ] 安装脚本有显式参数可以初始化或启用 `~/.immune-brain/` 下的 dev insights 配置。
- [ ] 普通 `zsh scripts/legacy-installer.sh` 不会默认开启 dev insights。
- [ ] `zsh scripts/legacy-installer.sh --help` 展示 dev insights 参数。
- [ ] `zsh scripts/legacy-installer.sh --check` 在 dev insights 开启时能检查全局配置和 inbox 路径。
- [ ] 开关开启时，workflow 能追加一条结构化 Markdown insight。
- [ ] 开关关闭时，workflow 不追加 insight。
- [ ] 写入全局路径的测试可以通过临时 `HOME` 验证，不污染真实用户目录。

## 4. 非目标

- 不实现周期性分析器。
- 不实现自动去重、归并或打分。
- 不自动创建 `.imm/specs/` 或 `docs/plans/` 改进任务。
- 不远程上报。
- 不修改上游 `compound-engineering` 插件缓存。
- 不把未验证 insight 直接写入 `docs/solutions/`。

## 5. 首版配置契约

默认配置文件使用可人工编辑的 TOML 形态：

```toml
[dev_insights]
enabled = true
inbox_path = "~/.immune-brain/insights/workflow-improvement-inbox.md"
```

首版开关优先级：

1. `IMM_DEV_INSIGHTS=1` 强制开启。
2. `IMM_DEV_INSIGHTS=0` 强制关闭。
3. `~/.immune-brain/config.toml` 的 `dev_insights.enabled`。
4. 默认关闭。

## 6. 首版记录格式

```md
## YYYY-MM-DD - workflow improvement

- Project: <project name>
- Project path: <absolute project path>
- Workflow: <skill or flow summary>
- Context: <short context>
- Friction: <observed workflow problem>
- Evidence: <short evidence without private raw content>
- Suggested improvement: <candidate workflow change>
- Severity: low | medium | high
- Status: inbox
```

## 7. 依赖项

- 依赖 `IMMUNE.md` 的文件即记忆、持续进化和写入边界。
- 依赖 `skills/imm-compounder/SKILL.md` 的沉淀阶段语义，但 dev insights inbox 不是正式 compound artifact。
- 依赖 `scripts/legacy-installer.sh` 作为本地安装和检查入口。
