> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Review Follow-up Handoff Contract

**领域**: Agent workflow / review-to-repair routing / skill contracts
**描述**: 当 review 已经能判断“当前边界可修”还是“需要新切片”时，不要让后续轮次再手工把 findings 翻译成计划输入。更稳的做法是让 reviewer 输出一个 bounded `follow_up` handoff：保留最小修复边界、成功目标和验证提示，再由 `imm-planner` 把它收敛成 validated one-step / small-step plan。

- `reusability: high`
- `next_reuse_scenarios: ["为其他 reviewer skill 增加 follow-up handoff", "把 advisory/review 输出统一成 planner-ready contract", "压缩 review 后的小修复路径", "给 focused contract tests 增加新的 review-routing 守卫"]`

## 场景

- review 已能区分“当前 repair boundary 内可修”与“需要 follow-up plan”，但用户仍要手工把 finding 改写成 planner 输入。
- 小型 `need fix` 逻辑上应该走 one-step plan fast path，却因为缺少统一 handoff 而反复重述 scope、success target、verification。
- `imm-code-review`、`imm-ui-review` 等 reviewer skill 开始出现平行但不完全一致的 repair routing 说法。
- 想保持 `review -> planner -> work -> qa` authority boundary，不把 review 变成自动修复器或自动建计划器。

## 方案模板

1. **先把 review judgment 结构化成 handoff**: reviewer 除了 findings，还要输出一个聚合级 `follow_up` packet，至少包含 `origin_review`、`recommended_route`、`success_target`、`verification_hint` 和分 finding 的最小 repair boundary。
2. **把 repairability route 收窄成有限枚举**: 首版只用 `direct_fix`、`new_slice`、`defer`。避免 reviewer 自己发明更多半语义标签。
3. **让 planner 明确消费 handoff，而不是重建它**: `imm-planner` 要把 `origin_review`、route judgment、scope hint、verification hint 映射进 `Summary / Origin / Research / Decisions / Assumptions`，并保留 validated plan 要求。
4. **保留小修复快路径，但不绕过 plan**: `direct_fix` 应该进入 one-step 或 tight multi-step plan，而不是从 review 直接跳到执行。
5. **README 讲用户视角，tests 守 contract 视角**: README 只解释 review 之后怎么进 planner/work；`tests/test_skill_contracts.py` 负责机械守住 reviewer、planner 和 README 的对齐。

## 可复用前提

- review skill 已经具备稳定的 findings 结构，不再只是散文式建议。
- 系统仍坚持 planner/work/qa 的 authority boundary，不允许 review 直接执行代码。
- 当前目标是降低 review-follow-up friction，而不是实现自动计划生成、后台 repair queue 或新的 workflow state。
- 仓库已有 focused contract test 入口，能用静态文本检查守住 skill contract。

## 验证依据

- [.imm/specs/review-followup-handoff.spec.md](docs/specs/review-followup-handoff.spec.md)
  定义了 `direct_fix` / `new_slice` / `defer` 路由、required `follow_up` fields、planner ingestion 规则和 non-goals。
- [skills/imm-code-review/SKILL.md](skills/imm-code-review/SKILL.md)
  现在要求 review 在 `needs_fix` / `block` 时输出 planner-ready `follow_up` packet，并显式说明当前边界可修还是需要新 follow-up slice。
- [skills/imm-ui-review/SKILL.md](skills/imm-ui-review/SKILL.md)
  已对齐同一套 `follow_up` handoff 语义，不再只留模糊的 `fix_now` / `replan` 路由。
- [skills/imm-planner/SKILL.md](skills/imm-planner/SKILL.md)
  现在明确把 review-origin handoff 映射进 `Origin / Research / Decisions / Assumptions`，并保留 validated one-step plan fast path。
- [README.md](README.md)
  已补齐用户视角的 review-to-follow-up route：review 先产出 bounded handoff，planner 收敛成 validated small plan，执行再进入 `imm-work` / `imm-executor`。
- `tests/test_skill_contracts.py`
  新增 focused assertions 绑定 reviewer / planner / README 的 shared handoff contract。
- `python3 -m unittest tests.test_skill_contracts`
  在本轮闭环后通过，共 `39` 个 tests。

## 约束与建议

- 不要把 `direct_fix` 理解为“review 可以直接修”；它只表示后续可以收敛成一个小而已验证的 plan。
- 不要把 `new_slice` 说成泛泛的 “replan”；要保留触发新切片的结构性原因，否则同主题 follow-up 会继续反复重述。
- 如果 reviewer 还没有稳定 findings schema，先补 findings contract，再补 `follow_up` packet；不要两层都半成品。
- README 适合解释路由，不适合承载完整 packet schema；schema 应该留在 reviewer/planner skill 和 focused tests 中。

---
*沉淀日期: 2026-05-09 | 来源: review follow-up handoff plan U1-U6 全步骤验收*
