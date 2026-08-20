# Spec: gstack quality ceiling closure

**任务 ID**: IMM-GSTACK-QUALITY-CLOSURE-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

完成 `gstack quality ceiling protocol` slice 的剩余收尾工作：把已实现并通过 review 的质量协议经验沉淀成 durable Learning / memory / HANDOFF，使后续 agent 能复用这次结论，而不重新阅读完整执行历史。

## 2. 背景

`docs/plans/2026-05-24-006-feat-gstack-quality-ceiling-protocol-plan.md` 已关闭：

- U1 新增 `docs/reference/gstack-quality-ceiling-protocol.md`。
- U2 在 `tests/test_skill_contracts.py` 增加 drift guard。
- Code review 发现 closed-world input 段落把 derived stages 写成 input。
- Follow-up 已修复：`Brainstorm manifest` 和 explicit review follow-up packet 是 source inputs；`Brainstorm Trace`、`origin_coverage`、`QA closure gate` 是 derived processing stages。
- Follow-up review 未发现新阻塞问题。

当前剩余工作是 workflow closure，不是继续实现质量协议，也不是修改 runtime。

## 3. 功能需求

### R1. Durable Learning

- `docs/solutions/` 必须记录本轮可复用经验：
  - gstack 哲学应落成 Skill contract guidance，而不是 runtime 平台扩张。
  - role preference 应表达为 `preferred bias` + `prohibited drift`。
  - interaction ritual 应压缩为 Entry / Exit gate。
  - closed-world completeness 只适用于 finite source packet。
  - `Brainstorm Trace`、`origin_coverage`、`QA closure gate` 是 derived processing stages，不是新的 closed-world inputs。

### R2. Memory and handoff freshness

- `.imm/memory/MEMORY.md` 必须能指向本轮 durable Learning 或 guidance。
- `HANDOFF.md` 必须不再指向旧 baseline repair Plan 作为当前 next boundary。
- Handoff 必须说明当前质量协议 closure 状态和下一步。

### R3. Verification remains current

- 完整 `tests.test_skill_contracts` 必须通过。
- 本 closure Plan 的 `imm-plan --json` 必须通过。
- focused text check 必须能证明 Learning / memory / HANDOFF 都包含质量协议收尾关键信息。

## 4. 验收标准

- [ ] Durable Learning 或 hub Learning 中存在本轮 quality ceiling closure 经验。
- [ ] `.imm/memory/MEMORY.md` 能索引该经验。
- [ ] `HANDOFF.md` 反映当前 closure，而不是旧 baseline repair 状态。
- [ ] `python3 -m unittest tests.test_skill_contracts` 通过。
- [ ] `imm-plan` 对本 Plan 的 JSON 校验通过。

## 5. 非目标

- 不修改 `docs/reference/gstack-quality-ceiling-protocol.md` 的核心协议，除非执行发现严重事实错误。
- 不修改 `Activation Plan`、State Ledger schema、runtime dispatch、browser daemon、ONNX、Canary Token 或 memory authority。
- 不新增 shared registry、generic dispatcher 或第二套 Learning store。
- 不创建 ADR；本轮不是 hard-to-reverse architecture decision。

## 6. 依赖项

- `docs/reference/gstack-quality-ceiling-protocol.md`
- `tests/test_skill_contracts.py`
- `docs/plans/2026-05-24-006-feat-gstack-quality-ceiling-protocol-plan.md`
- `docs/specs/gstack-quality-ceiling-protocol.spec.md`
- `docs/solutions/contracts.md`
- `.imm/memory/MEMORY.md`
- `HANDOFF.md`
