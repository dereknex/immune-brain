# Immune-Brain

> 面向 [Pi](https://github.com/badlogic/pi) 的确定性工程工作流与质量保障引擎 — 把模糊想法变成可交付代码，覆盖规划、执行、QA 与审查。

**语言：** [English](./README.md) | **中文**

---

## 这是什么？

Immune-Brain 在 Pi 之上提供结构化的工程工作流：

- **你用自然语言描述需求**，Agent 自动判断是先澄清、先规划，还是直接执行。
- **计划变为可追踪的任务**（`TaskIntent` + `TaskRecord`），进度落盘持久化，不依赖对话历史。
- **质量由代码强制保障** — 自动化 QA 与隔离式 Review 必须通过，任务才会完成。

Pi 是唯一支持的宿主，可配置任意模型 Provider（Anthropic / OpenAI / Google），Immune-Brain 在其之上工作。

---

## 目录

- [安装](#安装)
- [快速开始](#快速开始)
- [如何使用](#如何使用)
- [5 个 Skills](#5-个-skills)
- [生命周期](#生命周期)
- [配置](#配置)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [开发者指南](#开发者指南)

---

## 安装

**前置要求：** 已安装 [Pi](https://github.com/badlogic/pi)、Node.js 20+、`bun`（用于测试）。

本仓库是一个 Pi Package，Pi 通过 `package.json` 自动发现 Skills 与扩展：

```json
// package.json → pi.skills / pi.extensions
"pi": {
  "skills": ["./plugins/immune-brain/skills"],
  "extensions": ["./plugins/immune-brain/.pi-extension"]
}
```

无需额外 server 配置，通过 Pi 安装本 package 后 5 个 Skill 即自动可用。验证：

```bash
bun test                    # 全量测试
mise run check-plugin       # 校验插件结构
mise run check-dist-sync    # 校验生成文档同步
```

---

## 快速开始

**1. 用自然语言描述你要做的改动：**

> "给设置页加上深色模式"

Pi 会自动路由：需求模糊走澄清，目标明确走规划。

**2. 确认计划** — Planner 会在 `docs/plans/` 生成 `TaskIntent`（范围、风险等级、验收条件）。检查无误后在 TUI 弹窗中确认 Enrollment（所有风险等级都需要确认，确认前零写入）。

**3. 开始执行** — `imm-loop` 按计划执行、跑 QA、触发 Review。按提示暂存任务拥有的文件：

```bash
git add -- <任务拥有的文件> <另一个文件>
```

QA 与 Review 以 foreground Tool 形式运行并回传结果，返回 `phase=done` 即完成。

---

## 如何使用

大多数情况下**无需记忆 Skill 名称**，直接描述意图即可：

| 你的情况 | 你说什么 / 做什么 | 会发生什么 |
|---|---|---|
| 想法模糊，需要收敛 | "帮我梳理一下通知系统的方案" | → `imm-brainstorm` 提问澄清，不改代码 |
| 目标明确，需要计划 | "规划一下深色模式功能" 或让 Pi 自动路由 | → `imm-planner` 产出 `TaskIntent` + spec |
| 计划已确认，准备开干 | "开始构建" / `imm-loop` | → Executor 构建 → QA 验证 → Review 审查 |
| PR 被评论 / CI 挂了 | 对该 PR 使用 `imm-pr-fix` | → 独立修复，不创建新 managed 任务 |
| 文档过时需要清理 | `imm-doc-prune` + manifest | → 仅删除已审批的过时文档 |

> **规则：** Managed 工作流（brainstorm → plan → loop）仅由显式的 `imm-brainstorm`、`imm-planner`、`imm-loop` 启动。普通问答、只读解释不会 Enrollment。

---

## 5 个 Skills

| Skill | 类型 | 何时使用 | 职责 |
|---|---|---|---|
| `imm-brainstorm` | Managed 入口 | 需求存在实质歧义 | 框架化问题、提出开放问题，不做实现 |
| `imm-planner` | Managed 入口 | 目标清晰 | 编写/修订 `TaskIntent` 与 spec，不负责 Enrollment 与构建 |
| `imm-loop` | Managed 协调器 | 计划已验证 | 通过 foreground Tools 协调 执行 → QA → Review → 收尾 |
| `imm-pr-fix` | 独立 | PR 需修复 | 原地修复单个 PR，不触及 managed authority |
| `imm-doc-prune` | 独立 | 清理过时文档 | 仅删除哈希绑定的 manifest 条目 |

Executor、QA、Review、Compounder 等为 `imm-loop` 内部调度的角色，无需手动调用。

**推荐默认：** 让自然语言路由自动选择 brainstorm 还是 planner，仅在想强制进入某阶段时才显式调用 Skill。

---

## 生命周期

```
你：自然语言请求
        │
        ├── 模糊 ──→ imm-brainstorm（澄清，不改代码）
        │
        └── 明确 ──→ imm-planner ──→ TaskIntent（Git-tracked）
                              │
                         TUI 确认（enrollment）
                              │
                          imm-loop
                              ├── Executor（仅在 scope 内编辑）
                              ├── QA（确定性检查必须通过）
                              ├── Review（material/critical：隔离 subagent）
                              └── done
```

核心不变量：

- **一次仅一个活跃步骤**，编辑仅在步骤边界内。
- **范围（`scope_hint`）在 enrollment 时冻结**，范围外文件被忽略。
- **先记录证据再关闭** — 只有 QA 能关闭步骤。
- **Advisory 不实现，执行不自审。**

---

## 配置

Immune-Brain **没有独立配置文件**，偏好设置写在 `AGENTS.md`（仓库根目录或 `~/.pi/agent/AGENTS.md`）：

```md
## Immune-Brain Preferences

- Initiative carrier default: github   # 或 local
```

| 偏好 | 选项 | 默认 | 说明 |
|---|---|---|---|
| 回复语言 | 任意自然语言 | 仓库 `AGENTS.md` | 机器契约/路径/标识符保持原文 |
| Initiative 载体 | `local` / `github` | `github` | 仅当提案拆分为多个 TaskIntent 时生效 |
| Advisory subagent | 允许 / 单人 | 允许 | 受 Pi host 策略与用户显式指令约束 |

优先级：**当前消息 > 仓库 `AGENTS.md` > `~/.pi/agent/AGENTS.md` > Skill 默认值**。

详见 [`docs/reference/immune-brain-config.md`](docs/reference/immune-brain-config.md)。

---

## 项目结构

```text
package.json                          # Pi package manifest（skills + extensions）
plugins/immune-brain/
├── .pi-extension/                    # Pi TUI + Kernel 扩展
├── skills/                           # 5 个公开 Skills（触发 shim）
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

**需要记住所有 Skill 吗？** 不需要，直接描述需求即可，Pi 会自动路由。先掌握 `imm-planner` 和 `imm-loop`，另外两个按需使用。

**中途关闭 Pi 会怎样？** 状态已落盘（`.imm/` + TaskIntent），重新进入 `imm-loop` 即可恢复，以 Kernel projection 为准。

**为什么 enrollment 要弹窗确认？** 所有风险等级（`routine`/`material`/`critical`）都需要显式确认，弹窗绑定 staged digest，让你清楚看到将被追踪的内容。

**QA 失败怎么办？** QA 返回 `rework` 或 `replan_required`，`imm-loop` 会自动路由回 Executor 或 `imm-planner` 调整范围，无需手动重置。

**可以在 Pi 之外使用吗？** 不可以，Pi 是唯一支持的宿主。

---

## 发布

本仓库使用 [Changesets](https://github.com/changesets/changesets) 管理版本与发布。

| 任务 | 命令 |
|------|------|
| 创建 changeset | `bunx changeset` — 选择 bump 类型（patch/minor/major）并填写说明 |
| 升级版本 | `bun run changeset:version` — 更新 `package.json` + `CHANGELOG.md` |
| 本地发布 | `bun run changeset:publish` — 发布到 npm（需 `NPM_TOKEN` 或 `npm login`） |

**自动化流程（推荐）：**
1. 推送 changeset 到 `main` → workflow 自动创建 “Version Packages” PR。
2. 合并该 PR → workflow 发布到 npm、创建 GitHub Release，并打 tag `immune-brain-vX.Y.Z`。

配置：在 GitHub 仓库 Secrets 中添加 `NPM_TOKEN`（有发布权限的 npm token）。Workflow 为 `.github/workflows/release.yml`，基于 `changesets/action@v1`。

**首次发布（2.8.1）：**
```bash
npm publish --access public   # 首次发布，需 npm login / NPM_TOKEN
# 或
bun run changeset:publish
```
包名为 scoped `@immune-brain/agent-skills`，已配置 `publishConfig.access=public`。首次发布后，后续所有版本均通过 changesets 管理。

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
