# Spec: outcome-based step planning

**任务 ID**: IMM-PLANNING-002
**负责人**: Planner
**状态**: Draft

## 1. 目标
移除 Immune-Brain planning 中的固定 step 数量约束，改为只按可独立闭合结果拆分计划。Planner 不应为了满足数量范围而拆出动作型 step，也不应为了压缩数量而合并不同结果。

## 2. 功能需求
- **Plan 约束**：
  - Step 数量必须由可独立闭合结果自然决定。
  - 每个 step 必须描述一个结果状态，而不是读取、编辑、运行命令等执行动作。
  - 如果一个 step 混合多个独立结果，必须拆分。
  - 如果多个 step 只是同一结果的执行动作，必须合并。
- **Validator 约束**：
  - Validator 不应强制 `3-5` step。
  - Validator 必须要求至少一个 step。
  - Validator 应继续拒绝缺少 `Result`、`Verification`、合法依赖或追踪字段的计划。
  - Validator 应通过测试或 fixtures 覆盖单 step、多 step、动作型 step 和混合结果 step。
- **文档约束**：
  - `IMMUNE.md`、`skills/imm-planner/SKILL.md`、计划模板和相关需求文档必须使用同一套粒度定义。
  - 文档应明确说明 step 是 outcome unit，不是 execution action。

## 3. 验收标准
- [ ] 治理文档和 planner skill 不再声明固定 step 数量。
- [ ] 计划模板说明 step 数量取决于可独立闭合结果。
- [ ] Validator 接受 1 个可闭合结果的计划。
- [ ] Validator 仍拒绝 0 个 step 的计划。
- [ ] Validator 或测试材料能拦截动作型 step。
- [ ] 旧的 `3-5` 表述在当前 workflow 文档中被替换或解释为历史背景。

## 4. 依赖项
- 来自用户在 2026-05-07 的决策：不设定具体步骤数量，而是根据可独立闭合结果进行规划。
- 依赖现有 `docs/brainstorms/immune-brain-requirements.md` 和 `.imm/specs/plan-work-review-rewrite.spec.md` 中对“小步执行”的整体方向。
