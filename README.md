# Immune-Brain

> 面向 Pi (Coding Agent) 的工程工作流与质量保障引擎。

Immune-Brain 为 Pi 提供确定性的任务意图、自动化 QA 验证、隔离式代码审查 (Subagent Code Review) 以及严谨的用户安全授权。通过将任务意图（Git-tracked `TaskIntent`）与执行状态（Worktree-local Kernel `TaskRecord`）解耦持久化，确保工程工作流不依赖对话记忆或 Session ID，实现跨 Session 状态与证据的零丢失。

> **注**：Pi 是唯一支持的 code-agent 宿主。Pi 可通过自身配置使用任意模型 Provider（如 Anthropic、OpenAI、Google 等）。

---

## 💡 核心特性

- **跨 Session 状态持久化**：工作流状态统一存于 Kernel/State Ledger，脱离 Pi Session Tree 限制。
- **确定性任务边界 (`scope_hint`)**：明确隔离任务改动，排除无关 dirty 文件的干扰与撕裂。
- **确定性后台 QA 验证**：在宿主后台确定性运行测试与脚本，非阻塞 TUI 操作，实时 Footer 追踪。
- **隔离式 Subagent Review**：冻结 `HEAD -> index` 快照并基于 Git Blob OID 读取，避免工作区状态竞争。
- **安全优先的用户授权**：关键风险操作（如 Stop、Resolve Decision、特权操作）均需显式 TUI 二次确认。

---


## 🚀 快速上手 (使用工作流)

标准的 Immune-Brain Canary 工作流分为以下 5 个步骤：

```text
1. 注册意图 (Enroll) ➔ 2. 代码实现 (Execute) ➔ 3. 自动化 QA (Assure QA) ➔ 4. 代码审查 (Assure Review) ➔ 5. 授权闭环 (Authorize/Complete)
```

### 步骤 1：创建或注册任务意图 (TaskIntent)
- **交互式新建**：在 Pi 中输入 `/imm-canary-new <task-id>` 确认创建新任务。
- **从文件注册**：编写 `docs/plans/<task-id>.intent.json`，然后运行 `/imm-canary-enroll docs/plans/<task-id>.intent.json`。

### 步骤 2：代码实现与快照暂存
在完成代码开发后，将任务范围内受信任的文件暂存至 Git Index：
```bash
git add -- <task-owned-file-1> <task-owned-file-2>
```
*系统会根据意图中的 `scope_hint` 校验并冻结 `HEAD -> index` 变动快照。*

### 步骤 3：运行确定性 QA 验证
在 Pi 输入框中运行：
```text
/imm-canary-assure <task-id> qa
```
- 后台确定性运行任务意图中定义的 Verification Descriptors（无 LLM 介入）。
- 异步非阻塞执行，主输入框始终可用，Footer 逐项追踪执行进度与消耗时长。

### 步骤 4：运行隔离式 Code Review
QA 验证通过后运行：
```text
/imm-canary-assure <task-id> review [model]
```
- 启动 Pi Native `general-purpose` Subagent 进行只读代码审查。
- 审阅器仅从快照中读取文件 Blob OID，隔离当前工作区的其它实时改动。

### 步骤 5：审核决策与用户授权
审查完成后，根据返回结果进行闭环授权：
- **解决未决决策**：`/imm-canary-authorize <task-id> resolve-user-decision`
- **执行特权授权**：`/imm-canary-authorize <task-id> <operation>`
- **任务衍生与继承**：若审阅要求重规划，使用 `/imm-canary-succeed <task-id>` 一键原子终止旧任务并同范围派生新任务。

---

## 🛠️ Slash 命令参考

| Slash 命令 | 描述说明 | 适用场景 |
| :--- | :--- | :--- |
| `/imm-canary-new <task-id>` | 确认并创建新的 Kernel 任务意图 | 开始全新任务时 |
| `/imm-canary-enroll [intent-file]` | 校验并向 Kernel 后端注册指定 `TaskIntent` | 导入已编写好的意图文件时 |
| `/imm-canary-assure <task-id> qa` | 触发后台确定性 QA 验证（非阻塞） | 代码编写完成后验证逻辑 |
| `/imm-canary-assure <task-id> review [model]` | 启动隔离式 Subagent 进行只读代码审查 | QA 通过后发起代码与安全审查 |
| `/imm-canary-assure <task-id> cancel` | 取消正在运行的后台 QA 或 Review 任务 | 需要中断正在执行的后台验证时 |
| `/imm-canary-authorize <task-id> <op>` | 执行需要显式授权的 privileged action | 收到用户授权门控请求时 |
| `/imm-canary-authorize <task-id> resolve-user-decision` | 解决当前唯一的 open user-decision finding | 存在待决策项 Finding 时 |
| `/imm-canary-succeed <task-id>` | 原子终止 `replan_required` 任务并派生继承任务 | 任务需重规划或进行后续演进时 |

---

## ⚙️ 配置文件说明

本地配置文件固定位于：`~/.pi/agent/immune-brain/config.toml`

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
*注：Immune-Brain 生产路径使用 Bun + TypeScript 运行时，不依赖 Python。*
