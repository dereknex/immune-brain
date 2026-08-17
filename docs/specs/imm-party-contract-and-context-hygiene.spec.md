# Spec: imm-party contract and context hygiene

**任务 ID**: IMM-PARTY-003
**负责人**: Planner
**状态**: Proposed

## 1. 目标

收敛 `imm-party` 当前过重的 runtime skill contract，减少重复上下文、重复 guard、
重复 schema 和逐字测试耦合，同时保持 `imm-party` 仍然是只读 advisory layer，
不改变其 sub-agent activation 边界或下游 workflow authority。

首轮只处理 `imm-party` 的 runtime prompt hygiene、paired spec/docs contract、
最小 repo-inspection boundary 和 focused contract tests；不扩展成通用 prompt
治理框架、全仓库检索系统或新的 workflow runtime。

## 2. 问题背景

当前 `imm-party` 已经具备 advisory boundary 和 delegation contract，但 runtime
skill 同时承载了：

- 运行时触发与边界；
- delegation packet 设计说明；
- 最终 handoff schema；
- `Origin / Research / Decisions / Assumptions` 这类下游规划映射；
- 与 repo-wide 共通的 guard fields；
- 逐字断言驱动的长句测试约束。

这导致 4 个直接问题：

1. runtime skill 过长，设计说明与执行契约混在一起；
2. per-role `context_summary` 会把同一背景复制到多个角色；
3. `party_packet` 与下游 planning fields 双层表达，高度重复；
4. `tests/test_skill_contracts.py` 主要靠长句 `assertIn(...)` 锁文案，反向鼓励 prompt 膨胀。

## 3. 功能需求

### R1. Runtime/design split

- `skills/imm-party/SKILL.md` 只保留运行时最小必要契约：
  - trigger rules
  - role count / escalation rules
  - fallback reasons
  - read-only boundary
  - compact runtime packet shape
  - brief user-facing output shape
- 详细设计说明、field rationale、downstream mapping 和 extended examples 必须下沉到
  paired spec 或 solution doc，而不是继续全部放在 runtime skill。
- 本轮不移除 `imm-party` 的 advisory/sub-agent contract，只压缩其 runtime surface。

### R2. Context and packet compression

- sub-agent delegation contract 必须改为：
  - `shared_context_summary`
  - per-role `focus_delta`
- `focus_delta` 只允许携带该角色的增量关注点，而不是重复背景。
- `party_packet` 必须保持单层输出，至少只保留：
  - `problem`
  - `roles_consulted`
  - `agreements`
  - `disagreements`
  - `risks`
  - `scope_posture`
  - `recommended_next_skill`
- `allowed / blocked / workflow_guard` 属于 Codex-facing outer contract，不属于
  `party_packet` payload。
- `Origin / Research / Decisions / Assumptions` 不再作为 `imm-party` runtime handoff
  的强制字段；若下游需要，应由 `imm-preplan-review` / `imm-planner` 映射推导。

### R3. Role-selection and delta-only output

- `imm-party` 角色策略必须从“任选 `2-4` 个”改成：
  - 默认 `2`
  - 只有当分歧影响 scope posture 时升到 `3`
  - 只有当 verification / UX / handoff 风险仍不清时才升到 `4`
- 角色输出必须改成 delta-only：
  - 共识只在聚合层进入 `agreements`
  - 单个角色默认不重复背景、问题陈述或已形成的共同结论
  - 默认只暴露该角色新增的 disagreement / risk / scope pressure

### R4. Shared guard baseline and inspection boundary

- repo-wide 共享 guard baseline 应作为 canonical contract 被引用，而不是在
  `imm-party` 中完整重复解释。
- `imm-party` 只保留 party-specific delta，例如 advisory-only boundary 与
  `imm-preplan-review` / `imm-planner` handoff 约束。
- 为 `imm-party` 相关分析增加最小 repo-inspection boundary：
  - 默认先读 `skills/imm-party/SKILL.md`
  - 再读对应 spec
  - 再读最多 `1` 份相关 solution doc
  - 默认不读 `upstreams/`，除非用户明确要求上游对比

### R5. Structured contract tests

- `tests/test_skill_contracts.py` 对 `imm-party` 的验证必须从长句逐字断言，收敛到
  结构化锚点或短 marker 断言。
- 首轮只重构与 `imm-party` / shared guard baseline 直接相关的断言；
  不做全文件测试风格大迁移。
- 新测试应优先验证：
  - runtime-vs-design layering
  - `shared_context_summary` / `focus_delta`
  - default-2 escalation rules
  - delta-only output anchors
  - canonical guard reference presence

## 4. 验收标准

- [ ] `imm-party` runtime skill 不再同时承载大段设计说明和下游 handoff 映射。
- [ ] delegation contract 改成 `shared_context_summary + focus_delta`，不再要求每个角色重复完整 `context_summary`。
- [ ] `party_packet` 不再同时强制携带 `Origin / Research / Decisions / Assumptions`。
- [ ] 角色数量策略有默认 `2` 与升到 `3/4` 的显式条件。
- [ ] 角色输出 contract 明确要求 delta-only，避免重复背景和重复结论。
- [ ] `imm-party` 相关 repo inspection 有最小白名单/黑名单边界，默认不扫 `upstreams/`。
- [ ] `tests/test_skill_contracts.py` 对本切片改为结构化锚点断言，而不是继续依赖长句逐字匹配。
- [ ] 本轮不引入通用 prompt registry、自动检索框架、或 repo-wide 全量测试重写。

## 5. 非目标

- 不实现通用 system prompt / skill prompt 管理器。
- 不重写所有 `imm-*` skills 的 guard 写法。
- 不把 `tests/test_skill_contracts.py` 全量迁移为另一套测试框架。
- 不实现自动 repo 检索器或通用 whitelist/blacklist engine。
- 不修改 `imm-preplan-review`、`imm-planner`、`imm-work` 的 authority boundary。

## 6. 依赖项

- 依赖 [party-mode-advisory.spec.md](docs/specs/party-mode-advisory.spec.md)
  的只读会诊层语义。
- 依赖 [imm-party-subagent-delegation.spec.md](docs/specs/imm-party-subagent-delegation.spec.md)
  的显式 delegation / fallback 基础契约。
- 依赖 [advisory-roundtable-layer.md](docs/solutions/advisory-roundtable-layer.md)
  的 advisory handoff 与 scope boundary 模式。
- 依赖 [tested-skill-contracts.md](docs/solutions/tested-skill-contracts.md)
  的 focused contract regression 入口。
