# Spec: planning granularity vs acceptance granularity & preplan routing

**任务 ID**: IMM-WORKFLOW-GRAIN-001  
**负责人**: Planner  
**状态**: Draft

## 1. 目标

- 避免把 **`imm-preplan-review` 当成默认下一站**，在无风险信号时反复收窄成「单一最小切片」，导致总迭代轮数膨胀。
- 在 **`imm-planner` 层允许较大的规划粒度**：用少量 **outcome step** 覆盖同一 Epic / 能力边界，而不是把同一可验收成果拆成动作型微步骤。
- 明确 **双层粒度**：规划步是「可交付、可验证的成果单元」；步内实现可以包含多次提交 / 多文件，只要该步的 **Result + Verification** 能一次性举证闭合。

## 2. 功能需求

### 2.1 `imm-planner` 契约

- 继续遵守：每个 step **一个** user-verifiable result；**拒绝** action-micro steps。
- 新增强调：在 framing 稳定、验证路径已命名时，**优先用较少 step 覆盖完整目标边界**，而不是为满足「小」而拆碎同一 outcome。
- 区分两类「小」：
  - **窄范围（narrow option）**：在多个合法 Epic 中选对当前目标有害最少的一条 —— 允许。
  - **动作级微步骤**：把同一结果拆成读文件 / 改一行 / 跑命令等碎片 —— 禁止。

### 2.2 `imm-preplan-review` 契约

- 保持 **trigger-only risk gate**；强化 **Next Action**：关口通过后默认 **`imm-planner`**，而非默认 **Scope Reduction**。
- 明确 **Hold Scope / Selective Expansion** 与 **Scope Reduction** 并列；仅在证据显示范围漂移或验证不可执行时，才推动收窄。

### 2.3 治理与用户文档

- `IMMUNE.md`：在「小步执行」或组合主线附近，用简短文字对齐 **规划成果单元** 与 **步内实现批次**，并与「条件 preplan」一致。
- `README.md`：在小任务仍可走 one-step plan 的前提下，补充 **较大特性** 下「少 step、每步 outcome 完整」的表述（保留现有关于小修复 / one-step 的句子以满足既有契约测试）。

## 3. 验收标准

- [ ] `skills/imm-planner/SKILL.md` 含「双层粒度」或等价表述，并禁止把「范围收窄」偷换成动作微步骤。
- [ ] `skills/imm-preplan-review/SKILL.md` 含「关口通过后默认 `imm-planner`」及「非默认 Scope Reduction / 非单一最小切片仪式」的明确表述。
- [ ] `IMMUNE.md` 相应小节与上述语义一致且无自相矛盾。
- [ ] `README.md` 补充较大特性下的规划粒度指引，且仍保留「小修复可走 validated one-step」路径描述。
- [ ] `tests/test_skill_contracts.py` 增加（或扩展）针对上述关键句的断言，`python3 -m unittest tests.test_skill_contracts` 通过。
- [ ] `python3 .imm/imm-plan.py docs/plans/2026-05-10-049-feat-planning-granularity-preplan-routing-plan.md --json` 校验通过。

## 4. 非目标

- 不改 `.imm/imm-plan.py` 步数算法（仍以 outcome 与字段合法性为准）。
- 不引入新的 workflow stage 或运行时状态。
- 不重写全部 workflow skill，仅触及本 spec 列出的文件。

## 5. 依赖

- 前置对话与工作流摩擦：`imm-preplan-review` 被过度推荐、`README` 中小任务措辞易被误读为「一切都要最小一步」。
- 既有文档：`IMMUNE.md` §5、`skills/imm-planner/SKILL.md`、`skills/imm-preplan-review/SKILL.md`。
