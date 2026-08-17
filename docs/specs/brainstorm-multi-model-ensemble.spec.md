# Spec: Brainstorm Multi-model Ensemble

**Task ID**: IMM-BRAINSTORM-ENSEMBLE-001  
**Owner**: imm-planner  
**Status**: Draft

## 1. Goal

让 `imm-brainstorm` 在需要发散视角时可以使用多模型候选，但仍保持 Brainstorm 的边界：只产出 framing、约束、未知、风险和下一步建议，不写 Spec，不写 Plan，不激活执行步骤。

## 2. Background

Immune-Brain 已经有模型分层和 Planner ensemble 基础：

- `resolveWorkflowStageModels(stage, config)` 从 `workflow_models` 和 preset 解析模型。
- `buildPlannerEnsembleRequest()` 从 `workflow_models.planner_ensemble` 生成 advisory-only candidates。
- `normalizePlannerEnsemblePacket()` 把 agreement、disagreement 和 strong-model blockers 收敛成 Planner 拥有的证据。

Brainstorm 阶段缺的是等价的、边界更窄的 ensemble contract。实现不应该新增模型 SDK、不应该让 runtime 直接调用模型，也不应该让 Brainstorm 拥有最终方案。

## 3. Requirements

### R1. Stage key

新增 `brainstorm_ensemble` workflow stage。

- `workflow_models.brainstorm_ensemble` 可配置多个 concrete model 或 tier。
- preset 中可为 `balanced`、`ensemble`、`quality` 提供默认值。
- `off` 和无配置时保持单模型或 inherit fallback。

### R2. Runtime request helper

新增 `buildBrainstormEnsembleRequest(input)`，复用现有 advisory dispatch 语义。

返回值包含：

- `dispatch`
- `stage: "brainstorm_ensemble"`
- `fallback_reason`
- `candidates`

候选必须是 advisory-only，默认 `tool_policy: "no tools"`。

推荐角色：

- `clarify_scope`
- `divergent_options`
- `minimal_solution`
- `risk_review`

### R3. Cost gate

小任务默认不 fan out。

- `brainstorm_risk: "small"` 返回 `dispatch: false` 和 `fallback_reason: "cost_scope_mismatch"`。
- `normal`、`elevated`、`explicit` 可在配置解析出多个模型时 dispatch。

### R4. Normalization contract

新增 `normalizeBrainstormEnsemblePacket(children)`，把候选输出收敛为 Brainstorm 拥有的 framing packet。

输出必须表达：

- `owner: "imm-brainstorm"`
- `children_advisory_only: true`
- `framing_evidence`
- `decision_criteria`
- `open_questions`
- `risk_verification_requirements`
- `planner_handoff_owner: "imm-planner"`

Agreement 只作为 evidence。Disagreement 进入 decision criteria。strong-tier blockers 进入风险或验证要求。

### R5. Host surface

`imm-activation-plan` 可以通过最小 stage flag 暴露 Brainstorm ensemble JSON。该 CLI 只输出计划，不启动模型，不写 `.imm/` state。

推荐 flag：

```bash
plugins/immune-brain/bin/imm-activation-plan --stage brainstorm_ensemble --task-summary "..." --json
```

### R6. Brainstorm prompt contract

`dist/imm-brainstorm.md` 必须说明：

- multi-model 是 advisory-only。
- Brainstorm 不投票。
- Brainstorm 不写 Spec 或 Plan。
- 最终 Spec 和 Plan authority 仍属于 `imm-planner`。
- 子模型分歧必须变成开放问题、决策条件或风险。

## 4. Invariants

- 默认单模型 Brainstorm 行为保持兼容。
- Runtime 不直接调用 provider API。
- Host 负责并行执行 candidates。
- Planner 仍然是最终 Spec 和 Plan owner。
- Brainstorm ensemble 不能激活 executor、QA 或 review closure。

## 5. Acceptance Criteria

- [ ] `resolveWorkflowStageModels("brainstorm_ensemble", config)` 可解析多模型配置。
- [ ] `buildBrainstormEnsembleRequest()` 对 small risk 返回 solo fallback。
- [ ] `buildBrainstormEnsembleRequest()` 对多模型配置返回 advisory-only candidates。
- [ ] `normalizeBrainstormEnsemblePacket()` 保留 agreement、disagreement 和 strong blockers 的语义。
- [ ] `imm-activation-plan --stage brainstorm_ensemble --json` 只输出 dispatch JSON。
- [ ] `dist/imm-brainstorm.md` 记录 Brainstorm authority boundary。
- [ ] Contract tests 覆盖 preset、override、fallback 和 authority 文案。

## 6. Non-goals

- 不新增模型 SDK。
- 不实现投票系统。
- 不让 Brainstorm 写 Spec 或 Plan。
- 不让 runtime 启动 subagent。
- 不扩展到 imm-party 或 imm-work。
