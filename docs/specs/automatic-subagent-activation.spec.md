# Spec: Rule-based automatic subagent activation

**任务 ID**: IMM-AUTO-ACTIVATION-001
**负责人**: Planner
**状态**: Accepted（验收证据：docs/reference/subagent-trigger-catalog.yaml + .imm/activation_plan.py + docs/reference/automatic-subagent-activation-policy.md 已落地；golden tests 在 tests/test_activation_plan.py 通过；imm-code-review Phase 2 引用 catalog-driven activation_plan）

## 1. 目标

在 **单次会话内**、由 **显式 host skill** 控制的前提下，用 **确定性规则**（路径模式、关键词、阶段标签）决定何时并行激活哪些 bounded child reviewers，把「模型临场决定是否 dispatch」收敛为「catalog + 纯函数计划 → 再 dispatch」。

本规格 **不是** 无人值守全局调度器、不是跨会话队列、不是隐性默认 fan-out、不是绕过 `imm-planner` / `imm-work` / `imm-qa` 的执行自动化。

## 2. 上游依据与边界

- [workflow-skill-subagent-orchestration.spec.md](workflow-skill-subagent-orchestration.spec.md)：split gate、阶段映射、并行收敛、仲裁顺序。
- [subagent-runtime-mvp.spec.md](subagent-runtime-mvp.spec.md)：首个 runtime host 为 `imm-code-review`；首版从 `security-reviewer` 与 `api-contract-reviewer` 起步，后续 catalog slice 可在同一 host-bound 边界内加入更多条件风险 reviewers。
- [subagent-dispatch-protocol.md](../../docs/reference/subagent-dispatch-protocol.md)：六阶段 dispatch；环境检测与 solo fallback reason。
- [system-subagents-design.spec.md](system-subagents-design.spec.md)：authority class、manifest、条件风险层非默认 gate。

## 3. 功能需求

### R1. 触发目录（machine-readable）

- 仓库维护一份 **`docs/reference/subagent-trigger-catalog.yaml`**（或等效 JSON），声明：
  - `host`: 当前仅 `imm-code-review`
  - `children`: `security-reviewer`、`api-contract-reviewer`、`data-integrity-reviewer`、`reliability-reviewer` 的路径 glob / 关键词 / 否定规则
  - `max_parallel`、`parallel_group`（当前 `imm-code-review` 上限为 3 个 child）
- 规则须与各 child 的 `SKILL.md` trigger 表面一致；冲突时以 **更保守**（少 dispatch）为准。

### R2. 确定性计划输出

- 提供纯函数式 API（建议 `.imm/activation_plan.py` 或 `scripts/` 下模块）：输入结构化载荷（例如 `changed_paths`、`task_summary_keywords`、`stage`），输出 **`activation_plan`**：
  - `candidates: [child_id ...]`（有序）
  - `parallel_allowed: bool`
  - `rationale_codes: [...]`（短枚举）
  - `solo_fallback_reason: none | trigger_not_hit | unclear_boundary | unavailable_environment | cost_scope_mismatch | user_requested`
- 禁止在此模块内调用 Task 工具或网络；禁止 LLM 路由（首版）。

### R3. Host 接面

- `skills/imm-code-review/SKILL.md` 在 Phase 2 Trigger Matching 中：**默认**根据 `activation_plan` 决定是否 dispatch；若规则返回空集则进入既有 solo 路径并记录 reason。
- 用户显式要求 solo 时覆盖规则输出。

### R4. Authority 不变

- Child 仍为 advisory-only、非默认 gate；父 host 合并 findings；仲裁顺序沿用 `security > performance > compatibility > readability`（与 dispatch protocol 一致）。

### R5. 验证

- 单元测试：表格驱动用例（路径 → 期望 child 集合）。
- `tests/test_skill_contracts.py`：引用本规格与 catalog 存在性、host 文书衔接。
- 若无法 E2E 自动化 harness，保留 Cursor 手工路径：一次 trigger 命中下的并行 dispatch 与一次 solo fallback。

## 4. 验收标准

- [ ] `subagent-trigger-catalog` 存在且与 cataloged child trigger 文案可对齐。
- [ ] 确定性 `activation_plan` 模块存在且有 Golden 测试。
- [ ] `imm-code-review` 文书说明 catalog 驱动 Phase 2 与覆盖规则。
- [ ] 本 spec 被 README 或 policy 文档引用；`python3 -m unittest tests.test_skill_contracts` 通过。
- [ ] 未引入 shared runtime registry、后台调度器或 `imm-work` 级自动跳转。

## 5. 非目标

- 通用 LLM intent classifier。
- 跨会话预约、队列、Webhook 唤醒。
- 在本规格外新增非条件风险 child 或跨 host 默认 fan-out。
- 修改 `.imm/imm-work.py` / `imm-plan.py` 核心行为（除非另立计划）。

## 6. 依赖项

- [first-wave-subagent-runtime-dispatch.spec.md](first-wave-subagent-runtime-dispatch.spec.md)
- [workflow-skill-subagent-orchestration.spec.md](workflow-skill-subagent-orchestration.spec.md)
