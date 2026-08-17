# Pattern: State Ledger Heal and Migration Safety

**领域**: Agent workflow / per-step runtime state (State Ledger, schema v2)  
**描述**: 当 `current_iteration.json` 从 v1 迁到 v2、或由 `heal_current_iteration` 与 `force` 激活改写 ledger 时，必须把「已完成步骤」当作不可变事实、把「可迁移」与「空壳 v1」区分开，并为破坏性操作留下可审计历史。否则自愈会在计划恢复或依赖编号漂移时静默抹掉已闭合步骤的证据。

**reusability**: high  
**next_reuse_scenarios**: [扩展 `heal_current_iteration` 或新增 ledger 字段, 调整 `load_current_iteration_state` 的迁移门槛, 在 `imm-work` / `imm-plan` 中增加会改写 `steps` 的逻辑, 为并行多 active 做后续演进]

## 场景

- v2 自愈在 `recovered_different_plan` 或「依赖未满足」分支里把步骤重置为 `pending` 并删除 `execution_evidence` / `closed_at`。
- 某步在 ledger 中已是 `closed`，但依赖集合或计划恢复导致 `missing_dependencies` 非空；若不加区分，会把已验收的闭合步骤重新打开。
- v1 状态里 `validated_plan_snapshot` 没有 `steps` 列表，但磁盘上仍有可解析的 `plan_path`；迁移门槛若只看 snapshot，会永久卡在 v1，与已实现的可从磁盘补全 `plan_steps` 的迁移函数不一致。
- 全新 v1 种子（仅有 `plan_path`、无 `completed_steps` / `active_step`）若仅凭「磁盘有计划」就迁移，会把测试与工具链里「读回 v1 形状」的假设打破；迁移门槛需同时要求「已有可迁移数据」。
- `force` 激活会丢弃另一活跃步骤上的证据；若无 history，事后无法解释状态为何回退。
- heal 从 `legacy_completed_steps` 创建幽灵 closed 条目时，条目被标记为 `"state": "closed"` 但没有任何 `execution_evidence`、`closed_at` 或来源标记，导致被恢复的闭合步骤与经过完整 execution→QA 流程的步骤无法区分。

## 方案模板

1. **自愈重置永远不要触碰 `closed`**: 在 v2 heal 的「依赖未满足 / 计划恢复」分支里，仅对非 `closed` 的 entry 执行 `pending` 与证据清理。
2. **迁移入口与迁移函数能力对齐**: `migrate_v1_to_v2` 若能在 snapshot 缺 `steps` 时用 `load_normalized_plan(plan_path)` 补全，则 `load_current_iteration_state` 的 `can_migrate_v1` 应在「有 completed/active」且磁盘计划可解析时允许迁移；空壳 v1 不迁，避免无意义 schema 翻转。
3. **破坏性替换写历史**: `v2_force_activate_step` 在将其他 active 步骤打回 `pending` 并 `pop` 证据前，追加 `force_deactivate_step`（或等价 action）的 `history` 记录，标明 step 与 `evidence_discarded`。
4. **读路径分层**: `derive_active_step` / `derive_completed_steps` 适合路由决策（"是否有活跃步骤？"是二元问题），但展示层必须直接读取 `state["steps"][key]["state"]` 的权威账本状态。derive API 会将 `replanning` 折叠为不可见、将 `ready_for_review` 和 `rework_needed` 折叠为 `active`——路由层可以容忍此丢失，展示层不能。
5. **幽灵闭合步骤标记时间戳**: heal 从 `legacy_completed_steps` 创建 `"state": "closed"` 条目时，必须附加 `healed_at` 时间戳，以区分被恢复的闭合与经过完整 execution→QA 流程的闭合。缺少此标记的 closed 条目无法在审计中证明其来源。
6. **用定向 unittest 锁住回归**: 计划恢复下 closed 不变、依赖漂移下 closed 不变、无 snapshot 但有数据时可迁、force 有 history；derive 在 v1/v2 上各至少一条 smoke；幽灵 closed 条目含 `healed_at`。

## 可复用前提

- 运行态已采用或即将采用 per-step `steps` map，且 `closed` 表示 QA 已通过的完成事实。
- 仍存在 v1 文件或测试种子，需要可控的一次性迁移而非全仓库强制 v2。
- `history` 数组为操作审计的可接受载体（不要求单独 audit 表）。

## 验证依据

- `.imm/current_iteration_state.py`: v2 heal 分支对 `closed` 跳过 reset；`migrate_v1_to_v2` 在 snapshot 无 steps 时用磁盘计划；`v2_force_activate_step` 追加 `force_deactivate_step` history；`load_current_iteration_state` 在 snapshot 无 steps 时以 `has_migratable_data` 门控磁盘迁移。
- `.imm/imm-work.py`: `continue_current_step` 与 `show_status` 注入 derived `active_step` / `completed_steps`；多处改为直接调用 `derive_*`。
- `tests/test_state_ledger.py`: `TestHealPreservesClosedSteps`, `TestMigrationWithoutSnapshot`, `TestForceActivateHistory`, `TestDeriveWithoutIsV2Guard`。
- `.imm/imm_core/heal.py`: 幽灵 closed 条目附加 `healed_at`（2026-05-26 修复）。
- `tests/test_imm_work.py`, `tests/test_imm_plan.py`: 与 v2 持久化及 history 顺序相关的断言已改为 derive API 或按 action 名查找。

## 约束与建议

- **原子写 JSON**（崩溃中途截断文件）在本轮明确列为后续 `new_slice`；本模式不替代 temp-file + `os.replace` 类加固。
- 若未来允许 ledger 中多条 active，需重新定义「force」语义与 history 粒度，避免沿用单 active 假设。

## ADR 建议

本轮未引入需单独 ADR 的新架构分叉；若后续落地「原子写运行态文件」，再评估是否满足硬反转成本、读者惊讶度与真实权衡三条后再写 `docs/adr/`。
