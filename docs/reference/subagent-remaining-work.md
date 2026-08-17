# Subagent Remaining Work

本文档是 subagent 方向剩余工作的单一入口，按优先级分四类列出。
每项标注当前状态、前置依赖与建议下一步。

---

## 1. 第二波 Reviewer Runtime Slices

全部四名第二波 reviewer 已通过验收（plan 059）。

| Reviewer | 层级 | SKILL.md | Runtime Spec | 状态 |
|----------|------|----------|-------------|------|
| `data_integrity` lens | conditional-risk | 由 `imm-advisory-reviewer` 承载 | **Accepted** (IMM-DINT-001) | 已闭环 |
| `reliability` lens | conditional-risk | 由 `imm-advisory-reviewer` 承载 | **Accepted** (IMM-REL-002) | 已闭环 |
| `release_readiness` lens | project-specific | 由 `imm-advisory-reviewer` 承载 | **Accepted** (IMM-RRC-002) | 已合并为 lens |
| `debug-investigator`（现为 `imm-advisory-reviewer` `debug_hypothesis` lens） | project-specific | 已退休（023） | **Accepted** (IMM-DBG-002) | 已闭环 |

全部 9 名 reviewer 曾按 standalone runtime slice 验收；当前条件风险 reviewer 以及 `docs`、`prompt_contract`、`release_readiness` 已合并到 `imm-advisory-reviewer` 的 lens-based runtime path，旧 reviewer skill surface 已删除。

---

## 2. Dispatch Host Catalog 扩展

当前 `subagent-trigger-catalog.yaml` 和 `activation_plan.py` 已覆盖 `imm-code-review` 下的四个 conditional-risk lenses（`security`、`api_contract`、`data_integrity`、`reliability`），以及 `imm-ui-review` 下的五个 UI/UX lenses（`ui_a11y`、`ui_responsive`、`ui_i18n`、`ux_heuristic`、`ui_visual`）。这些 lens 都通过 `imm-advisory-reviewer` 执行。各 lens 已声明 `model_tier`；`activation_plan` JSON 含 `candidates`、`lenses`、`candidate_lenses`、`model_tiers` 与 `lens_model_tiers`；本机可选 agent-local `config.toml`（例如 `~/.pi/agent/immune-brain/config.toml`）的 `[subagent_models]` 与 Phase 4 解析见 `automatic-subagent-activation-policy.md` 与 `subagent-dispatch-protocol.md`。

| 扩展方向 | 当前状态 | 建议下一步 |
|----------|---------|-----------|
| 将 `data_integrity` lens 接入 `imm-code-review` catalog | 已完成 — trigger-only advisory lens | 继续观察 dispatch metrics |
| 将 `reliability` lens 接入 `imm-code-review` catalog | 已完成 — trigger-only advisory lens | 继续观察 dispatch metrics |
| `imm-party` catalog 接线（现为 `imm-brainstorm` `roundtable` mode） | 已退休（023） | 不再单独接线 |
| `imm-ui-review` catalog 接线 | 已完成 — trigger-only advisory lenses: `ui_a11y`、`ui_responsive`、`ui_i18n`、`ux_heuristic`、`ui_visual` | 继续观察 dispatch metrics |

**共同约束**: catalog 扩展必须保持 host-bound、trigger-based、advisory-only。不引入跨 host 共享 registry 或 background scheduler。每次扩展需单独 iteration plan。

---

## 3. 显式延期项

以下工作在多份 spec/plan 的 Non-Goals 中被显式排除，不应默认规划：

| 延期项 | 排除来源 | 何时重新评估 |
|--------|---------|-------------|
| LLM-assisted intent routing | automatic-subagent-activation.spec §5; plan 056 Notes | 当 deterministic rules 无法覆盖新 trigger pattern 时 |
| 跨会话调度 / 队列 / Webhook | automatic-subagent-activation.spec §5 | 当前仓库无此需求 |
| 通用 shared subagent registry | system-subagents-design.spec §4; workflow-skill-subagent-orchestration.spec §5 | 当 host-bound activation 无法满足三个以上 host 的 catalog 需求时 |
| Agent-to-agent 通信 | system-subagents-design.spec §4 | 当前仓库无此需求 |
| 长期 subagent memory / state | system-subagents-design.spec §4 | 当前仓库无此需求 |
| `.imm/imm-work.py` / `imm-plan.py` 核心行为变更 | plan 056 Notes; automatic-subagent-activation.spec §5 | 仅在单独 plan 显式获批后 |

---

## 4. 已关闭的相邻 Spec/Plan（参考）

以下 subagent 相关工作已 Accepted 或 Closed，不需要进一步实施：

| 制品 | 状态 |
|------|------|
| `system-subagents-design.spec.md` | Accepted |
| `workflow-skill-subagent-orchestration.spec.md` | Accepted |
| `imm-party-subagent-delegation.spec.md` | Accepted（历史 spec，alias 已退休 023） |
| `subagent-runtime-mvp.spec.md` | Accepted |
| `first-wave-subagent-runtime-dispatch.spec.md` | Accepted |
| `automatic-subagent-activation.spec.md` | Accepted |
| `first-subagent-batch.spec.md` | Accepted |
| `remaining-first-batch-runtime-activation.spec.md` | Accepted |
| `security-reviewer-runtime.spec.md` | Superseded by `imm-advisory-reviewer` security lens |
| `api-contract-reviewer-runtime.spec.md` | Superseded by `imm-advisory-reviewer` api_contract lens |
| `prompt-contract-reviewer-runtime.spec.md` | Superseded by `imm-advisory-reviewer` prompt_contract lens |
| `ai-eval-planner-runtime.spec.md` | Superseded by `imm-advisory-reviewer` ai_eval lens |
| `docs-verifier-runtime.spec.md` | Superseded by `imm-advisory-reviewer` docs lens |
| Plan 055 (first-wave dispatch) | Closed |
| Plan 056 (automatic activation) | Closed |

---

*生成日期: 2026-05-11 | 来源: plan 058 U2 — subagent status closure sweep*
