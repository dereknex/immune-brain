# Pattern: Workspace Authorization Hygiene

**领域**: Agent workflow / Workspace boundary hygiene  
**描述**: 当 Immune-Brain 工作流需要跨 project、worktree 或用户级全局路径运行时，优先通过会话启动位置和路径边界排查来减少同类授权提示，而不是先把问题归咎于某个单独命令。

**reusability**: high  
**next_reuse_scenarios**: [`Codex 会话从错误目录启动导致授权提示`, `需要解释 ~/.codex/worktrees 与当前 workspace 的边界`, `安装 CLI wrapper 或写入 ~/.immune-brain 时预判授权来源`, `为其他项目补 workflow 入口文档时说明授权预期`]

## 可复用前提
- 使用场景涉及 Codex 的 workspace 边界，而不是纯项目内文件读写。
- workflow 可能访问当前 project 之外的目录，例如外部 worktree 或用户级全局路径。
- 目标是减少意外授权提示和错误归因，而不是通过本轮直接改 sandbox 或运行时机制。

## 经验规则
1. 默认从目标 project 根目录启动 Codex 会话，不要把“先在别的 workspace 启动，再 `cd` 到外部路径执行命令”当成推荐路径。
2. 若出现类似授权提示，先检查是否进入了当前 workspace 之外的目录上下文，例如 `~/.codex/worktrees/...`。
3. 再检查是否命中了用户级全局写入路径，例如 `~/.agents/skills`、`~/.local/bin`、`~/.immune-brain`。
4. 将“显式跨 workspace 的安装或状态写入动作”单独看待，例如安装 CLI wrapper、写入全局 dev insights inbox；这些更接近预期提示面，不应默认当成 bug。
5. 文档里要明确区分“减少同类提示”与“消除所有提示”，避免对外部路径访问或全局写入做静默成功承诺。

## 验证依据（本次复用来源）
- [README.md](README.md) 已新增“会话启动建议”，明确要求从目标 project 根目录启动会话，并避免先在别处启动再 `cd` 到外部 worktree 或项目目录。
- [imm-workspace-pollution-migration-path.md](docs/solutions/imm-workspace-pollution-migration-path.md) 已新增同类授权提示排查清单，覆盖外部 workspace 上下文、用户级全局路径，以及显式跨 workspace 持久化动作。
- 聚焦检查已确认文案同时满足两点：能指出高概率触发面；不承诺所有外部路径访问或全局写入都会静默通过。

## 适用场景
- 需要解释为什么某条 workflow 命令会触发授权提示，但不想误导到单个 `imm-*` 命令实现。
- 为其他项目复用 Immune-Brain workflow 时，需要先写清会话启动位置和全局路径边界。
- 后续如果再遇到 `~/.codex/worktrees/...`、`~/.agents/skills`、`~/.local/bin`、`~/.immune-brain` 相关提示，可先按这条模式排查，再决定是否值得进入脚本或 sandbox 改造。

---
*沉淀日期: 2026-05-08 | 来源: `docs/plans/2026-05-08-006-feat-workspace-authorization-hygiene-plan.md`*
