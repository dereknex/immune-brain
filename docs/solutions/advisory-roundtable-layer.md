# Pattern: Read-only Advisory Roundtable Layer

**领域**: Agent workflow / Planning advisory  
**描述**: 当引入多角色讨论能力时，把它设计成只读会诊层，而不是新的执行层，避免讨论共识绕过规划、执行和验收边界。

## 场景

- 任务存在产品、架构、实现、QA 或 UX 之间的真实取舍。
- 用户希望听到多角色观点，但系统仍需要保持 `plan -> work -> review` 小步闭环。
- 上游方法论提供了 party / roundtable / multi-agent discussion 能力，但本地系统已有明确的 planner、executor 和 QA 权限边界。

## 方案模板

1. **单独定义 advisory skill**: 新增独立 skill 承载多角色讨论，不把 party 逻辑塞进 planner 或 executor。
2. **限制触发场景**: 只在用户显式请求、复杂取舍、需求分歧或可能 replan 时触发；普通小任务不默认触发。
3. **固定输出契约**: 将讨论压缩成 handoff，包含 Problem、Roles consulted、Agreements、Disagreements、Risks、Scope posture suggestion 和 Recommended next skill。
4. **交给 preplan 决策**: party 的 scope posture 只能作为建议；实际 `Scope Mode` 必须由 preplan 阶段决定。
5. **保留执行与验收边界**: party 不写计划、不改代码、不记录 `pass / rework / replan`，也不激活 workflow state。
6. **把下游映射留在 spec/solution**: runtime skill 只保留执行面最小 handoff，而且 `party_packet` 保持单层 advisory 输出；`Origin`、`Research`、`Decisions`、`Assumptions`、`Scope Mode` 和 `Engineering Closure Check` 这类下游规划映射放在 paired spec / solution 中解释。
7. **角色输出只保留增量**: 共识统一在最终 `agreements` 聚合，单个角色默认只补充新增的 disagreement、risk 或 scope pressure，不重复共享背景和共享结论。

## 可复用前提

- 多角色讨论输出会被后续规划角色消费，而不是直接触发实现。
- 系统已有明确的 preplan/planner/executor/QA 分工。
- 讨论结论可能影响 scope，因此必须有一个后续角色负责接受、拒绝或收缩 party 建议。
- 环境可能不支持 sub-agent，因此需要 solo fallback。

## 验证依据

- `IMMUNE.md` 和 `README.md` 已声明 `imm-party` 是只读 advisory layer，不拥有 planner、executor 或 QA 权限。
- `skills/imm-party/SKILL.md` 定义了 trigger rules、role selection、sub-agent conditions、solo fallback、output handoff 和 write boundaries。
- `skills/imm-preplan-review/SKILL.md` 明确把 `imm-party` handoff 当作 advisory research，并保留最终 `Scope Mode` 决定权。
- `mise run list-skills` 与 `zsh scripts/install-local.sh --list`（等价）均能发现 `imm-party`。
- `docs/brainstorms/party-advisory-handoff-sample.md` 展示了 party handoff 到 preplan 字段的映射。
- `python3 .imm/imm-work.py status` 显示 `docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md` 的 Step 1-5 全部 pass。

## 约束与建议

- 不要把 party consensus 当成 scope 决策；它最多是 research input。
- 不要把完整长对话传给 planner；只传压缩后的 handoff。
- 不要为了 party 新增运行态状态，除非多次使用证明 durable party state 有必要。
- 如果 party 建议扩 scope，必须通过 `Selective Expansion` 规则审查。
- 如果没有 active step 或 validated plan，不要借 party 结果直接进入执行。

---
*沉淀日期: 2026-05-07 | 来源: BMAD Party advisory integration 计划全步骤验收*
