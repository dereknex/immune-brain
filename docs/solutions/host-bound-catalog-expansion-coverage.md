# Pattern: Host-bound Catalog Expansion Needs Per-child Trigger Proof

**领域**: Agent workflow / subagent activation / regression coverage
**描述**: 当已有 deterministic activation catalog 要扩展到第二个 host 时，不要只证明“某个 broad path 会触发所有新 children”。每个 child reviewer 都需要一条 standalone trigger proof，覆盖它自己的 keyword/path surface、`rationale_code`、candidate ordering，以及 host-bound 输出。

**reusability**: high
**next_reuse_scenarios**: [`给 imm-party 或其他 host 接入 subagent-trigger-catalog.yaml`, `给已存在 host 增加第二组 children`, `policy 文档列出 per-child golden tests 但实现只做了 broad multi-trigger smoke test`, `code review finding 适合同一 completed plan 的 append-safe follow-up`]

## 场景

- `docs/reference/subagent-trigger-catalog.yaml` 已有一个 host（例如 `imm-code-review`），新计划要接入另一个 host（例如 `imm-ui-review`）。
- `.imm/activation_plan.py` 已经输出 host-bound `candidates`、`rationale_codes`、`model_tiers` 和 solo fallback reason。
- Policy 文档声明每个 child reviewer 都应有 golden trigger coverage。
- 初版测试容易只覆盖一个 component path 同时触发所有 UI reviewers，导致某个 child 的独立 keyword 或 rationale code 漂移时测试仍然通过。

## 方案模板

1. **Catalog 仍按 host 分层**: 在 YAML 中新增 host block；不要把新 children 混进旧 host 的顺序表，也不要引入共享 registry。
2. **Parser 接收 host 参数**: `load_trigger_catalog(..., host=...)` 只读取目标 host 的 children；`build_activation_plan(..., host=...)` 使用 host-specific child order。
3. **Policy 同步 host 和 child 列表**: `automatic-subagent-activation-policy.md` 同时更新输入 schema、输出 schema、host behavior、verification cases。
4. **Remaining-work 消账**: `subagent-remaining-work.md` 把对应 catalog 接线从“未开始”改成“已完成”，避免后续 planner 重复规划。
5. **测试分两层**: 保留 broad multi-trigger / CLI smoke test，但每个 child 另加 standalone trigger test，断言 exact candidate 和 exact `rationale_code`。
6. **Review follow-up 可同 plan append**: 如果 code review 发现的缺口属于同一目标、旧 completed prefix 未改、runtime 有 validated snapshot proof，则 planner 追加一个尾部 step，而不是开新 slice 或改写旧 closure。

## 可复用前提

- activation catalog 的核心仍是 deterministic、host-bound、advisory-only。
- 每个 child reviewer 有稳定的 trigger surface 和 rationale code。
- `imm-plan` 已能用 validated plan snapshot 证明 same-path append 不会污染旧 closed steps。

## 验证依据

- `docs/plans/2026-05-14-081-feat-imm-ui-review-catalog-wiring-plan.md` U1-U5 全部 QA pass。
- `docs/reference/subagent-trigger-catalog.yaml` 新增 `imm-ui-review` host，children 为 `a11y-reviewer`、`responsive-reviewer`、`visual-reviewer`。
- `.imm/activation_plan.py` 支持 host-specific child order 和 host-filtered catalog parsing。
- `tests/test_activation_plan.py` 从 30 条扩展到 32 条，新增 standalone `responsive-reviewer` 和 `visual-reviewer` keyword trigger assertions。
- `rtk python3 -m unittest tests.test_activation_plan` 通过，32 tests OK。
- same-path append 由 `.imm/memory/current_iteration.json` 记录 `sync_plan_preserve_completed_steps`，保留 U1-U4 closure 后追加 U5。

## 约束与建议

- 不要把 broad path multi-trigger test 当作 per-child proof；它无法证明每个 child 的 keyword 和 rationale code 独立有效。
- 不要让新的 host 扩展改变旧 host 的默认输出；旧 host 的 golden tests 应继续覆盖 no-trigger fallback 和原有 child ordering。
- 如果 review finding 需要改旧 step result/verification，不能 append-safe；必须回到 planner 重新切片。
- 如果新 host 的 dispatch protocol 尚不存在，应先完成 host protocol slice，再接 catalog。

---
*沉淀日期: 2026-05-14 | 来源: 2026-05-14-081-feat-imm-ui-review-catalog-wiring-plan + imm-code-review follow-up U5*
