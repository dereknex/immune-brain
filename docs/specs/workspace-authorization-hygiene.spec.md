> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: Workspace Authorization Hygiene

**任务 ID**: IMM-WORKFLOW-OPS-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标
把本次“授权提醒”经验收敛为可复用的工作流规则：默认从目标 project 根目录启动 Codex 会话，并明确同类授权触发面的检查清单，避免后续把问题误归因到单个 `imm-*` 命令。

## 2. 需求

### R1. 会话启动位置规则
- repo-facing 文档需要明确：默认在目标 project 根目录启动会话。
- 不把“先在别的 workspace 启动，再 `cd` 到外部 worktree / project 目录执行命令”作为推荐路径。
- 规则应以最小操作建议表达，不引入新的自动跳转或 wrapper 机制。

### R2. 同类授权触发面清单
- 需要把当前问题相邻的高概率触发面写成可检查清单，而不是只记录单一案例。
- 至少覆盖以下类别：
  - 当前 workspace 之外的目录上下文，例如 `~/.codex/worktrees/...`
  - 用户级全局写入路径，例如 `plugin skill registry`、`~/.local/bin`、`~/.immune-brain`
  - 明知需要额外权限的命令入口，例如 installer、global inbox、或其他显式越过 workspace 边界的写操作
- 清单目标是帮助预判提示来源，不承诺消灭全部授权弹窗。

### R3. 边界与预期管理
- 文档需要明确：从目标 project 根目录启动会话可以减少这类授权提醒，但不代表任何外部路径访问都会静默成功。
- 对于全局安装、全局 inbox、或 workspace 外路径写入，仍应保留“可能需要授权”的说明。

## 3. 验收标准
- [ ] 至少一处用户入口文档明确推荐“从目标 project 根目录启动会话”。
- [ ] 至少一处 workflow/安装说明文档列出同类授权触发面的最小检查清单。
- [ ] 文档明确区分“降低提示概率”和“消除所有授权提示”，避免过度承诺。
- [ ] 本轮范围不扩展到脚本逻辑修改、sandbox 配置改写、或 worktree 自动化。

## 4. 依赖项
- [IMMUNE.md](IMMUNE.md)
- [Pattern: Project-Level Immune-Brain Entry Hygiene](docs/solutions/imm-workspace-pollution-control-pattern.md)
- [README.md](README.md)
- `scripts/legacy-installer.sh`
- `.imm/imm-finish.py`

## 5. 非目标
- 不在本轮修改 `imm-dehydrate.py`、`imm-finish.py`、installer 或 sandbox 行为。
- 不为 `~/.codex/worktrees/...` 增加自动识别、自动切换或自动提权逻辑。
- 不把所有可能的系统级授权来源都纳入同一次改动。
