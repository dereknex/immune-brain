---
title: Rejected Shared Registry and Generic Dispatcher for Subagent Slice
rejected: true
rejection_reason: >
  本轮目标是把 imm-code-review 从 prose 合约推进到
  host-driven 的 execution truth，优先在现有 host-specific shared protocol 内落地可验证路径。
  引入 shared registry 或真正通用 dispatcher 会把实现从「完成 slice」推进到平台化重构，
  但当前还没有 3+ 个 host 重复出现 dispatch drift 的证据。
reusability: medium
key_files:
  - docs/plans/2026-05-17-002-feat-imm-code-review-subagent-closure-plan.md
  - docs/specs/imm-code-review-subagent-closure.spec.md
  - skills/imm-code-review/SKILL.md
  - docs/reference/subagent-dispatch-protocol.md
  - docs/reference/automatic-subagent-activation-policy.md
  - tests/test_skill_contracts.py
next_reuse_scenarios:
  - 第三方 host 在同一模式重复触发 fallback / retry 的真实维护成本持续上升
  - 多 host 同时需要统一的分发能力与统一 fallback 语义
  - 复盘需要把 runtime dispatch 成本与价值放到统一平台治理层
---

> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Rejected: Shared Registry or Generic Dispatcher in This Slice

## Rejected approach

在 `imm-code-review` 的第一刀里加入一个共享子代理 registry、统一任务分发器（
generic dispatcher），并由该层统一调度 security / api / data / reliability 等
lens，而不是让 host skill 按 activation plan 驱动专有执行路径。

## Rejection reason

这类 platform 化设计会把 scope 从“可复现实验”拉到“基础设施扩建”：边界清晰的 host 合同、显式 trigger、可控并发与可回归协议会被提前替代为跨 host 的通用引擎。
在本闭环里，现有证据只支持 host-bound 成熟：

- `imm-code-review` 已经具备可执行 dispatch truth：先 activation_plan，再构造分片 packet，再构造 child envelope。
- 合同测试已把“不要扩展为 shared registry / automatic dispatcher”作为约束验收项写死。
- 真实平台化收益需要至少 3 个 host 显著出现 dispatch drift 或维护痛点后再议。

## Preferred approach

先把 `imm-code-review` 的 host path 和 contract 打磨稳定；保留 `docs/reference/subagent-dispatch-protocol.md`
 + `docs/reference/automatic-subagent-activation-policy.md` 的 host-bound 机制。  
当未来确有平台化必要时，再单独开 plan 重估：  
1. 先拿到至少 3 个 host 的复用需求与维护数据；  
2. 以 dispatch ROI、fallback 失真率、retry/timeout 真实 telemetry（含 `.imm/memory/dispatch_telemetry.jsonl`）为决策输入；  
3. 再设计 shared registry 的最小实现并同步各 host 的 contract.

## Evidence

- [docs/plans/2026-05-17-002-feat-imm-code-review-subagent-closure-plan.md](docs/plans/2026-05-17-002-feat-imm-code-review-subagent-closure-plan.md)
- [docs/specs/imm-code-review-subagent-closure.spec.md](docs/specs/imm-code-review-subagent-closure.spec.md)
- [skills/imm-code-review/SKILL.md](skills/imm-code-review/SKILL.md)
- [docs/reference/subagent-dispatch-protocol.md](docs/reference/subagent-dispatch-protocol.md)
- [docs/reference/automatic-subagent-activation-policy.md](docs/reference/automatic-subagent-activation-policy.md)
- `tests/test_skill_contracts.py`

*沉淀日期: 2026-05-17 | 来源: feat-imm-code-review-subagent-closure U1-U3 闭环*

