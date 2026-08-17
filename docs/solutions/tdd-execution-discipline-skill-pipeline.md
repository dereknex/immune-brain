# Pattern: TDD execution discipline via Execution note plus guardrails

**领域**: Agent workflow / Skill contracts / Test-first discipline  
**描述**: 把 CE 风格的「规划侧 Execution note + 执行侧 RED/GREEN 纪律 + QA 时间序证据」嵌进 Immune-Brain，而不改 `imm-plan.py`、不改 `.imm/memory` schema。

## 场景

- 需要在「计划—执行—验收」链路上落实 TDD，但不想像 GSD 那样在任务 XML 里写 grep 门禁。
- Planner 已经产出 `Result` / `Verification` / `Test scenarios`，仍缺少「执行姿势」信号。
- `imm-plan.py` 禁止 `Result` 中出现 ` and `、逗号等 **MULTI_RESULT_MARKERS**，写作 outcome 单行时要注意措辞。

## 方案模板

1. **Planner**：在 **Planning Rules** 或 **Core Responsibilities** 增加 **Execution Posture Detection**——何时写 `Execution note: test-first` 或 `characterization-first`，何时省略；明确不写字面 RED/GREEN/REFACTOR 子步骤。
2. **Executor**：增加 **TDD Execution Discipline** 小节——RED → GREEN → REFACTOR、同一步禁止测试与实现混写、必须先看到失败测试等 guardrails。
3. **QA**：增加 **TDD Evidence Check**——仅当 step 带 `test-first` 时核查 commit / record-execution 中的时间序；缺证据 → `rework` 并标注原因。
4. **合约测试**：在 `tests/test_skill_contracts.py` 中断言三个 skill 文件包含约定短语（或等价小节标题），防止文档漂移。
5. **Dogfood**：若计划 step 自身标 `Execution note: test-first`，执行时先写红测再实现，与 discipline 一致。

## 可复用前提

reusability: high  

next_reuse_scenarios: 下一 slice 若要对 `imm-plan.py` 校验 `Execution note` 合法值；若要对 commit message 约定 `test(red):` 前缀；复制到其他仓库时保留「plan 不写微步脚本、执行层扛纪律」的分工。

## 验证依据

- Plan `2026-05-11-060-feat-tdd-execution-discipline-plan.md` 一步闭环；`python3 -m unittest tests.test_skill_contracts tests.test_activation_plan` 全绿。
- `skills/imm-planner/SKILL.md`、`skills/imm-executor/SKILL.md`、`skills/imm-qa/SKILL.md` 含约定段落；`.imm/specs/tdd-execution-discipline.spec.md` 记录范围与非目标。

## 约束与建议

- 合约测试须落在 **`SkillContractTests`** 等语义正确的类下，避免误挂在其他 `unittest.TestCase` 子类末尾导致 discover 路径怪异。
- `record-execution` 仍要求 `--changed-files`；TDD 证据写在 `--notes`（例如 RED 先于 GREEN 的说明）便于 QA 核对。
