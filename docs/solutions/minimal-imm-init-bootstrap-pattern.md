# Pattern: Minimal Immune-Brain Project Bootstrap

**领域**: Agent workflow / Project bootstrap  
**描述**: 当外部项目首次接入 Immune-Brain 工作流时，只初始化最小必需目录和文件，避免把本地运行引擎和扩展文档复制进业务仓库。

**reusability**: high  
**next_reuse_scenarios**: [为新项目接入 Immune-Brain workflow, 需要最小化项目污染的 workflow 初始化, 希望重复执行安全的项目级 bootstrap]

## 可复用前提

- 目标项目只需要进入 `imm-brainstorm -> imm-planner -> imm-work` 的最小工作流闭环。
- `imm-*` 命令通过用户级安装或其他外部入口可用，不依赖项目内 `.imm/imm-*.py`。
- 目标项目允许增加少量 workflow 辅助目录和说明文件。

## 经验规则

1. 只初始化最小工件：`IMMUNE.md`、`AGENTS.md`、`.imm/memory/MEMORY.md`、`.imm/specs/`、`docs/brainstorms/`、`docs/plans/`。
2. 不复制项目级运行引擎：不要创建 `.imm/imm-*.py`、`.imm/templates/`、runtime state 文件或 `docs/solutions/`。
3. 对已有文件优先保护而不是覆盖：`IMMUNE.md` 与 `MEMORY.md` 默认只跳过；`AGENTS.md` 只在缺少入口说明时追加一次带 marker 的边界区块。
4. bootstrap 输出应区分 `created`、`updated`、`skipped`，让重复执行结果可直接判断而不必人工 diff。

## 验证依据

- `skills/imm-init/scripts/init_project.py` 在空白临时项目中只创建了最小工件集合。
- 同一空白项目第二次运行时，核心文件全部进入 `skipped`，没有新增额外目录或文件。
- 预置自定义 `AGENTS.md`、`IMMUNE.md`、`.imm/memory/MEMORY.md` 的临时项目中，只更新了 `AGENTS.md`，并且 marker 区块只追加一次。
- 工作流计划 [2026-05-08-004-feat-imm-init-minimal-bootstrap-plan.md](docs/plans/2026-05-08-004-feat-imm-init-minimal-bootstrap-plan.md) 的 U1/U2 已通过闭合。

## 适用场景

- 把 Immune-Brain workflow 接入一个尚未初始化的外部项目。
- 需要“项目内保留证据和入口，运行引擎保持仓库外”的轻量 bootstrap。
- 需要可以安全重复执行的 workflow 初始化入口。

## 不适用场景

- 目标项目需要完整复制本仓库的 `.imm` 运行时或模板集合。
- 目标项目要求按语言、框架或业务域生成额外脚手架。
- 需要合并复杂的现有项目文档结构，而不只是追加一个边界清晰的入口区块。

---
*沉淀日期: 2026-05-08 | 来源: `docs/plans/2026-05-08-004-feat-imm-init-minimal-bootstrap-plan.md`*
