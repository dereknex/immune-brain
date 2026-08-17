> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Dispatch Intent Transparency and Fallback Meaning

**领域**: Agent workflow / subagent dispatch / host skill contracts
**描述**: 当 review host 决定不使用子代理时，必须区分"用户明确要求 solo"与"系统自己判断的 fallback"，并在输出中同时提供 stable reason code 和人类可读解释。

**reusability**: high
**next_reuse_scenarios**: [`新 review host 接入 dispatch protocol 时对齐 explicit_solo 语义`, `imm-compounder 采集 dispatch telemetry 需要区分 user_requested vs 系统 fallback`, `用户投诉 "我说了句简单指令就被当成了拒绝子代理"`, `向 imm-party 或其他 host 扩展 solo_fallback_meaning 输出要求`]

## 场景

- 用户发出简洁指令（如 "review this"），host skill 将其误判为 `explicit_solo: true`，导致本该触发的 specialized reviewer 被跳过。
- Dispatch 回退到 solo 后，用户看到的结果里只有内部 reason code（如 `cost_scope_mismatch`），没有人类可读的解释，不知道系统为什么没有调用子代理。
- 两个 review host（imm-code-review、imm-ui-review）分别维护 dispatch 规则，容易出现不对称：一个有 fallback 解释，另一个没有。

## 方案模板

1. **收紧 explicit_solo 判定**: 在 host skill 的 Phase 2 (Trigger matching) 中明确规定：`explicit_solo: true` 仅在用户**显式**要求 "不要用子代理"、"stay solo"、"don't dispatch" 时才设置。简洁指令、速度偏好、未提及 dispatch 的请求均不构成 `explicit_solo`。普通的 fallback 原因（no trigger match、unclear boundary、unavailable dispatch support、cost/scope mismatch）使用各自的 `solo_fallback_reason`。

2. **强制输出 fallback 解释**: 当 dispatch 回退到 solo 时，review 输出 artifact 必须包含两个字段：
   - `solo_fallback_reason`: stable reason code（如 `no_explicit_trigger_match`、`unavailable_environment`），供 downstream metrics 使用
   - `solo_fallback_meaning`: 人类可读的纯语言解释，说明为什么没有调用子代理

3. **跨 host 镜像**: 当在一个 review host 中添加这些规则时，同步镜像到 sibling review host，并做 artifact-appropriate 名称替换（`code_review` → `ui_review`）。

4. **契约测试守卫**: 用 focused contract test 锁住两个 host 的 SKILL.md 中必须包含 `solo_fallback_reason`、`solo_fallback_meaning` 和 `plain-language meaning` 的文本存在性。

## 可复用前提

- Host skill 已有 dispatch protocol 段和 activation plan 集成。
- activation plan 的 `explicit_solo` 输入字段已存在，host 只需要约束其使用方式。
- 系统的 review output artifact 有稳定的字段结构，可以添加新字段而不破坏下游消费。

## 验证依据

- [skills/imm-code-review/SKILL.md](skills/imm-code-review/SKILL.md) Phase 2 明确 `explicit_solo: true` 仅用于显式用户否定；Output artifact 要求 solo fallback 时必须包含 `solo_fallback_reason` 和 `solo_fallback_meaning`。
- [skills/imm-ui-review/SKILL.md](skills/imm-ui-review/SKILL.md) Phase 2 对齐同一 `explicit_solo` 约束；Output artifact 对齐同一 `solo_fallback_meaning` 要求。
- `tests/test_skill_contracts.py` `test_review_hosts_require_solo_fallback_meaning` 断言两个 host 均包含 `solo_fallback_reason`、`solo_fallback_meaning` 和 `plain-language meaning`。
- `python3 -m unittest tests.test_skill_contracts` 通过，103 tests OK。
- [.imm/specs/subagent-activation-intent-transparency.spec.md](docs/specs/subagent-activation-intent-transparency.spec.md) 定义了意图细化和透明度增强的验收标准。
- [docs/plans/2026-05-15-004-feat-subagent-activation-intent-transparency-plan.md](docs/plans/2026-05-15-004-feat-subagent-activation-intent-transparency-plan.md) U1-U5 全部 QA pass。

## 约束与建议

- 不要把 `explicit_solo` 的狭窄定义理解为"永远不要 solo"；系统 fallback 仍然是合法的，只是不要把它归因于用户。
- 不要在每次 solo fallback 时都写长篇解释；`solo_fallback_meaning` 一句话说清楚即可，例如 "Activation plan returned no matching reviewer for documentation-only changes."
- 如果未来有第三个 review host 加入 dispatch protocol，应该在第一轮实现中就镜像这两条规则，而不是事后补 contract test。
- 不要混淆 `solo_fallback_reason`（给机器/metrics 看的 code）和 `solo_fallback_meaning`（给人看的解释）；两者必须在 solo fallback 时同时出现。

---
*沉淀日期: 2026-05-15 | 来源: subagent-activation-intent-transparency plan U1-U5 全步骤验收*
