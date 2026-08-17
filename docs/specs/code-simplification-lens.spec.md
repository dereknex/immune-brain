# Spec: Code simplification lens for imm-code-review

**任务 ID**: IMM-SIMPLIFY-LENS-001
**负责人**: Planner
**状态**: Accepted

## 1. 目标

借鉴上游 `addy/code-simplification` 和 `ce-simplify-code` 的核心机制，在**现有编排节点**上挂载简化能力，而不新建独立 `imm-simplify` skill。

- 在 `docs/reference/` 新增**薄索引** `code-simplification-checklist.md`，链到两个 submodule 的全文。
- 在 `imm-code-review` 的 Workflow Rules 中新增**简化透镜触发条件**，并通过已有 Progressive checklists 机制指向该索引。

## 2. 功能需求

### 2.1 Reference 索引

- 新建 `docs/reference/code-simplification-checklist.md`。
- 必含：
  - 索引定位（本文件是索引，深度条目在 submodule 全文）。
  - **范围解析优先级**（用户指定 → `git diff base...` → `git diff HEAD`，空范围停步追问）。
  - **三透镜检查维度**（复用 / 质量 / 效率）及每个维度 3-5 条关键信号。
  - **何时不该简化**的边界（已经清晰、不理解代码、即将重写、性能关键路径）。
  - 链到 submodule 全文的相对路径：
    - `upstreams/addy-agent-skills/skills/code-simplification/SKILL.md`
    - `upstreams/compound-engineering/plugins/compound-engineering/skills/ce-simplify-code/SKILL.md`
  - Immune-Brain 边界声明：简化 findings 仍走 `imm-code-review` 的 `direct_fix` / `new_slice` 路由，不引入新 authority path。

### 2.2 imm-code-review 接入

- 在 `imm-code-review/SKILL.md` 的 **Core Responsibilities → Progressive checklists** bullet 中，追加简化透镜的触发条件与索引路径。
- 触发条件：当 review scope 覆盖分支 diff（PR 前整体审查）且代码已通过功能验证时，额外以复用/质量/效率三维度审视 diff。
- 引用格式与现有 `agent-quality-checklists.md` 一致（一行 "详见..."）。

## 3. 验收标准

- [ ] `docs/reference/code-simplification-checklist.md` 存在且满足 §2.1 全部条目。
- [ ] `skills/imm-code-review/SKILL.md` Progressive checklists 含简化透镜触发与索引路径。
- [ ] 两个 submodule 相对路径可达（`ls` 确认文件存在）。
- [ ] `python3 -m unittest tests.test_skill_contracts` 通过（不破坏现有契约）。

## 4. 非目标

- 不新建 `imm-simplify` 或 `imm-code-simplify` 独立 skill。
- 不修改 `imm-executor` Rationalizations（现有 "Fix adjacent cleanup while here" 已语义覆盖）。
- 不引入并行三 agent spawn 机制。
- 不在本 spec 内修改 `IMMUNE.md` 或 `imm-work` Decision Tree。

## 5. 依赖

- `upstreams/addy-agent-skills` 与 `upstreams/compound-engineering` submodule 已存在于 `.gitmodules`。
- `docs/reference/agent-quality-checklists.md` 薄索引模式已建立可复用。
