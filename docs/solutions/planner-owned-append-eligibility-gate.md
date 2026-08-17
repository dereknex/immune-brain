> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Planner-Owned Append Eligibility Gate

**领域**: Agent workflow / review follow-up routing
**描述**: 当 review follow-up 既可能继续留在同一目标边界、又可能命中 completed-plan append 时，不要让 reviewer 直接宣布 `append_to_plan`。reviewer 只保留 same-boundary follow-up candidate，真正的 append legality 必须由 planner / planning validation 根据 runtime state、verification surface 与 closure proof 统一裁决。

**reusability**: high
**next_reuse_scenarios**: [`reviewer` 已能输出 bounded follow-up 但 runtime legality 仍依赖 planner truth, 某条 workflow 同时存在 user-facing route 与 planner-only internal disposition, same-path plan 变更会失效旧 closure proof 但团队仍想保留窄 append 能力]

## 场景

- reviewer 能稳定识别“这还是同一 repair boundary”。
- 但是否真的可以 `append_to_plan`，还取决于 current runtime plan、completion history、verification surface、以及 plan sync 后旧 closure 是否仍有效。
- 如果 reviewer 过早把 `append_to_plan` 暴露成用户路由，后续很容易出现 authority drift：
  - reviewer 在替 planner 做 runtime legality 判断
  - 文档把内部 disposition 写成顶层 route
  - 用户以为 append 是可直接继续的入口，而不是 planner 内部裁决

## 方案模板

1. **分开 user-facing route 和 planner-only disposition**: 用户可见层只说 same-boundary follow-up candidate / `new_slice`；`append_to_plan` 只保留为 planner-owned internal disposition。
2. **reviewer 只交接证据，不交接 legality**: reviewer handoff 只保留 repair boundary、success target、verification hint、是否仍指向原 goal 等线索，不直接宣布 append 成立。
3. **planner 统一跑 append gate**: 只在 current runtime plan 仍匹配、verification surface 未变化、旧 closure 不需改写、历史状态未失效时才允许 append。
4. **证据不够就默认回 `new_slice`**: append 不是乐观路径。只要 runtime proof、completion history 或 sync 语义不够稳，就必须退回新的 narrow slice。
5. **把 route-layer drift 前移到 planning / contract tests**: 用 focused regression 检查 reviewer skill、planner skill、README、spec 是否把 `append_to_plan` 错写成用户路由。
6. **把 runtime reset 约束写成 gate 条件**: 如果 same-path signature change 会清空 `completed_steps`，就把它视为 append proof 失效，而不是让 reviewer 或用户猜“应该还能 append”。

## 可复用前提

- 系统已经有 review handoff、planner、runtime state 和 completed-plan append 这些相邻能力。
- append 是窄能力，不是默认后续入口。
- runtime state 里有 `plan_path`、signature、completed closure 等会影响 legality 的事实源。
- 团队愿意接受“reviewer 少做一步决定，planner 多做一步 gate”来换取契约稳定。

## 验证依据

- [skills/imm-code-review/SKILL.md](skills/imm-code-review/SKILL.md) 现在把 `direct_fix` 降为 same-boundary follow-up candidate，不再把 `append_to_plan` 暴露成 `recommended_route`。
- [skills/imm-ui-review/SKILL.md](skills/imm-ui-review/SKILL.md) 同样改为 reviewer 只保留 same-boundary guidance，由 planner 再决定是否 append。
- [skills/imm-planner/SKILL.md](skills/imm-planner/SKILL.md) 现在明确：append legality 必须同时满足 current runtime plan、verification surface 和 closure fact 条件；证据不够时回 `new_slice`。
- [.imm/specs/review-followup-handoff.spec.md](docs/specs/review-followup-handoff.spec.md) 与 [.imm/specs/review-task-handling-workflow.spec.md](docs/specs/review-task-handling-workflow.spec.md) 现在把 reviewer 侧 truth 与 planner-owned append 层级写成统一 contract。
- [.imm/specs/completed-plan-followup-append.spec.md](docs/specs/completed-plan-followup-append.spec.md) 明确把 append proof 不足时的默认路径收回到 `new_slice`。
- `.imm/imm-plan.py` 现在把 same-path signature change 标注为 append closure proof 失效信号。
- `tests/test_imm_plan.py` 的 `test_sync_same_path_signature_change_resets_closure_and_append_proof` 通过。
- `tests/test_skill_contracts.py` 的 focused route-layer / append contract tests 通过，能抓住 reviewer 把 `append_to_plan` 重新暴露成用户路由的 drift。

## 约束与建议

- 不要把“reviewer 不再输出 `append_to_plan`”误解成 append 能力被删除；真正变化的是 authority owner。
- 不要在 README、skill、spec 里同时保留两套说法，否则 reviewer 很快又会漂回 planner-owned route。
- 如果未来要重新开放 reviewer 直接输出 append，必须先证明 runtime legality 不再依赖 planner 专属事实源。
- 如果 runtime 想保留 same-path 变更后的旧 closure，先单独规划 closure-proof persistence，不要顺手把 reviewer authority 也扩张进去。

---
*沉淀日期: 2026-05-10 | 来源: 2026-05-10-045-fix-review-followup-authority-gate-plan*
