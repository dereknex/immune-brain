origin: user request and .imm/specs/imm-workspace-pollution-reduction.spec.md
date: 2026-05-07
summary: 减少 `.imm` 在业务项目中的 Python 执行文件污染，保留 `.imm/memory` 与计划证据，在用户级工具链中承载 workflow engine。

# Task
- Summary: 降低 `.imm/` 在项目中的运行时脚本污染，同时保留现有 plan/work/qa 小步闭环。
- Origin: 用户确认的需求（移除 `.imm` 目录中的 Python 文件污染）。
- Research: 已确认 `IMMUNE.md` 与 `.imm/templates/iteration-plan-template.md` 的边界规则，检查 `README.md`、`scripts/legacy-installer.sh`、既有 plan/work 产物和 `imm-workspace` 相关规格；结论是：当前实现将 workflow engine 与项目状态耦合，需分离。
- Decisions:
  1. 默认不在项目内存放执行引擎脚本，改为用户级安装路径。
  2. `.imm` 继续作为项目状态与计划文档容器（`memory`、`specs`、`templates`），避免破坏现有可复用工作流上下文。
  3. 保留兼容层：检测到旧路径时提示迁移，而不是直接终止执行。
- Assumptions:
  - 运行时入口可被重定向到用户级路径（如 `~/.agents`/`~/.immune-brain`）而不影响 skill 的权限模型。
  - 先做“污染隔离”边界收敛，不在同一轮引入跨生态工具链重构。

## Steps

### Step 1
- Step ID: U1
- Result: 新增 `.imm/specs/imm-workspace-pollution-reduction.spec.md`。
- Verification: `.imm/specs/imm-workspace-pollution-reduction.spec.md` 存在且包含目标、非目标、验收标准、依赖项。
- Depends on: none

### Step 2
- Step ID: U2
- Result: 在 `scripts/legacy-installer.sh --help` 说明文案里补充工具入口路径说明。
- Verification: 通过仓库内文档与配置确认安装脚本/入口描述具备新路径和兼容行为（未要求立即执行命令），并能在无新文件时给出迁移提示。
- Test scenarios: Covers U2.C1
- Depends on: 1

### Step 3
- Step ID: U3
- Result: 更新 README 中的 workflow 示例命令。
- Verification: `README.md`、`skills/imm-planner/`, `skills/imm-work/`, `skills/imm-executor/`, `skills/imm-qa/`, `skills/imm-autowork/` 中 workflow 命令示例使用新入口约定；`scripts/legacy-installer.sh --help` 文本仅保留兼容说明；`docs/plans/2026-05-07-012-feat-imm-workspace-pollution-reduction-plan.md` 与 `docs/solutions/imm-workspace-pollution-migration-path.md` 共同记录迁移路径。
- Test scenarios: Covers U3.C1
- Depends on: 2

### Step 4
- Step ID: U4
- Result: 新增 `.imm-backup` 回滚操作清单。
- Verification: `.imm-backup` 目录存在且至少包含 `rollback-to-project-local-engine.md` 一份可执行回滚清单。
- Depends on: 2, 3
- Test scenarios: Covers U4.C1

## Notes
- 每个 step 只承诺一个可验证结果；如需再细化子任务，需在后续 plan 中继续拆分。
- 回滚条件：任意 step 无法保持兼容或出现状态读写失败时，回退到原有项目内脚本调用方式并记录 replan。
