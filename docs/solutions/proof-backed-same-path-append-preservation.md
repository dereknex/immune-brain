> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Proof-Backed Same-Path Append Preservation

**领域**: Agent workflow / runtime closure proof
**描述**: 当系统想在 same-path `plan_signature` 变化后保留旧 `completed_steps` 时，不要直接拿当前磁盘上的“新 plan”猜 closure 兼容性。先在 validation 成功时持久化一份最小 validated plan proof snapshot，之后只有 snapshot 能证明旧 completed prefix 未变时，才允许 append-safe preservation。

**reusability**: high
**next_reuse_scenarios**: [`same-path` plan 变更后想保留部分 closure, runtime 只有新 plan 文件但需要判断旧 step prefix 是否仍成立, 团队想放宽 reset-by-default 同时保持 proof-based safety, planner append contract 依赖旧 validated shape 而不是当前磁盘状态]

## 场景

- `imm-plan` 是 plan-level runtime state 的唯一 writer。
- 系统已经有 reset-by-default 的 same-path invalidation 基线。
- 业务又希望支持更窄的例外：如果旧 completed prefix 完全没变，只是尾部追加 step，就继续沿用旧 closure。
- 但 same-path planner edit 之后，磁盘上通常只剩“新 plan”，旧 validated prefix 会直接消失。

## 问题信号

如果没有独立的旧 proof source，所谓 append-safe preservation 很容易退化成猜测：

1. runtime 只知道新 `plan_signature`，却不知道旧 validated prefix 长什么样。
2. 系统会把“同一路径”误当成“同一 closure 事实”，从而乐观保留旧 `completed_steps`。
3. 一旦旧 step 的 `result`、`verification`、`depends_on` 或 `step_id` 已被改写，过期 closure 就会穿透到新 plan。
4. 反过来，如果一律 reset，又会让已设计好的 completed-plan append contract 永远无法落地。

## 方案模板

1. **先保留 proof，再谈 preserve**: 在 validation 成功时，把当前 validated plan 的最小 closure-relevant snapshot 一起写进 runtime state。
2. **snapshot 只保留最小字段**: 首版只保留 `plan_path`、`plan_signature`，以及每个 step 的 `number`、`step_id`、`result`、`verification`、`depends_on`。不要顺手扩成完整 plan archive。
3. **append-safe gate 必须依赖 snapshot**: 只有当 stored snapshot 与新 normalized plan 的 completed prefix 完全一致，且变更只是尾部追加时，才允许 preserve `completed_steps`。
4. **证明不了就 reset**: snapshot 缺失、损坏、路径不对、prefix 不连续、prefix mismatch、或新 plan 没有真实追加 step 时，一律回退到 reset-by-default。
5. **active execution 仍清空**: 即使 proof-backed preserve 命中，也只保留 `completed_steps` 与仍然对齐的 `last_review`；`active_step` 仍然 reset，避免复用旧执行现场。
6. **把 regression 分成两层**: 一层锁 sync/snapshot 语义，一层锁 end-to-end continuation truth，确保不是只有 unit compare 对，真正的 `imm-work` 下一步也会继续到 appended step。

## 可复用前提

- workflow 已经把 plan-level sync 与 step-level execution 分开。
- same-path 变更默认仍应视为高风险，需要显式 proof 才能豁免 reset。
- completed closure 的真值可由少量字段决定，不需要完整保留 planner prose。
- 团队接受“旧状态没有 snapshot 时继续 reset”，而不是要求历史回填或自动迁移。

## 验证依据

- [append-safe-proof-snapshot.spec.md](docs/specs/archive/append-safe-proof-snapshot.spec.md) 明确要求 `validated_plan_snapshot` 作为 append-safe proof source，并规定缺 proof 时 degrade-to-reset。
- `imm-plan.py` 现在会在 sync 成功时写入 `validated_plan_snapshot`，并在 same-path signature change 时只在 snapshot 证明 completed prefix 未变时记录 `sync_plan_preserve_completed_steps`。
- `current_iteration_state.py` 现在把 `validated_plan_snapshot` 纳入 canonical runtime state。
- `test_imm_plan.py` 覆盖 snapshot 写入、proof-backed preserve、以及 proof 不足时 reset 的路径。
- `test_imm_work.py` 覆盖 same-path append flow 在 snapshot-backed proof 下继续到 appended step，而不是回到 `done` 或 Step 1。
- 当前 workspace runtime 在重新 sync [2026-05-10-048-fix-append-safe-proof-snapshot-plan.md](docs/plans/2026-05-10-048-fix-append-safe-proof-snapshot-plan.md) 后，已真实写入 `validated_plan_snapshot`。

## 约束与建议

- 不要把 snapshot 做成第二套 state store；它只是当前 validated plan 的最小 proof cache。
- 不要在没有 snapshot 的旧状态上乐观 preserve；这会让“proof-based gate”退化回“路径同名猜兼容”。
- 如果未来想支持修改旧 prefix 后仍保留 closure，那已经不是 append-safe preserve，而是 step-level closure migration，应另起新 slice。
- 如果 reviewer / planner contract 还没分清 `append_to_plan` 的 authority owner，先修 authority，再修 proof persistence；不要把两类问题混在一个 runtime patch 里。

---
*沉淀日期: 2026-05-10 | 来源: 2026-05-10-048-fix-append-safe-proof-snapshot-plan*
