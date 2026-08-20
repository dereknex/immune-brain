# Spec: Architecture Improvement Wave 3

**Task ID**: ARCH-WAVE-3
**Owner**: Planner
**Status**: Draft — the stale-reference work landed as
`scripts/detect-stale-refs.ts`, not as the `imm-compound-debt.py` extension
described below; that script was deleted with the Python reference runtime
(`docs/solutions/python-reference-retirement-exception-inventory.md`).

## 1. Goal

消除 Immune-Brain 工作流运行时中的 5 个已知架构债务：重复的计划验证逻辑、过大的迭代状态模块、未接入生产路径的仲裁逻辑、缺少标准包结构的开发体验瓶颈、以及无法检测过时文档引用的维护盲区。

## 2. Context

Architecture Explorer (imm-arch-explorer) 通过并行领域调查发现了这些候选项。它们跨越三个 concern 轴：

- **结构去重** (S1, S2): `imm-plan.py` 与 `plan_runtime.py` 的常量和解析逻辑完全重复；`current_iteration_state.py` 混合了至少 4 个独立职责。
- **集成缺口** (S3): `review_arbitration.py` 已通过测试，但 `code_review_subagents.build_code_review_synthesis_from_outcomes` 未调用它，合成路径仍然是简单拼接。
- **开发体验** (A1): 7 个 CLI + 15 个测试使用 `sys.path.insert(0, ...)` 来定位 `imm_core`，没有标准 Python 包结构。
- **文档维护** (A2): 373 份文档互相引用，技能合并后的死引用无自动检测。

## 3. Requirements

### R1. Plan Validation 单一引擎

- `imm-plan.py` 必须成为薄 CLI 包装器（~30 行），所有解析/验证/签名逻辑委托给 `imm_core.plan_runtime`。
- 重复的正则常量（`STEP_HEADER_RE`, `STEP_ID_RE`, `MULTI_RESULT_MARKERS` 等）只保留 `plan_runtime` 中的定义。
- `python3 -m unittest discover -s tests` 全量通过。

### R2. Iteration State 职责拆分

- `current_iteration_state.py` 保留 `LedgerManager` + 状态机调用作为转换权威。
- `heal_current_iteration` 迁移至 `imm_core/heal.py`。
- `migrate_v1_to_v2` 迁移至 `imm_core/migration.py`。
- `dehydrate_closed_steps` 迁移至 `imm_core/dehydration.py`。
- 所有现有测试通过且无行为变化。

### R3. Arbitration 接入合成路径

- `build_code_review_synthesis_from_outcomes` 必须调用 `review_arbitration` 的优先级排序和冲突分组逻辑。
- 当同一 `conflict_group` 存在分歧时，合成结果必须包含冲突报告。
- `review_arbitration.py` 的核心逻辑移入 `imm_core/` 下（遵循已有的包内化模式）。

### R4. `imm_core` 可安装开发包

- 在 `.imm/` 下添加 `pyproject.toml`（`pip install -e .imm/`）。
- 测试文件可通过标准 `import imm_core` 使用，无需 `sys.path.insert`。
- `legacy-installer.sh` 的 copy-based 安装模式不受影响。CLI wrappers 不变。

### R5. 过时文档引用检测

- 在 `imm-compound-debt.py` 中添加检查（或新脚本），检测引用已删除/重命名技能和断裂的 spec/plan 链接。
- 对当前文档运行应产出报告，无误报（有效引用不被标记）。

## 4. Non-Goals

- 不改变 `legacy-installer.sh` 的 copy-based 安装方式或 CLI wrapper 行为。
- 不引入真正的子代理分发 (spawn_agent / Task tool)。
- 不构建远程遥测后端或 UI。
- 不重写历史计划文件。
- 不将 `imm_core` 发布到 PyPI。
