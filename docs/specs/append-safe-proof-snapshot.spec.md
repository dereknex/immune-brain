> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: append-safe proof snapshot for same-path sync

**任务 ID**: IMM-WORKFLOW-013
**负责人**: Planner
**状态**: Accepted（`.imm/imm-plan.py` / `current_iteration_state.py` + 回归测试已落地）

## 1. 目标

为 same-path append-safe preservation 增加一个最小、可验证的 runtime proof source，
让 `imm-plan` 在同一路径 plan 发生 signature 变化时，能够证明旧已完成前缀是否仍然成立。

本轮目标不是扩展 history restore，而是补齐 `047` 缺失的前提：

- 允许新增最小 persisted proof snapshot
- 只用于 same-path signature change 的 append-safe 判定
- 继续保持默认安全基线：证明不了就 reset

## 2. 问题背景（已由本 spec 闭合）

[same-path-append-completion-preservation.spec.md](docs/specs/same-path-append-completion-preservation.spec.md)
定义了 append-safe 规则，但 truthful 实现需要 **validation 时持久化的最小 step prefix**。
此前仅有 `plan_signature` 无法在改写后重建旧前缀；现已通过在 successful sync 写入
`validated_plan_snapshot` 解决（缺 proof 时仍 reset，不猜测 preserve）。

## 3. 功能需求

### R1. Persist a minimal proof snapshot at validation time

- `imm-plan` 在 plan validation 成功并 sync runtime state 时，必须额外持久化一个最小 proof snapshot。
- 该 snapshot 只包含 append-safe 判定所需的最小字段：
  - `plan_path`
  - `plan_signature`
  - `steps`
- `steps` 中每一项首版至少包含：
  - `number`
  - `step_id`
  - `result`
  - `verification`
  - `depends_on`

推荐字段名：

```text
validated_plan_snapshot:
  plan_path: <canonical path>
  plan_signature: <validated signature>
  steps:
    - number
      step_id
      result
      verification
      depends_on
```

- 这不是新的 workflow state store，只是当前 runtime plan 的最小 closure-proof snapshot。
- 不要求保留 planner-only 字段，也不要求保留旧 snapshot 历史链。

### R2. Same-path append-safe gate must depend on the snapshot

- 当 `same_plan = true` 且 `signature_changed = true` 时：
  - 若存在可用的 `validated_plan_snapshot`，runtime 才能执行 append-safe 判定
  - 若 snapshot 缺失、损坏、字段不足或无法对齐，则必须回退到 reset
- append-safe 判定必须比较：
  - snapshot 中旧 completed prefix
  - 新 normalized plan 中对应 prefix
- 若 prefix 完全一致且新变更只是尾部追加，允许 preserve `completed_steps`
- 其他情况一律 reset

### R3. Missing proof must degrade safely

- 没有 snapshot 的旧 runtime state 不做迁移补偿，也不做猜测 preserve。
- 对历史上未写入 snapshot 的状态，same-path signature change 继续按旧规则 reset。
- 首版不要求一次性修复历史 runtime 记录；只要求从新 validation 开始写入 truthful proof snapshot。

### R4. Runtime ownership remains narrow

- snapshot 与 append-safe gate 仍属于 `imm-plan` sync 语义，不属于 `imm-work`
- `imm-work` 继续只消费最终的 runtime state 结果，不参与 proof 生成
- `imm-review` / planner contract 不因 snapshot 引入新的直接写入路径

### R5. Scope stays narrow

- 不新增第二套 state 文件或 registry
- 不实现多版本 plan archive
- 不做历史 reopen / backfill migration
- 不扩展到跨 plan proof stitching

## 4. 决策表

| 场景 | 是否有 snapshot | `completed_steps` | 说明 |
| --- | --- | --- | --- |
| plan path changed | 无关 | reset | 仍按既有安全基线 |
| same-path signature changed + snapshot missing | no | reset | 缺 proof，不猜 |
| same-path signature changed + snapshot proves identical completed prefix | yes | preserve | 仅限 append-safe |
| same-path signature changed + snapshot shows prefix drift | yes | reset | 旧 closure 失效 |
| signature unchanged | 无关 | preserve | 维持现状 |

## 5. 验收标准

- [x] validation 成功后 runtime state 包含最小 `validated_plan_snapshot`
- [x] same-path signature change 只有在 snapshot 可证明 append-safe 时才 preserve
- [x] snapshot 缺失或无法对齐时，仍 truthfully reset
- [x] focused runtime regression（`tests/test_imm_plan.py`、`tests/test_imm_work.py`）覆盖上述路径
- [x] 本轮不新增第二套 runtime store 或历史回填机制

## 6. 非目标

- 不继续直接实现 `047` 的 runtime preserve 逻辑而绕开 proof source
- 不为旧历史状态补写 snapshot
- 不实现 step-level semantic migration beyond prefix equality
- 不把 snapshot 扩展成通用版本管理

## 7. 依赖项

- 依赖 [same-path-append-completion-preservation.spec.md](docs/specs/same-path-append-completion-preservation.spec.md)
  的 append-safe contract
- 依赖 [plan-sync-enforcement-followup.spec.md](docs/specs/plan-sync-enforcement-followup.spec.md)
  的 reset-by-default 安全基线
- 依赖 `.imm/imm-plan.py`
  当前 sync behavior
- 依赖 `.imm/current_iteration_state.py`
  当前 runtime state persistence
