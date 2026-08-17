# Pattern: Project-Level Immune-Brain Entry Hygiene

**领域**: Agent workflow / Project repo hygiene  
**描述**: 当仓库中需要使用 Immune-Brain 工作流时，避免把运行引擎脚本长期留在业务仓库目录中，只保留可复用状态与证据文件。

## 可复用前提
- 仓库中已存在 `.imm` 目录用于 plan/work 状态与文档归档。
- 目标环境允许项目外 `imm-*` 命令可达（例如通过 `mise run install-local` 安装到用户级 skill 目录）。
- 需要兼容历史项目或脚本化调用，不能一次性打断用户已有流程。

## 经验规则
1. 只保留 `.imm/memory`、`.imm/specs`、必要的 `.imm/templates`；将执行引擎文件迁移到用户级安装入口（`imm-plan`/`imm-work`/`imm-review`/`imm-dehydrate` 等）。
2. 所有 workflow 示例命令同步到 skill 命令入口，并保留 `--help` 中的兼容提示，避免脚本调用直接报错。
3. 将回退动作落成可执行文档（例如 `.imm-backup/rollback-to-project-local-engine.md`），优先让迁移可回滚而非回滚硬性失败。
4. 把迁移经验沉淀到 `docs/solutions`，并在后续仓库复用时复查“入口变更+回退路径+验证命令”是否齐全。

## 验证依据（本次复用来源）
- `docs/plans/2026-05-07-012-feat-imm-workspace-pollution-reduction-plan.md` 已完成 4 个步骤，完成了入口迁移、文档同步、回退清单补齐。
- `docs/solutions/imm-workspace-pollution-migration-path.md` 记录了推荐迁移与回退顺序。
- 通过 `rg "python3\\s+\\.imm/imm-"` 检查，关键工作流文档里未再出现 `python3 .imm/imm-*` 的实际执行入口。
- 使用 `python3 .imm/imm-review.py pass ...` 对 U1 进行闭环审查，`python3 .imm/imm-work.py status` 显示所有 Step 已完成，`next_skill=imm-compounder`。

## 适用场景
- 新增/合并任何需要在项目内保留 Immune-Brain 目录但不希望引入运行时脚本污染的仓库。
- 需要为历史项目提供新入口迁移说明与兼容回退通道的场景。

---
*沉淀日期: 2026-05-07 | 来源: `docs/plans/2026-05-07-012-feat-imm-workspace-pollution-reduction-plan.md`*
