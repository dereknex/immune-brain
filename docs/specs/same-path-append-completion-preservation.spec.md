> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: same-path append completion preservation

**任务 ID**: IMM-WORKFLOW-012
**负责人**: Planner
**状态**: Accepted（runtime append-safe + snapshot proof 已落地；见 IMM-WORKFLOW-013）

## 1. 目标

修复 `imm-plan` / runtime sync 在 **same-path append-only** 场景下过度失效旧 closure 的问题：

- 当当前 runtime plan 只是被 planner 在同一路径上追加新的 follow-up steps，
  且旧已完成 steps 的闭合事实仍然成立时，保留 `completed_steps`
- `imm-work` 在同步后应直接继续到新追加 step，而不是回到 Step 1
- 仍保留对真正不安全变更的 reset 行为

首版只处理 same-path append-only completed-plan follow-up；**可验证的 proof** 由 companion spec
[append-safe-proof-snapshot.spec.md](append-safe-proof-snapshot.spec.md) 中的最小
`validated_plan_snapshot` 字段承担（非第二套 state 文件、非历史 reopen）。

## 2. 问题背景（历史问题，已修复）

曾存在：`imm-plan` 在 `same_plan = true` 且 `signature_changed = true` 时**一律**清空
`completed_steps`，导致 planner 仅在尾部追加 step 时进度误回到 Step 1。

**现已实现**：

- `.imm/imm-plan.py` 在 append-safe 条件成立且
  **存在可用的 validated plan snapshot** 时可保留 `completed_steps`，并写入 history action
  `sync_plan_preserve_completed_steps`；否则仍 reset（安全基线不变）。
- 缺失 snapshot 的旧 workspace 不因本切片自动回填；首次 sync 起写入 proof，见 IMM-WORKFLOW-013。

仍遵循 [plan-sync-enforcement-followup.spec.md](plan-sync-enforcement-followup.spec.md) 的默认 reset 前提；

- 默认：same-path signature changed => reset
- **豁免**：仅当 runtime 能基于 snapshot **证明**「已完成前缀未改 + 仅尾部追加」时 preserve

## 3. 功能需求

### R1. Add an append-safe preservation gate

- 当 `plan_path` 不变但 `plan_signature` 变化时，runtime 不应一律清空旧 closure。
- 必须先判断这次变更是否属于 append-safe sync。
- append-safe 至少要求：
  - 当前 runtime plan 与新 plan 路径相同
  - 旧 `completed_steps` 仍引用有效 step numbers
  - 旧 `completed_steps` 必须构成从 `1` 开始的连续已闭合前缀，而不是跳号集合
  - 旧已完成 steps 在新 plan 中的 step definition 仍保持相同闭合语义
    - 至少包括 `result`
    - `verification`
    - `depends_on`
  - 新变化只是在尾部追加 1..N 个新 steps，而不是改写旧 steps
  - 当前没有需要保留的 `active_step` 执行现场，或其状态不能被误复用
- 若上述条件成立，允许保留 `completed_steps`。

推荐判定算法：

1. 仅在 `same_plan_path = true` 且 `signature_changed = true` 时进入 append-safe 判断
2. 读取旧 runtime `completed_steps`
3. 校验旧 completed set 是否等于 `[1..max_completed_step]`
4. 逐一比较旧 plan 与新 plan 在这个 completed prefix 上的 normalized step definition
5. 若 prefix 全量相等，且新 plan 长度大于等于旧 prefix 长度，则视为 append-safe
6. 其他情况一律回退到 reset

normalized step definition 首版限定为：

```text
- number
- step_id
- result
- verification
- depends_on
```

不要求比较 `test_scenarios`、`scope`、`replan_condition` 等 planner-only 辅助字段；
首版只守住影响 closure truth 与 `imm-work` 依赖调度的最小字段集合。

推荐判定字段：

```text
- same_path_sync_resolution:
  - same_plan_path: true|false
  - signature_changed: true|false
  - append_safe: true|false
  - append_safe_reason: identical_prefix_steps|none
  - reset_required: true|false
```

### R2. Preserve only what remains proven

- append-safe 场景下，可保留：
  - `completed_steps`
  - `last_review` if it still points to a preserved completed step
- append-safe 场景下，`active_step` 仍应清空，避免复用旧执行中断现场。
- append-safe 场景下，不要求回放旧 review history，也不要求重建旧 execution payload；
  只要求 `completed_steps` 与仍然有效的 `last_review` 不被错误清空。
- 若任一旧 completed step 的闭合语义被改写、删除、重编号或依赖变化，
  则必须 reset `completed_steps`。

`last_review` 保留条件：

- `last_review.step_number` 仍存在于 preserved `completed_steps`
- `last_review.step_id` 与新 plan 同编号 step 的 `step_id` 仍一致
- 若上述任一条件不成立，则只清空 `last_review`，不影响 append-safe 已保留的
  `completed_steps`

### R3. Keep unsafe resets explicit

- 下列情况仍必须 reset completion state：
  - plan path changed
  - step prefix changed
  - completed step definition changed
  - step removed or renumbered
  - append legality cannot be proven
- history 里必须保留显式原因，区分：
  - `Plan switched; reset completion state.`
  - `Plan signature changed; reset completion state.`
  - `Plan signature changed; preserved completed steps for append-safe sync.`

推荐 history 语义：

- reset 仍沿用 `sync_plan_reset_completed_steps`
- append-safe preserve 应新增单独 history action，避免复用 reset 名称
  - 推荐：`sync_plan_preserve_completed_steps`
- 无论 preserve 还是 reset，`sync_plan_from_imm_plan` 仍应记录本次同步后的 plan signature

推荐 preserve history details：

```text
- from_plan
- to_plan
- preserved_steps
- reason
```

### R4. `imm-work` must resume from appended step

- 当 append-safe preservation 命中时，`imm-work status` / `build_next_action()`
  必须把下一步指向新追加的第一个未完成 step，而不是回到旧 plan 的 Step 1。
- 这条要求只针对 same-path append-safe sync；
  不要求在本轮支持更广义的 partial closure recovery。

### R5. Scope stays narrow

- 不新增第二套 state 文件、registry 或 plan 版本库（最小 `validated_plan_snapshot` 字段见
  [append-safe-proof-snapshot.spec.md](append-safe-proof-snapshot.spec.md)）。
- 不处理 `imm-finish` 之后的历史 reopen。
- 不支持对已完成 step 的 closure proof 做内容级迁移。
- 不扩展到跨 plan stitching、多 plan continuation 或 planner append redesign。

## 4. 决策表

| 场景 | `completed_steps` | `active_step` | `last_review` | history |
| --- | --- | --- | --- | --- |
| plan path changed | reset | reset | clear if dangling | `sync_plan_reset_completed_steps` |
| same-path signature changed + append-safe | preserve | reset | preserve only if still aligned | `sync_plan_preserve_completed_steps` |
| same-path signature changed + not append-safe | reset | reset | clear if reset invalidates target step | `sync_plan_reset_completed_steps` |
| same-path signature unchanged | preserve | preserve | preserve | no extra reset/preserve event |

## 5. 验收标准

- [x] same-path append-only sync 不再无条件清空 `completed_steps`（在 snapshot 可证 append-safe 时）
- [x] append-safe 条件不成立时，旧 reset 行为仍保留
- [x] `imm-work` 在 append-safe sync 后继续到新追加 step，而不是回到 Step 1
- [x] focused runtime regression（`tests/test_imm_plan.py`、`tests/test_imm_work.py`）锁住 append-safe 与缺失 snapshot 降级 reset
- [x] 本轮仅引入 IMM-WORKFLOW-013 约定的最小 snapshot 字段，不引入历史 reopen 机制

## 6. 非目标

- 不修复 `046` 的 repo-facing contract wording 本身
- 不重做 completed-plan append 的 planner contract
- 不实现对旧 steps 的 semantic diff migration
- 不把 same-path preservation 扩成通用 history restore 系统

## 7. 依赖项

- 依赖 [completed-plan-followup-append.spec.md](docs/specs/completed-plan-followup-append.spec.md)
  的 append contract truth
- 依赖 [plan-sync-enforcement-followup.spec.md](docs/specs/plan-sync-enforcement-followup.spec.md)
  提供 “same-path signature changed 默认 reset” 的安全基线
- 依赖 `.imm/imm-plan.py`
  的 append-safe / reset 决策与 history 记录
- 依赖 [append-safe-proof-snapshot.spec.md](append-safe-proof-snapshot.spec.md)
  的最小 proof snapshot 契约
- 依赖 `.imm/imm-work.py`
  当前 “scan next executable step before done” 的 continuation truth
