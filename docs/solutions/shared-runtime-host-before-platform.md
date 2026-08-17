> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Shared Runtime Host Before Subagent Platform

**领域**: Agent workflow / subagent runtime / reviewer orchestration
**描述**: 当仓库已经有 shared orchestration contract、独立 reviewer hosts 和 focused regressions，但还没有一条真实的 shared delegation path 时，下一刀应先把一个现有 orchestrator 提升成单一 shared runtime host。不要直接跳到 registry、automatic dispatcher 或完整 reviewer platform。

**reusability**: high
**next_reuse_scenarios**: [`imm-code-review` 之外的 shared workflow host 需要首次承接真实 subagent delegation, 仓库已经有多个 standalone reviewer skills 但还没有 shared runtime path, 团队想验证真实 delegation 行为而不把 scope 扩成平台工程`]

## 场景

- shared workflow 已经明确了 `subagent-first + explicit solo fallback`。
- conditional reviewers 已有独立 `SKILL.md`、trigger-only 边界、fallback 和 focused contract tests。
- 当前缺口不再是“有没有 reviewer host”，而是“有没有一条真实 shared host 会显式调用它们”。
- 团队希望让 runtime 真相向前走一步，但不想一次引入 registry、自动分发、agent-to-agent 通信或多 host rollout。

## 方案模板

1. **先选一个 shared host，不做平台**: 选一个已经天然承担编排职责的 orchestrator，例如 `imm-code-review`，只让它成为第一条 shared runtime host。
2. **child reviewer 集合保持最小**: 首版只接 1-2 条已有 standalone reviewer path，例如 `security-reviewer`、`api-contract-reviewer`，避免 runtime MVP 变成 roster 扩张。
3. **沿用现有 layered packet**: 父 host 继续使用 `shared_context_summary + focus_delta`，并把 `tool_policy`、`fallback_reasons`、`output_expectation` 一并写清。
4. **显式写出 delegation gate 与 fallback**: 只有边界清晰、互不阻塞、trigger 命中、环境支持时才 delegate；否则明确 fallback 到 solo，并记录 `unclear_boundary`、`trigger_not_hit`、`unavailable_environment`、`cost_scope_mismatch`。
5. **reviewer authority 不升级**: child reviewer 仍保持 advisory-only、read-only、non-default gate；父 host 负责 synthesis，但不能把 delegated findings 静默升级成 scope / execution / QA authority。
6. **用 focused regression 锁住 non-platform 边界**: 测试既要证明 shared host 存在，也要证明它不是 shared registry、不是 automatic dispatcher，并保留 available / unavailable 的 manual validation path。

## 可复用前提

- 仓库已经先完成了 contract-first orchestration truth，而不是仍在争论主链路。
- child reviewers 已经是独立宿主，而不是仍停留在 README/spec 命名层。
- 当前目标是“验证第一条 shared runtime path”，而不是“统一所有 reviewer 派发能力”。
- 已有一个稳定的 focused contract regression 入口，例如 `tests/test_skill_contracts.py`。

## 验证依据

- [skills/imm-code-review/SKILL.md](skills/imm-code-review/SKILL.md) 现在明确 `imm-code-review` 是 first shared runtime host，并把 child reviewer 集合限制在 `security-reviewer` 与 `api-contract-reviewer`，同时显式排除 shared registry / automatic dispatcher 叙述。
- `skills/security-reviewer/SKILL.md` 与 `skills/api-contract-reviewer/SKILL.md` 现在补齐了 runtime-hosted `tool_policy`、`fallback_reasons`、`output_expectation` 以及 delegated child reviewer 语义。
- [README.md](README.md) 现在加入 runtime MVP 入口说明，明确 shared host、bounded child reviewers 和 solo fallback reasons。
- `tests/test_skill_contracts.py` 现在直接断言 shared runtime host、fallback reasons、reviewer packet fields 和 no-platform-expansion truth。
- `python3 -m unittest tests.test_skill_contracts` 通过，当前共 `48` 个测试，说明这条 shared runtime host MVP 已进入可回归契约层，而不是仅靠散文约束。
- [2026-05-10-040-feat-subagent-runtime-mvp-plan.md](docs/plans/2026-05-10-040-feat-subagent-runtime-mvp-plan.md) 的 U1-U4 已全部 `pass`，分别闭环 shared host 边界、child reviewer runtime contract、README runtime truth 与 focused regression。

## 约束与建议

- 不要在第一条 shared runtime path 里同时引入多个 host；那会让 MVP 直接滑向 platform design。
- 不要把 child reviewer 的 fallback 写成“等价替代”；fallback 只表示主流程接管，而不是 dedicated review 依然神奇存在。
- 不要让 focused regression 冒充端到端 runtime orchestration proof；它证明的是 contract truth 与 drift guard，不是 provider-level execution guarantee。
- 如果下一步开始要求 capability detection、shared queue、统一 reviewer selection 或多个 shared hosts 复用同一调度层，先回到 `imm-preplan-review` / `imm-planner` 重锁 scope。

---
*沉淀日期: 2026-05-10 | 来源: subagent runtime MVP host U1-U4 全步骤验收*
