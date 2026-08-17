# Spec: minimal imm init bootstrap

**任务 ID**: IMM-WORKFLOW-006
**负责人**: Planner
**状态**: Proposed

## 1. 目标

新增一个 `init` skill，用于在其他项目接入 Immune-Brain 工作流时，只初始化最小必需的目录和文件。

首版聚焦“让外部项目具备进入 `imm-brainstorm -> imm-planner -> imm-work` 的最小落点”，不把当前仓库的运行引擎、模板全集或扩展文档复制到目标项目。

## 2. 问题背景

当前仓库已经形成稳定的 `brainstorm -> preplan -> planner -> work -> review -> compound` 工作流，但这些流程默认假设目标项目内已经存在若干固定落点，例如 `IMMUNE.md`、`.imm/specs/`、`docs/plans/` 和持久化记忆文件。

对于首次接入的外部项目，如果没有一个统一的最小初始化入口，就会出现以下问题：

- 工作流入口不明确，`AGENTS.md` 或同类说明缺少 Immune-Brain 路由信息。
- 规划与讨论产物没有固定落点，后续 skill 需要临时猜目录。
- 目标项目容易被误初始化为“整套本地引擎副本”，把 `.imm/imm-*.py` 等运行脚本污染进业务仓库。

已有沉淀 [Project-Level Immune-Brain Entry Hygiene](docs/solutions/imm-workspace-pollution-control-pattern.md) 已明确：项目内应只保留可复用状态与证据文件，不保留本地运行引擎脚本。因此本轮范围应继续收窄到最小 bootstrap。

## 3. 功能需求

### R1. 最小初始化集合

`init` skill 首版必须只确保以下目录或文件存在：

- 目录：
  - `.imm/memory/`
  - `.imm/specs/`
  - `docs/brainstorms/`
  - `docs/plans/`
- 文件：
  - `IMMUNE.md`
  - `AGENTS.md`
  - `.imm/memory/MEMORY.md`

若父目录不存在，可一并创建，但不得额外初始化不在列表内的仓库级目录。

### R2. 最小入口文件内容

- `IMMUNE.md` 必须提供最小版 Immune-Brain 宪法，至少说明：
  - 文件即记忆
  - 规格驱动
  - 小步执行
  - 角色边界与基本 workflow 顺序
- `AGENTS.md` 必须提供项目级入口说明，明确：
  - 本项目使用 Immune-Brain 工作流
  - 关键规则以 `IMMUNE.md` 为准
  - 后续需求澄清、规划、执行应通过 `imm-*` 角色流转
- `.imm/memory/MEMORY.md` 必须包含最小骨架，至少有：
  - `当前状态`
  - `任务历史`
  - `知识索引`

### R3. 非破坏式与幂等行为

首版必须优先保证非破坏式初始化：

- 重复执行时，只创建缺失目录或文件。
- 已存在的 `IMMUNE.md` 与 `.imm/memory/MEMORY.md` 默认不得覆盖。
- 已存在的 `AGENTS.md` 默认不得整文件覆盖；若缺少 Immune-Brain 项目入口，可追加一个边界清晰、可重复检测的段落。
- 同一项目重复执行后，不得产生重复的 Immune-Brain 说明段落或重复目录。

### R4. 足迹约束

首版不得初始化以下内容：

- `.imm/imm-*.py`、`.imm/templates/`、`.imm-backup/`
- `.imm/memory/state.json`
- `.imm/memory/current_iteration.json`
- `docs/solutions/`
- 示例 brainstorm、spec、plan 文档
- 测试、CI、安装脚本或项目业务模板

### R5. 完成后的最小可用状态

初始化完成后，目标项目必须满足以下最小工作前提：

- `imm-brainstorm` 产物有固定落点：`docs/brainstorms/`
- `imm-planner` 产物有固定落点：`docs/plans/` 与 `.imm/specs/`
- `imm-planner` 的“先读 `IMMUNE.md`”前提可满足
- 持久化记忆可落到 `.imm/memory/MEMORY.md`

首版不要求 runtime state 文件立即存在；允许后续 workflow 在首次实际运行时惰性创建。

## 4. 验收标准

- [ ] 对空白项目执行初始化后，只出现需求中列出的最小目录与文件。
- [ ] 初始化不会把当前仓库的 `.imm/imm-*.py` 或其他本地引擎文件复制到目标项目。
- [ ] 对已有 `AGENTS.md`、`IMMUNE.md` 或 `MEMORY.md` 的项目重复执行，不会覆盖用户已有内容。
- [ ] 若 `AGENTS.md` 缺少 Immune-Brain 入口说明，重复执行最多补齐一次，不产生重复段落。
- [ ] 初始化完成后，后续 `imm-brainstorm` / `imm-planner` 所需落点已齐备，无需再手工建目录。
- [ ] 对应计划通过 `imm-plan <plan-path> --json` 校验。

## 5. 非目标

- 不在本轮安装或分发 `imm-*` 命令本身。
- 不在本轮复制当前仓库的 `.imm` 运行引擎到目标项目。
- 不在本轮预生成 brainstorm / spec / plan 示例文档。
- 不在本轮初始化 `docs/solutions/`、review 报告模板或 runtime state 文件。
- 不在本轮做项目类型识别、语言特定脚手架或业务约定注入。

## 6. 依赖项

- 依赖 `IMMUNE.md` 规定的 planner / work / review 工作流边界。
- 依赖 [Project-Level Immune-Brain Entry Hygiene](docs/solutions/imm-workspace-pollution-control-pattern.md) 作为“只保留项目内最小工件、不复制引擎”的设计依据。
- 依赖目标环境中 `imm-*` 工作流入口已经通过用户级安装或其他方式可达；`init` 只负责项目内工件，不负责工具分发。

## 7. 首版验证路径

首版实现完成后，至少必须覆盖以下两类验证：

### V1. 空白项目 bootstrap

- 场景：对一个空白 fixture 项目运行 `init`。
- 期望：只创建 R1 中列出的目录与文件；不存在额外 `.imm/imm-*.py` 或 runtime state 文件。
- 证明方式：fixture 断言或 focused test 明确检查生成后的路径集合。

### V2. 已有文件项目的幂等保护

- 场景：对已存在 `AGENTS.md`、`IMMUNE.md` 或 `.imm/memory/MEMORY.md` 的 fixture 项目重复运行 `init`。
- 期望：已有文件不被覆盖；`AGENTS.md` 中的 Immune-Brain 入口说明至多存在一份；命令输出能区分 `created` 与 `skipped`。
- 证明方式：focused fixture 或本地测试比较前后文件内容并断言段落不重复。

## 8. 参考资料

- [IMMUNE.md](IMMUNE.md)
- [Pattern: Project-Level Immune-Brain Entry Hygiene](docs/solutions/imm-workspace-pollution-control-pattern.md)
