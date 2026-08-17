# Pattern: Outcome-based Planning Steps

**领域**: Agent workflow / Planning granularity
**描述**: 计划 step 应由可独立闭合结果决定，而不是由固定数量或执行动作决定。

## 场景

- Planner 为了满足固定 step 数量，把任务拆成 `read / edit / run / document` 这类动作清单。
- Review 节奏因为过细的动作型 step 变得冗余，用户需要不断确认没有真实闭合价值的小动作。
- 任务可以拆成多个结果，但每个结果都必须能单独进入 `work -> review` 并形成 `pass / rework / replan` 判断。

## 方案模板

1. **删除固定数量目标**: 不要求计划必须有某个具体 step 数量；至少一个 step 即可。
2. **按结果建 step**: 每个 step 描述完成后的状态，例如“validator rejects action-shaped steps”，而不是“read file”或“run command”。
3. **双层粒度**: 一个 step 是一个 **成果单元（outcome unit）**；步内允许多次提交与多文件改动，只要 **Verification** 仍闭合该单一 outcome；framing 稳定时可偏好 **更少 outcome 步骤** 覆盖同一 Epic，而不是把「窄范围」偷换成动作级微步骤（与 `skills/imm-planner/SKILL.md`、`IMMUNE.md` 对齐）。
4. **拆混合结果**: 如果一个 step 需要多个独立结果一起完成才有价值，继续拆分。
5. **合并动作清单**: 如果多个 step 只是读取、编辑、运行命令或记录同一结果的动作，合并回对应结果。
6. **在 validator 中保留下限**: Validator 至少拒绝空计划，并保留 placeholder、依赖、traceability 等结构检查。
7. **拦截明显动作型结果**: 对 `read / inspect / review / edit / modify / run / execute` 这类开头的 `Result` 给出失败，避免动作被误当成 outcome。
8. **Result 字面约束**: `Result` 行避免出现校验器认定的多结果分隔符（见 `docs/solutions/iteration-plan-result-markers-and-repo-hygiene.md`）。

## 可复用前提

- 工作流使用 plan -> work -> review 的小步闭环。
- 每个 step 都有明确 `Result` 和 `Verification` 字段。
- Review 需要判断当前 step 是否闭合，而不是只确认某个动作是否发生。
- 计划文件是长期工件，历史计划可以保留，不需要迁移。

## 验证依据

- `IMMUNE.md`、`.imm/specs/plan-work-review-rewrite.spec.md` 和 `docs/brainstorms/immune-brain-requirements.md` 已移除固定 `3-5` step 约束。
- `skills/imm-planner/SKILL.md` 和 `.imm/templates/iteration-plan-template.md` 已声明 step 数量由 independently closable outcomes 决定，并拒绝 execution-action micro steps。
- `.imm/imm-plan.py` 现在接受合法单 step plan，拒绝零 step plan，并保留 placeholder 与 dependency 检查。
- Validator fixture 验证显示 `Read IMMUNE.md` 与 `Run pytest` 会被拒绝，而 `Validator rejects action-shaped steps` 会通过。
- `python3 .imm/imm-work.py status` 显示 `docs/plans/2026-05-07-002-refactor-outcome-step-planning-plan.md` 的 Step 1-4 全部 pass。

## 约束与建议

- 动作型 denylist 应保持小而明确；不要把 validator 变成语义分类器。
- 不要为了减少 step 数量而合并不同可闭合结果。
- 不要为了增加 step 数量而拆出读文件、改文件、跑命令等执行动作。
- 如果一个 step 是否为 outcome 需要争论，优先回到 planner 明确 `Result` 和 `Verification`。

---
*沉淀日期: 2026-05-07 | 来源: outcome-based step planning 全步骤验收*  
*更新: 2026-05-10 — 双层粒度与 Result 字面约束交叉引用*
