# Immune-Brain

> 面向 Pi (Coding Agent) 的工程工作流与质量保障引擎。

Immune-Brain 为 Pi 提供确定性的任务意图、自动化 QA 验证、隔离式代码审查 (Subagent Code Review) 以及严谨的用户安全授权。通过将任务意图（Git-tracked `TaskIntent`）与执行状态（Worktree-local Kernel `TaskRecord`）解耦持久化，确保工程工作流不依赖对话记忆或 Session ID，实现跨 Session 状态与证据的零丢失。

> **注**：Pi 是唯一支持的 code-agent host。Pi 可通过自身配置使用任意模型 Provider（如 Anthropic、OpenAI、Google 等）。

---

## 💡 核心特性

- **跨 Session 状态持久化**：工作流状态统一存于 Kernel/State Ledger，脱离 Pi Session Tree 限制。
- **确定性任务边界 (`scope_hint`)**：明确隔离任务改动，排除无关 dirty 文件的干扰与撕裂。
- **确定性后台 QA 验证**：在宿主后台确定性运行测试与脚本，非阻塞 TUI 操作，通过有界 `ctx.ui.notify` 里程碑展示进度。
- **隔离式 Subagent Review**：冻结 `HEAD -> index` 快照并基于 Git Blob OID 读取，避免工作区状态竞争。
- **安全优先的用户授权**：关键风险操作（如 Stop、Resolve Decision、特权操作）均需显式 TUI 二次确认。

---


## 🚀 快速上手 (使用工作流)

Immune-Brain 通过自然语言请求启动工作流。对仓库提出修改请求时，Managed Path 会自动判断进入 `imm-brainstorm`、`imm-planner` 或恢复中的 `imm-loop`；只读、解释、评审和明确不修改仓库的请求保持 host-native，不会 Enrollment。

标准生命周期为：

```text
自然语言请求 ➔ Managed Path 路由 ➔ TaskIntent Enrollment ➔ imm-loop 执行、QA、Review ➔ foreground Tool 授权与收尾
```

### 任务开始

直接描述要完成的仓库修改。需求存在实质歧义时先进入 `imm-brainstorm`，目标明确时进入 `imm-planner`。Planner 生成的 TaskIntent 仍需由用户通过 `imm_canary_enrollment` foreground Tool 明确确认；routine、material、critical 风险都要求 literal-user confirmation，并展示完整意图和冻结的 staged digest。

已存在 `TaskIntent` 文件时，继续使用同一个 `imm_canary_enrollment` Tool 进行 rehearsal、必要的 descriptor waiver 和 Enrollment。失败、取消和 host interruption 在 authority commit 前保持零写入。

### 执行与保证

完成代码后，将任务范围内受信任的文件暂存至 Git Index：

```bash
git add -- <task-owned-file-1> <task-owned-file-2>
```

随后 Parent 通过 `imm-loop` 调用 `imm_kernel_canary` foreground Tool：先记录 acceptance evidence，再运行确定性 QA；QA 通过后由保留的 foreground Agent 完成 Review，并把 verdict 提交回 Kernel。Tool 结果始终返回新的 Kernel projection 与 `next_action`，Parent 不依赖隐藏的会话状态，也不轮询后台任务。

当 `next_action` 指向授权时，Parent 再次调用 `imm_kernel_canary` 的 `request_authorization` action。宿主显示 native TUI confirmation；用户取消、超时或 host abort 都保持零 authority writes。任务结束由 Tool 返回 `phase=done` 与 `next_action=none`。

---

## 🛠️ 公开操作面

| 操作 | 责任 |
| :--- | :--- |
| 自然语言仓库请求 | 自动进入 Managed Path；无需记忆入口名称或命令 |
| `imm-brainstorm` | 澄清实质歧义，不执行仓库修改 |
| `imm-planner` | 创建和修订 TaskIntent，不自动 Enrollment |
| `imm-loop` | 通过 foreground Tools 协调执行、QA、Review、恢复与收尾 |
| `imm_canary_enrollment` | TUI-only Enrollment、rehearsal、确认与中断恢复 |
| `imm_kernel_canary` | 记录 evidence、推进 assurance、提交 Review、请求授权与完成任务 |

上述为唯一的用户工作流入口。Enrollment、assurance、authorization 和 successor 状态转换没有 Slash Command fallback 或替代 alias。

---

## ⚙️ 配置文件说明

本地配置文件固定位于：`~/.pi/agent/immune-brain/config.toml`

Pi package 安装负责把 Skills 和 extensions 加入 Pi settings；Immune-Brain runtime 不再需要额外 server 配置。生产 CLI 入口是 `plugins/immune-brain/bin/imm-kernel`，已安装 package 的路径可从 Pi 已加载 Skill 的绝对路径反推。

支持的核心配置选项：
- `advisory_model`: 推荐使用的模型 ID（只要 Pi 自身已配置该模型即可使用）。
- `subagent_activation`: Subagent 触发策略（如 `auto` / `manual`）。

详细说明请参阅 [`docs/reference/immune-brain-config.md`](docs/reference/immune-brain-config.md)。

---

## 📂 项目包结构 (Package Surface)

```text
package.json
plugins/immune-brain/
├── .pi-extension/   # Pi TUI 交互、Kernel 注册与 Authority 扩展入口
├── skills/          # Pi 可自动发现的 Skill 入口
├── dist/            # 打包发布的 Skill 契约与 Reference
├── runtime/         # Bun + TypeScript 核心运行时与 Kernel 引擎
└── bin/             # 命令行 CLI Wrapper 工具
```

---

## 🧪 开发者验证与构建

如果您正在针对本项目进行开发或维护，可以使用以下命令：

```bash
bun test                    # 运行全量单元测试与集成测试
mise run check-plugin       # 验证插件结构与版本一致性
mise run check-dist-sync    # 校验同步生成的分发文档
```

---
*注：Immune-Brain 生产路径使用 `runtime/v4_runtime.ts` 的 Bun + TypeScript 运行时，不依赖 Python；仓库中的 Python 材料仅作为 reference-only 历史参考。*
