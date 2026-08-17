# Spec: TDD execution discipline integration

**任务 ID**: IMM-TDD-001  
**负责人**: Planner  
**状态**: Accepted

## 1. 目标

在 Immune-Brain 的 plan → execute → qa 主线中嵌入 TDD 执行姿势信号，使得：
- Planner 可以按任务特征标注 test-first / characterization-first 执行姿势
- Executor 在标注 step 上强制先写失败测试再实现
- QA 对标注 step 额外核查时间序证据（测试先于实现）

对齐上游 CE `ce-plan` Execution note + `ce-work` TDD guardrails 模式；不引入 GSD 级别的 XML 元数据或独立 TDD plan 类型。

## 2. 功能需求

### 2.1 Plan step 新增 `Execution note` 字段
- 可选字段，合法值：`test-first` | `characterization-first` | 省略（等价于 pragmatic）
- `imm-planner` 在规划阶段检测以下信号时写入：
  - 用户显式要求 TDD
  - 目标区域脆弱或无测试覆盖
  - 有清晰输入/输出契约的行为变更
- 纯 spec/文档/配置/接线类 step 不标注

### 2.2 Executor TDD guardrails
- 当 step 标注 `Execution note: test-first` 时：
  1. 先写失败断言（RED），运行确认失败原因与预期行为对齐
  2. 写最小实现让测试通过（GREEN），不超出 step Result 范围
  3. 绿灯保护下重构（REFACTOR）
- 不在同一编辑动作里同时写测试和实现
- 不跳过确认新测试先失败
- 若 RED 阶段测试意外通过则标记 already-implemented 跳到验证
- `characterization-first`：先捕获现有行为快照再修改
- 无标注 step：常规执行但实现后仍须补测试

### 2.3 QA TDD 证据核查
- 当 step 带 `test-first` 时额外核查：
  - 执行证据（commit history / record-execution）中可见测试先于实现的时间序
  - RED 阶段失败输出与 step Result 对齐
  - 所有 Test scenarios 对应的断言通过
- 证据缺失 → `rework`，原因标注 `missing TDD sequence evidence`

## 3. 非目标
- 不修改 `imm-plan.py` 验证逻辑（第一期为文档约定）
- 不修改 `.imm/memory/` JSON schema
- 不引入 CI 覆盖率门禁
- 不新建独立 TDD plan 类型
- 不改变 `imm-work` CLI 接口

## 4. 验收标准 (QA Points)
- [x] `skills/imm-planner/SKILL.md` 包含 Execution note 信号检测规则与合法值说明
- [x] `skills/imm-executor/SKILL.md` 包含 TDD Execution Discipline 段落，含 RED/GREEN/REFACTOR 约束与例外
- [x] `skills/imm-qa/SKILL.md` 包含 TDD 证据核查条款
- [x] 三个 skill 文件改动不破坏现有通用流程（无标注 step 行为不变）
- [x] `python3 -m unittest tests.test_skill_contracts` 仍然通过

## 5. 依赖项
- 依赖于 `IMMUNE.md` 中「Goal-driven execution：每一步都要能被命令、测试或人工检查验证」原则
- 对齐 CE `ce-plan` Phase 1.1b Execution Posture Signals 与 `ce-work` TDD guardrails
