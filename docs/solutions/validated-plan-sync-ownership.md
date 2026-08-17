# Pattern: Validated Plan Sync Ownership

**领域**: Agent workflow / plan runtime
**描述**: 只允许经过成功验证且显式带 `--sync` 的 `imm-plan` 写入 plan-level runtime state；默认 `imm-plan` / `--json` 是只读验证。执行入口只能在已同步的当前 plan 内推进 step，同一路径 plan 内容变更必须按 proof-field 兼容规则决定保留或失效旧 closure。

## 场景

- runtime state 同时保存 `plan_path`、`plan_summary`、`plan_signature`、`completed_steps` 和 `active_step`。
- `imm-plan` 负责 plan 解析和验证；只有显式 `--sync` 才负责 runtime sync。
- `imm-work activate` 负责激活某个 step，但不应该承担 plan 切换或 plan 元数据写入。
- 同一份 plan 文件可能在路径不变的前提下更新 step 内容、依赖或验证条件。

## 问题信号

如果 plan-level runtime state 可以被多个入口写入，会出现三类漂移：

1. 默认验证命令写入 State Ledger，导致 review 历史 Plan 时悄悄切换当前 runtime plan。
2. `imm-plan --sync` 失败却仍返回成功，调用方会把“验证通过”误认为“runtime 已同步”。
3. 同一路径 plan 内容变更后无条件沿用旧 `completed_steps` / `active_step`，让过期 closure 穿透到新 plan 内容。
4. `imm-work activate` 直接切 plan 或重写 `plan_path` / `plan_summary`，绕过 `imm-plan --sync` 的验证与同步真源。

## 方案模板

1. **默认只读验证**: `imm-plan <plan> --json` 只输出 normalized validation result，不写 State Ledger。
2. **单一显式 writer**: plan-level runtime state 只能由 `imm-plan <plan> --sync` 在验证成功后写入。
3. **sync 失败硬失败**: runtime sync 一旦失败，带 `--sync` 的命令必须返回非零，不能 warning 后继续成功返回。
4. **same-path proof-field compatibility**: 如果 `plan_path` 相同但 `plan_signature` 变化，只在 completed prefix 的 proof fields 与旧 snapshot 一致时保留 closed steps；删 Step 或修改 completed proof fields 必须重置。
5. **执行入口拒绝越权**: `imm-work activate` 仅接受“已由 `imm-plan --sync` 同步过的当前 plan”；如果目标 plan 未同步或与当前 synced plan 不一致，直接拒绝。
6. **测试覆盖 contract，而不只覆盖 happy path**: 除了验证成功路径，还要覆盖 validate-only 不写 state、sync 异常、same-path metadata-only preservation，以及未同步 plan 的 activate 拒绝路径。

## 可复用前提

- plan validation 与 step execution 是两个独立入口。
- runtime state 里同时存在 plan 元数据和 step-level closure。
- step 编号只在当前 plan signature 下有意义，不能假设同一路径就代表同一份可复用 closure。

## 验证依据

- `.imm/imm-plan.py` 和 `.imm/imm_core/plan_runtime.py` 改为默认只验证；只有 `--sync` 才调用 runtime sync。
- `.imm/imm-plan.py` 在带 `--sync` 且 runtime sync 失败时直接返回非零，而不是仅打印 warning。
- `.imm/imm_core/plan_runtime.py` 在 same-path `plan_signature` 变化时，只有 proof-field 兼容的 append 或 metadata-only 更新会保留 closed steps；否则重置 closure。
- `.imm/imm-work.py` 改为拒绝未先经过 `imm-plan --sync` 的 plan activate，不再切换 `plan_path` 或承担 plan-level state 写入。
- `plugins/immune-brain/dist/.imm/` runtime 副本通过 package parity test 与 repo runtime 保持一致。
- `plugins/immune-brain/dist/imm-planner.md` 在 execution handoff 前明确要求 `imm-plan <plan-path> --sync`。
- `tests/test_imm_plan.py::test_main_outputs_normalized_json`
- `tests/test_imm_plan.py::test_main_sync_flag_updates_runtime_state`
- `tests/test_imm_plan.py::test_main_json_validation_does_not_mutate_historical_state`
- `tests/test_imm_plan.py::test_main_returns_nonzero_when_runtime_sync_fails`
- `tests/test_imm_plan.py::test_sync_same_path_signature_change_resets_closure`
- `tests/test_imm_plan.py::test_sync_same_path_metadata_only_change_preserves_closed_steps`
- `tests/test_imm_work.py::test_activate_step_rejects_when_no_synced_plan_exists`
- `tests/test_imm_work.py::test_activate_step_rejects_unsynced_target_plan`
- `tests/test_imm_work.py::test_activate_step_rejects_switching_to_unsynced_new_plan`
- `tests/test_immune_brain_plugin_package.py::test_packaged_runtime_matches_repo_runtime_sources`
- `tests/test_immune_brain_plugin_package.py::test_planner_handoff_mentions_explicit_runtime_sync`

## 复用标签

- `reusability: high`
- `next_reuse_scenarios: ["任何把 plan 校验与 step 执行拆成两个入口的 workflow", "任何需要 review 历史 Plan 但不能改当前 runtime state 的 agent runtime", "任何需要持久化 plan signature 与 completed closure 的 agent runtime", "任何要防止 executor 越权切换 plan 或补写 plan 元数据的 orchestration 设计"]`

## 约束与建议

- 默认 validation 已经是“只校验不落 runtime”；不要再让 `--json` 或其他输出格式隐式写 State Ledger。
- 如果要在 same-path 改动后保留部分 closure，必须先定义基于旧/新 signature 和 proof fields 的兼容规则，而不是默认沿用。
- 不要把 `plan_summary` 这类 plan-level 字段留给 executor 补写；否则系统会重新出现双 writer 漂移。

---
*沉淀日期: 2026-05-10 | 来源: 2026-05-10-035-fix-plan-sync-enforcement-followup-plan*

*更新日期: 2026-05-25 | 来源: validate-only plan command U1 与 package parity repair*
