> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Workflow Health Gate Alignment

**领域**: Agent workflow / health checks / regression maintenance
**描述**: 当 workflow 的健康门禁升级后，必须同时对齐约束清单和回归
fixture，让 health check、测试和 runtime gate 共享同一份真实契约，而不是只修
其中一侧。

## 场景

- `imm-heal` 这类健康检查依赖显式约束列表，仓库新增 skill 或工件后容易漂移。
- `imm-review` 这类 runtime gate 收紧后，旧测试仍按过时 fixture 直接通过。
- 系统已经有 focused tests，但用户看到的失败其实来自“测试没跟着契约升级”。

## 方案模板

1. **先确定 source of truth**: 明确当前真正生效的 gate 在哪里。
   对 skill inventory，是当前 `skills/*/SKILL.md` 集合；对 QA pass 语义，是
   `imm-review.py` 的 `ready_for_review + execution_evidence (+ artifacts)` 契约。
2. **只补当前漂移面**: 先修漏掉的约束项或旧 fixture，不顺手扩成 registry、
   全量测试清理或状态机重写。
3. **用两层回归证明闭环**:
   - 一个 focused regression 直接打中本次漂移点；
   - 一个稍宽的模块回归确认没有因为修 fixture 破坏原有路径。
4. **把 closure 证据写回同一条 workflow**: 通过 `imm-work record-execution`
   和 `imm-review pass` 固化证据，避免“测试通过但 workflow 状态没闭合”。

## 可复用前提

- 系统存在显式 health check 或 gate，而不是完全隐式的人肉约定。
- 漂移点可收敛到少量 source files 和 focused tests。
- 本轮目标是让现有门禁重新一致，而不是设计下一代发现机制。

## 验证依据

- `.imm/imm-heal.py`
  原先漏掉 `imm-autowork` 与 `imm-party`，导致
  `test_heal_required_skills_match_repo_skills` 失败；补齐后 focused test 与
  `python3 .imm/imm-heal.py` 都恢复通过。
- `tests/test_workflow_loop.py`
  原先直接调用 `apply_review("pass", ...)`，与
  `.imm/imm-review.py`
  当前 `ready_for_review` gate 不一致；在 fixture 里先记录 execution evidence
  后，`python3 -m unittest tests.test_workflow_loop` 通过。
- `docs/plans/2026-05-07-014-fix-workflow-health-gate-plan.md` 的三个 step 全部通过
  `imm-review pass` 闭合，说明修复不只是测试绿，而是 workflow 绿。

## 约束与建议

- 不要把“约束清单漂移”默认升级成动态发现系统；先确认静态清单是否仍是最低成本。
- 不要为了配合旧测试去放松 runtime gate；优先让 fixture 追上真实契约。
- 若宽测试仍有无关旧失败，必须在 QA evidence 中明确边界，避免把本轮 closure
  和历史债务混在一起。

---
*沉淀日期: 2026-05-07 | 来源: workflow health gate repair 全步骤验收*
