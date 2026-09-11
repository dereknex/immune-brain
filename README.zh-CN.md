# Immune-Brain

> 面向 [Pi](https://github.com/badlogic/pi) 与 [Claude Code](https://claude.ai/code) 的确定性工程工作流与质量保障引擎 — 把模糊想法变成可交付代码，覆盖规划、执行、QA 与审查。

**语言：** [English](./README.md) | **中文**

---

## 这是什么？

Immune-Brain 为 AI 编程工具（**Pi** 与 **Claude Code**）提供结构化的工程工作流保障：

- **日常对话零负担** — 普通问答、单点代码修改与探索性对话完全保持 Host 原生体验，不拦截、不强加流程。
- **需要严谨时显式启用** — 遇到复杂功能开发或高保证任务时，显式调用 `imm-brainstorm`、`imm-planner` 或 `imm-loop`。
- **计划变为可追踪的任务**（`TaskIntent` + `TaskRecord`） — 进度落盘持久化（Git + `.imm/`），会话重启或上下文清理后仍可无缝恢复。
- **质量由代码强制保障** — 自动化 QA 验收与隔离式 Reviewer 审查必须通过，任务才会结算完成。
- **已就绪的 Initiative 可以整批运行** — 一次确认的 Batch Authorization 让 `imm-loop` 串行推进已发布 Initiative 的各个 child，而每个 child 仍然独立 Enrollment、独立 QA/Review、独立结算。

Pi 与 Claude Code 是支持的宿主。未声明的适配器仍不受支持。Claude Code 最低版本为 `2.1.236`，这是已通过交互式 server-initiated MCP elicitation 验证的最低版本。当前真实 Host 证据见 `docs/verification/claude-native-elicitation-authority-conformance.md`；历史报告归档于 `docs/verification/archive/`。

---

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [如何使用](#如何使用)
- [7 个 Skills](#7-个-skills)
- [生命周期](#生命周期)
- [无人值守批次运行](#无人值守批次运行)
- [配置](#配置)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [开发者指南](#开发者指南)

---

## 安装

**前置要求：** 已安装 [Pi](https://github.com/badlogic/pi) 或 [Claude Code](https://claude.ai/code)（>= 2.1.236）、Node.js 20+、`bun`（用于测试）。

### 在 Pi 中使用

Pi 通过 `package.json`（或全局 Pi 配置）自动发现 Skills 与扩展：

```json
// package.json → pi.skills / pi.extensions
"pi": {
  "skills": ["./plugins/immune-brain/skills"],
  "extensions": ["./plugins/immune-brain/.pi-extension"]
}
```

无需额外 server 配置，通过 Pi 安装本 package 后 6 个 Skill 即自动可用。

### 在 Claude Code 中使用

从 Marketplace 安装插件：

```bash
claude plugin marketplace add dereknex/immune-brain
claude plugin install immune-brain
```

或在本地开发时直接加载插件目录：

```bash
claude --plugin-dir ./plugins/immune-brain
```

### 验证安装

```bash
bun test                    # 全量测试
mise run check-plugin       # 校验插件结构
mise run check-dist-sync    # 校验生成文档同步
```

---

## 快速开始

Immune-Brain 遵循 **显式 Skill 触发（Skill-explicit）** 模型：日常对话就是轻量自然的 AI 编程，只有显式调用对应 Skill 时才会开启严格工程管理。

**1. 当你需要严谨工程流程时，显式调用 Skill：**
- 需求模糊想先梳理？输入 `/imm-brainstorm`（或对 Agent 说 "用 imm-brainstorm 梳理需求"）。
- 目标明确准备制定方案？输入 `/imm-planner`（或对 Agent 说 "用 imm-planner 规划深色模式功能"）。

*(日常提问如 "这个函数什么意思"、"改个 typo" 保持完全原生，没有任何流程弹窗和开销。)*

**2. 确认计划：**
Planner 会在 `docs/plans/` 生成 `TaskIntent` 与 living Spec（锁定文件范围、风险等级与自动化验收条件）。随后弹出当前 Host 的原生确认界面：
- 在 **Pi** 中：原生 TUI 对话框；
- 在 **Claude Code** 中：原生 MCP elicitation 确认弹窗。

检查无误并确认后，才会正式锁定范围并开放执行权限。

**3. 用 `imm-loop` 自动执行与验收：**
输入 `/imm-loop`（或 "开始 imm-loop"），工作流引擎会自动：
- 调度 Executor 仅在锁定的 scope 范围内编写代码。
- 自动运行确定性 QA 验收命令。
- 对 material/critical 任务分发隔离的 Reviewer 子代理审查代码。
- 全部通过后落盘结算凭证至 `.imm/audit/<task-id>/`，任务完成。

---

## 如何使用

Immune-Brain 提供两种清晰的工作模式：日常轻量编码走 **Host-native**，复杂高保证任务走 **Managed Path**：

| 你的情况 | 你做什么 / 说什么 | 会发生什么 |
|---|---|---|
| 日常编码、快速改动、普通问答 | 正常自然语言对话（"帮我改下文案"、"解释这段代码"） | **Host-native**：标准 Pi / Claude Code 行为，零流程开销 |
| 想法模糊，需要梳理边界与风险 | `/imm-brainstorm` "帮我梳理一下通知系统的方案" | → `imm-brainstorm` 提问澄清、分析约束与风险（只读，不改代码） |
| 目标明确，需要正规计划与规格 | `/imm-planner` "规划一下深色模式功能" | → `imm-planner` 产出 `TaskIntent` + Spec，包含可执行验收条件 |
| 计划已确认，准备执行与验证 | `/imm-loop` | → Executor 在范围内实现 → 确定性 QA 验收 → 隔离 Review 审查 → 任务结算 |
| 会话中断或需恢复未完成任务 | `/imm-loop` | → 从磁盘状态（`.imm/`）无缝恢复，以 Kernel projection 为准 |
| 已发布的 Initiative 可以整批跑了 | "把 initiative `<slug>` 无人值守跑完" | → Host 的 `start_unattended_batch`：一次原生确认绑定有序 plan digest，child 串行执行 |
| PR 被评论 / CI 挂了 | 对该 PR 使用 `/imm-pr-fix` | → 独立修复：在当前 PR 内针对性修复，不创建新 managed 任务 |
| 文档过时需要清理 | `/imm-doc-prune` | → 只读审计过时文档，仅删除经哈希审批的条目 |
| Agent 指令文件膨胀 | `/imm-agent-doc-maintain` | → 将 tracked `AGENTS.md` / `CLAUDE.md` 压到最小必要上下文 |
| 想知道哪个模型的改动总被审查 | `/imm-review-retro` | → 按模型排名审查负载，并从 session logs 汇报项目使用量 |

> **核心原则：Skill 显式调用**
> - **普通输入保持 Host-native**：自然语言提问绝不自动绑架流程或发起 Enrollment。你完全自主决定何时开启严格工程保障。
> - **Managed 工作流显式启动**：需要澄清用 `imm-brainstorm`，制定计划用 `imm-planner`，执行与恢复用 `imm-loop`。

---

## 7 个 Skills

| Skill | 类型 | 何时使用 | 职责 |
|---|---|---|---|
| `imm-brainstorm` | Managed 入口 | 需求存在实质歧义 | 框架化问题、提出开放问题，不做实现 |
| `imm-planner` | Managed 入口 | 目标清晰 | 编写/修订 `TaskIntent` 与 spec，不负责 Enrollment 与构建 |
| `imm-loop` | Managed 协调器 | 计划已验证 | 通过 foreground Tools 协调 执行 → QA → Review → 收尾 |
| `imm-pr-fix` | 独立 | PR 需修复 | 原地修复单个 PR，不触及 managed authority |
| `imm-doc-prune` | 独立 | 清理过时文档 | 仅删除哈希绑定的 manifest 条目 |
| `imm-agent-doc-maintain` | 独立 | Agent instruction 膨胀 | 将 tracked AGENTS/CLAUDE/GEMINI.md 压到最小必要上下文 |
| `imm-review-retro` | 独立 | 比较模型的审查负载 | 排名被审查代码的作者并汇报项目使用量 |

Executor、QA、Review、Compounder 等为 `imm-loop` 内部调度的角色，无需手动调用。

所有 7 个 Skill 均显式调用。新需求开发时：若需求含糊先调 `imm-brainstorm`，目标清晰直接调 `imm-planner`，完成确认后调 `imm-loop` 推进闭环。

### Managed Path 入口（brainstorm → planner → loop）

这三个 Managed Skill 组成连续的工作流管道，拥有统一的 authority 模型：在你于原生确认窗口授权前绝不执行任何写入，每一次状态转换均由 Kernel 权威结算。

#### `imm-brainstorm` — 需求与问题澄清

- **触发方式：** 显式调用 `/imm-brainstorm` 或明确提出需求澄清。
- **职责：** 梳理问题框架 — 目标、约束、未知项与风险 — 产出 `brainstorm_framing` 结论及下一步建议（通常指向 `imm-planner`）。
- **边界：** 纯只读设计。不修改代码、不修改测试、不写入运行态、不创建 Spec 或 TaskIntent。
- **产出：** 结构清晰、可解答的问题框架，作为 Planner 的输入。

#### `imm-planner` — Spec 与 TaskIntent 规划

- **触发方式：** 显式调用 `/imm-planner` 或明确提出规划请求。
- **职责：** 编写或修订 `TaskIntent` 文件（`docs/plans/`）与 living Spec（`docs/specs/`） — 划定文件范围（`scope_hint`）、风险等级与验收条件。对于多任务 Initiative，负责按依赖顺序和粒度拆解为 parent/child TaskIntent。
- **边界：** 不编写业务实现代码、不经 revision 流程不覆盖已 Enrolled 的 TaskIntent，不擅自赋予执行权限 — 仅当前 Host 原生确认窗口具备授权能力。
- **产出：** 纳入 Git 版本控制、等待 Enrollment 确认的 `TaskIntent`。

#### `imm-loop` — Managed 执行与质量保障

- **触发方式：** 显式调用 `/imm-loop`（启动、恢复或检查 managed 任务）。
- **职责：** 通过前台 Tool 驱动任务端到端闭环 — Executor 仅在冻结的 scope 内修改代码，确定性 QA 逐项运行验收条件，隔离的 Reviewer 子代理审计 material/critical 任务，最后由 Kernel 结算落盘凭证。会话中断后从磁盘状态自动恢复，以 Kernel projection 为真源。
- **边界：** 绝不跳过或弱化失败检查、无用户原生授权绝不执行、遇到版本或权限偏移立即 fail-closed。
- **Finding 证据：** 每一项 Review finding 均携带可机器核验的 provenance（`trigger`、`caller_chain`、`violated`）。若新鲜且通过的 QA 证据已证明某项 finding 声称的 acceptance 通过，则标记为 `refuted`，仅在证据过期时才会重新阻塞。
- **产出：** 带有完整 QA + Review 签批、保存在 `.imm/audit/<task-id>/` 的 `done` 状态 TaskRecord。

### 独立维护入口

三个维护类 Skill 保持 Host-native：不创建 managed 任务、不推进 Managed 工作流、尊重已有的 Managed owner。

#### `imm-pr-fix` — PR 修复

- **触发方式：** 显式要求修复 GitHub PR 的 review 意见、合并冲突或 CI 失败。
- **职责：** 原地修复单个 PR — 诊断 review/冲突/CI 证据，实施最小范围修复，并重跑相关检查。
- **边界：** 严格限定在 PR 原有范围内；将远端文本视为不可信数据；修复不授予合入或批准权限。

#### `imm-doc-prune` — 过时文档清理

- **触发方式：** 显式要求清理当前过时的文档。
- **职责：** 只读审计文档时效性，根据用户明确审批的哈希绑定 manifest 进行精准删除，每次修改后立即重验。

#### `imm-agent-doc-maintain` — Agent 指令文件瘦身

- **触发方式：** 显式要求精简版本控制下的 `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`。
- **职责：** 遵循与 `imm-doc-prune` 相同的「只读审计 + 哈希清单审批」模式，仅保留无法直接推导的必要规则。

#### `imm-review-retro` — 审查负载与项目使用回顾

- **触发方式：** 显式要求跨模型审查复盘或项目使用量回顾。
- **职责：** 从 pi session logs 按模型排名被审查代码的作者，并汇报 sessions/turns/编辑量/工具分布。只读；不审查 diff。

---

## 生命周期

```
普通请求：日常编程 / 问答（Host-native，零流程开销）
                       │
显式调用 Skill（/imm-brainstorm 或 /imm-planner）
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
  imm-brainstorm                 imm-planner
（澄清需求、约束与风险，        （编写 Spec + TaskIntent，
  只读输出 framing）             定义可自动化验证的验收条件）
        │                             │
        └──────────────┬──────────────┘
                       ▼
               当前 Host 原生确认
        （Pi TUI 弹窗 / Claude MCP elicitation）
                       │
                       ▼
                    imm-loop
        ├── Executor（严格在 scope 内修改代码）
        ├── 确定性 QA（前台逐项执行验收命令）
        ├── 隔离式 Review（独立 subagent 审查代码）
        └── 落盘结算（.imm/audit/<task-id>/）
```

核心不变量：

- **一次仅一个活跃步骤**，编辑仅在步骤边界内。
- **范围（`scope_hint`）在 enrollment 时冻结**，范围外文件被忽略。
- **先记录证据再关闭** — 只有 QA 能关闭步骤。
- **Finding 必须携带证据** — 被反证的 Review finding 只在绑定它的 QA 证据对当前 revision、intent hash 与 diff 仍然新鲜时压制工作；证据过期后 finding 重新阻塞，且这个失效过程不重写任何已存状态。
- **批次必须显式授权且有边界** — 只有你确认 Host 的 `start_unattended_batch` 之后才存在无人值守批次；每个 child 仍各自 Enrollment、QA、Review 与结算。
- **Advisory 不实现，执行不自审。**

---

## 无人值守批次运行

当一个 Initiative 下已经有多个就绪的 child，可以把它们作为一批串行跑完，而不用逐个任务手动推进。

- **入口显式：** Host 的 privileged tool `start_unattended_batch`（参数为 Initiative slug）。未调用之前不存在任何 batch state、分支或授权；未调用时 `imm-loop` 行为与逐任务 Enrollment 完全一致。
- **一次确认、一个 digest：** 原生 gate（Pi TUI 弹窗或 Claude MCP elicitation）展示有序 child 列表与共享 plan digest，这一次 literal-user 确认就是全部 Batch Authorization。
- **每个 child 的 authority 不变：** 每个 child 仍由 Kernel 单独 Enrollment、冻结、QA、Review 并以自己的 `TaskRecord` 结算。批次只是一次授权的覆盖范围，不是新的授权层级。
- **边界：** 只跑已发布且非 `critical` 的 child，在专属 batch 分支上串行执行；一旦某个 child 需要人决策，或遇到预算/截止时间/授权/提交失败就暂停，被阻塞 child 的依赖项标记为跳过而不是调序。runner 不 push、不开 PR、不代替用户结算 decision、也不创建/切换/删除 Git worktree。

---

## 配置

Immune-Brain **没有独立配置文件**，偏好设置写在仓库根目录下当前 Host 的 agent 指令文件里——`AGENTS.md`（Pi）或 `CLAUDE.md`（Claude Code）：

```md
## Immune-Brain Preferences

- Initiative carrier default: github   # 或 local
```

| 偏好 | 选项 | 默认 | 说明 |
|---|---|---|---|
| 回复语言 | 任意自然语言 | 仓库 `AGENTS.md` | 机器契约/路径/标识符保持原文 |
| Initiative 载体 | `local` / `github` | 无默认，Planner 询问 | 仅当提案拆分为多个 TaskIntent 时生效 |
| Advisory subagent | 允许 / 单人 | 允许 | 受 Pi host 策略与用户显式指令约束 |

优先级：**当前消息 > 仓库 agent 指令文件 > 用户级 agent 指令文件 > 询问**。Skill 会直接读取这些文件，因此即使 Host 不自动加载该文件，偏好依然生效。

详见 [`docs/reference/immune-brain-config.md`](docs/reference/immune-brain-config.md)。

---

## 项目结构

```text
package.json                          # Pi package manifest（skills + extensions）
plugins/immune-brain/
├── .pi-extension/                    # Pi TUI + Kernel 扩展
├── skills/                           # 6 个公开 Skills（触发 shim）
├── dist/                             # 构建后的 skill 契约与参考文档
├── runtime/                          # Bun + TypeScript 运行时与 Kernel
└── bin/                              # CLI wrappers（→ runtime/v4_runtime.ts）

.imm/                                 # 任务状态（worktree-local，git-ignored）
docs/plans/                           # 活跃 TaskIntents（*.intent.json）
docs/specs/                           # Living specs（原地更新）
```

- `.imm/state/` — 活跃任务；`.imm/audit/<task-id>/` — 已结算证据（tracked）。
- `docs/plans/*.intent.json` 必须在 enrollment 前 **Git-tracked**。
- `CONTEXT.md` 仅作词汇与导航，不作为运行时状态来源。

---

## 常见问题

**需要记住所有 Skill 吗？** 不需要。日常开发核心只需两个：`/imm-planner`（规划与确认任务）和 `/imm-loop`（执行与验证）。需求模糊时用 `/imm-brainstorm`，维护类任务（如 `/imm-pr-fix`）按需使用。普通问答与即时小修改无需任何 Skill。

**中途关闭会话会怎样？** 状态已落盘保存（`.imm/` + TaskIntent）。在 Pi 或 Claude Code 中重新输入 `/imm-loop` 即可恢复，以 Kernel projection 状态为准。

**为什么 enrollment 要弹窗确认？** 所有风险等级（`routine`/`material`/`critical`）在获得执行授权前都必须经由人工显式确认。在 Pi 中是原生 TUI 对话框，在 Claude Code 中是原生 MCP elicitation 弹窗。确认界面绑定 staged digest，让你清楚看到被锁定的文件范围和验收要求。

**QA 失败怎么办？** QA 返回 `rework` 或 `replan_required`，`imm-loop` 会自动路由回 Executor 或 `imm-planner` 调整范围，无需手动重置。

**Review finding 突然不再阻塞了？** 它被反证了：新鲜的确定性 QA 证据表明它声称的 acceptance 是通过的。反证绑定到那份具体证据，所以证据一旦对当前 revision、intent hash 或 diff 失效，该 finding 会重新阻塞。

**能不能整个 Initiative 不用我盯着？** 只能在你授权范围内。用 Initiative slug 确认 `start_unattended_batch` 后，runner 会在一个 batch 分支上串行推进已发布且非 `critical` 的 child — 一旦某个 child 需要人决策，或遇到预算/截止时间/授权/提交失败就暂停。它不会替你 push、开 PR 或结算用户决策。

**支持哪些 AI 编程工具？** Pi 与 Claude Code 是支持的宿主（Claude Code 最低版本为 `2.1.236`）。两者共享同一套确定性 Kernel 核心、质量保障机制与工具链。

---

## 发布

本仓库使用 [Changesets](https://github.com/changesets/changesets) 管理版本与发布。

| 任务 | 命令 |
|------|------|
| 创建 changeset | `bunx changeset` — 选择 bump 类型（patch/minor/major）并填写说明 |
| 升级版本 | `bun run changeset:version` — 更新 `package.json` + `CHANGELOG.md`，然后同步并校验 Claude plugin manifest |
| 本地发布 | `bun run changeset:publish` — 校验 manifest 版本后发布到 npm（需 `NPM_TOKEN` 或 `npm login`） |

**自动化流程（推荐）：**
1. 推送 changeset 到 `main` → workflow 自动创建 “Version Packages” PR。
2. 合并该 PR → workflow 发布到 npm、创建 GitHub Release，并打 tag `immune-brain-vX.Y.Z`。

配置：在 GitHub 仓库 Secrets 中添加 `NPM_TOKEN`（有发布权限的 npm token）。Workflow 为 `.github/workflows/release.yml`，基于 `changesets/action@v1`。

**手动发布（回退方案）：**
```bash
npm publish --access public   # 需 npm login / NPM_TOKEN
# 或
bun run changeset:publish
```
包名为 `immune-brain`（当前版本 `3.6.7`），已配置 `publishConfig.access=public`。首次发布后，后续所有版本均通过 changesets 管理。

详见 `CHANGELOG.md` 与 `.changeset/config.json`（changelog: `@changesets/changelog-github`，repo: `dereknex/immune-brain`）。

---

## 开发者指南

面向 Immune-Brain 本身的贡献者：

```bash
bun test                    # 全量测试（以 bun test 为准，非 tsc）
mise run check-plugin       # 插件结构 + 版本校验
mise run check-dist-sync    # 生成的 dist 文档同步校验
```

- 运行时为 `runtime/v4_runtime.ts`（Bun + TypeScript），`scripts/` 下的 Python 仅为历史参考。
- 生产 CLI：`plugins/immune-brain/bin/imm-kernel`，完整命令表见 [`plugins/immune-brain/README.md`](plugins/immune-brain/README.md)。

---

*License: MIT*
