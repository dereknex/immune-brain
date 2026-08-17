# Pattern: Immune-Brain Workflow Entry Migration

**领域**: Agent workflow / Entry migration  
**描述**: 把项目内 `.imm/imm-*.py` 的工作流入口迁移为用户级 skill 调用入口，减少业务仓库中的运行时 Python 污染。

## 变更动机

项目中当前 workflow 仍有 `python3 .imm/imm-*.py` 的文档示例入口。为减少仓库污染，计划将推荐入口收敛到用户级安装目录（`~/.agents/skills`）的 skill 命令链路，并保留兼容回退路径，避免历史项目一次性中断。

## 迁移路径（推荐）

1. 安装本地 skills 到用户目录（包含 `imm-*` skill 命令入口）：
   - `mise run install-local`
2. 在项目文档与自动化流程里用 skill 命令替换项目内脚本入口：
   - `imm-plan`, `imm-work`, `imm-review`, `imm-heal`, `imm-dehydrate`, `imm-finish`
3. 运行并校验基础状态流转：
   - `imm-work status`
4. 若仓库内出现历史调用（例如脚本化脚本/CI 记录），按本仓库回退清单进行兼容：
   - `docs` 与 `README` 的迁移说明统一改为 `imm-` skill 命令
   - 临时保留或回滚到项目级脚本调用时，按 `.imm-backup/rollback-to-project-local-engine.md` 执行

## 回退策略

若新增入口在当前项目环境不可用（例如用户 skill 目录未重建），按以下顺序恢复到兼容行为：

1. 通过 `.imm-backup/rollback-to-project-local-engine.md` 确认兼容开关与回退顺序。
2. 按回退清单将 workflow 命令恢复为兼容式 `.imm/imm-*.py` 调用（仅限过渡期）。
3. 完成新入口可用后，再逐步恢复 skill 命令文档入口。

## 同类授权提示排查

如果后续仍遇到类似授权提醒，优先检查以下几类路径边界：

1. **当前 workspace 之外的目录上下文**：
   - 例如先在别的仓库启动会话，再 `cd` 到 `~/.codex/worktrees/...` 或另一个 project 目录执行命令。
2. **用户级全局写入路径**：
   - 例如 `~/.agents/skills`、`~/.local/bin`、`~/.immune-brain`。
3. **显式跨 workspace 的安装或状态写入动作**：
   - 例如安装 CLI wrapper、写入全局 dev insights inbox，或其他不落在当前 project 内的持久化动作。

这份清单用于优先定位高概率来源，帮助减少同类授权提示；它不保证所有外部路径访问或全局写入都会静默通过。

## 验证

- `README.md` 中 workflow 示例命令使用新入口约定（避免 `python3 .imm/imm-*.py`）。
- `scripts/install-local.sh --help` 与 `docs/plans/2026-05-07-012-feat-imm-workspace-pollution-reduction-plan.md` 均记录了回退路径说明。
- `.imm-backup/rollback-to-project-local-engine.md` 提供可执行的回退步骤。

---
*沉淀日期: 2026-05-07 | 来源: `docs/plans/2026-05-07-012-feat-imm-workspace-pollution-reduction-plan.md`*
