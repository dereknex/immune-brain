> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Bounded Advisory Delegation Packets

**领域**: Agent workflow / sub-agent delegation
**描述**: 当只读 advisory 能力要从治理文档进入真实 delegation 路径时，先把每个 delegated role 收敛成单角色、provider-agnostic 的 delegation packet，并同时固定 fallback reasons 与人工运行时验证路径。不要直接跳到通用 registry 或自动 router。

**reusability**: high
**next_reuse_scenarios**: [`imm-party` 之外的只读 advisory agent 需要接入真实 delegation, 现有系统已经有 authority boundary 但还没有 execution-ready delegation contract, 某个 runtime 能否真实 spawn sub-agents 只能部分自动化验证`]

## 场景

- 系统已经有 `imm-party` 这类只读 advisory layer，也已经明确它不能拥有 scope、plan、execution 或 QA authority。
- 文档已经要求“显式请求时应使用 sub-agent delegation”，但实际运行面还停留在原则描述。
- 本地仓库可以测试 contract 文本，却不能完全自动化模拟真实 runtime delegation。
- 团队想先交付一个最小、可验证的 runtime slice，而不是一次做通用 subagent platform。

## 方案模板

1. **先锁只读 advisory 范围**: 只为只读会诊类 agent 做首个 runtime slice，不把执行类或 reviewer roster 一起接进来。
2. **共享上下文与角色增量分层表达**: 每轮只提供一份 `shared_context_summary` 给所有选中角色，再让每个 advisory role 只携带自己的 `focus_delta`、`role`、`decision_under_discussion`、`boundary`、`tool_policy` 和 `output_expectation`。
3. **把边界写进 packet 本身**: `boundary` 里直接声明 no code edits、no plan writes、no workflow-state mutation、no QA closure，避免 delegated role 靠隐含常识守边界。
4. **固定 fallback reason 名称**: 例如 `unavailable_environment`、`cost_scope_mismatch`、`no_explicit_subagent_request`，避免 solo fallback 被写成模糊解释。
5. **测试 contract，不冒充 runtime harness**: 用 focused regression 守住 packet 形状、fallback reason 和 authority boundary；不要把文本测试说成 end-to-end delegation proof。
6. **补人工 runtime 验证路径**: 如果 repo 无法真实 spawn sub-agents，就在 spec 里明确写出 delegation available / unavailable / no explicit request 三类人工检查场景。

## 可复用前提

- 系统已有 planner / executor / QA 等 authority boundary，不需要再发明平行执行链。
- 当前要接入的是 advisory delegation，而不是 code-editing worker 或自动 orchestration。
- repo 内至少能稳定回归 skill contract 文本。
- 真实 runtime delegation 的可用性可能依赖 Codex 或其他外部运行环境。

## 验证依据

- [skills/imm-party/SKILL.md](skills/imm-party/SKILL.md) 现在包含 `Delegation Packet` 小节、`shared_context_summary + focus_delta` 的推荐 shape、advisory-only boundary，以及固定 fallback reasons。
- [.imm/specs/imm-party-subagent-delegation.spec.md](docs/specs/imm-party-subagent-delegation.spec.md) 现在把分层 packet contract、fallback reason 枚举和 `Codex Runtime Manual Validation` 三类场景写成规格。
- `tests/test_skill_contracts.py` 现在机械检查 `delegation_packet`、`decision_under_discussion`、`tool_policy: no tools`、固定 fallback names，以及 `no plan writes` / `no workflow-state mutation` / `no QA closure`。
- `python3 -m unittest tests.test_skill_contracts` 通过，说明本地 contract regression 已守住这条 delegation slice 的关键文本约束。
- [2026-05-09-001-feat-imm-party-subagent-delegation-plan.md](docs/plans/2026-05-09-001-feat-imm-party-subagent-delegation-plan.md) 的 U1-U3 已全部 pass，分别闭环 execution-ready packet、focused regression 和 runtime manual validation path。

## 约束与建议

- 不要把 advisory delegation packet 扩成通用 manifest registry；两者的工程量和风险面完全不同。
- 不要让 fallback reason 变成自由文本，否则后续测试和用户心智都会漂移。
- 不要把“本地测试通过”误写成“真实 delegation 已自动化证明”；不能自动化的部分要老实留在人工验证里。
- 如果下一步要接入非 advisory subagent，先回到 preplan/planner 重新锁 scope，不要沿用这条窄 slice 直接扩张。

---
*沉淀日期: 2026-05-09 | 来源: imm-party explicit delegation runtime slice U1-U3 全步骤验收*
