# Spec: Pi Brainstorm Ensemble Host Adapter

**Task ID**: IMM-PI-BRAINSTORM-ADAPTER-001  
**Owner**: imm-planner  
**Status**: Draft

## 1. Goal

让 Pi host 能把 `imm-activation-plan --stage brainstorm_ensemble` 输出的 Brainstorm candidates 转换成可执行的 Pi `Agent` 调用 envelope，并定义父 agent 如何收集结果后交给 `normalizeBrainstormEnsemblePacket` 合成 framing evidence。

## 2. Background

上一轮已完成 Brainstorm ensemble 基础：

- `brainstorm_ensemble` workflow stage
- `buildBrainstormEnsembleRequest`
- `normalizeBrainstormEnsemblePacket`
- `imm-activation-plan --stage brainstorm_ensemble`
- Brainstorm prompt 中的 advisory-only authority contract

现有 dispatch substrate 已支持 Pi `Agent` envelope：

- `buildAdvisoryDispatchEnvelope("pi", ...)` 输出 `primitive: "Agent"`
- Pi call shape 使用 `subagent_type: "general-purpose"`
- Pi 支持 `model`、`inherit_context: false`、`run_in_background: true`
- Pi 没有 readonly 参数；readonly 通过 prompt 的 `tool_policy: no tools` 和 advisory-only boundary 约束

缺口是 Brainstorm-specific adapter：如何从 Brainstorm candidate 构造 prompt、description、Pi envelope，以及如何把 child output 标准化为父 Brainstorm 可合成的 packet。

## 3. Requirements

### R1. Adapter helper

新增 host-facing helper，建议命名：

```ts
buildBrainstormEnsembleDispatchEnvelopes("pi", input)
```

输入包括：

- `request`：`buildBrainstormEnsembleRequest` 或 CLI JSON 等价结构
- `task_summary`
- `shared_context_summary`
- `run_in_background`

输出：

- 每个 candidate 一个 Pi `Agent` envelope
- `ok: false` fallback when host unsupported or request.dispatch false
- 不调用 `Agent` 工具，不启动模型

### R2. Prompt contract

每个 child prompt 必须包含：

- shared task brief
- candidate role，例如 `clarify_scope`、`divergent_options`、`risk_review`
- `tool_policy: no tools`
- `advisory-only; no code edits; no plan writes; no workflow-state mutation; no QA closure`
- fixed output schema：`recommendations`、`disagreements`、`open_questions`、`blockers`

### R3. Pi envelope shape

Pi envelope 必须复用既有 dispatch call shape：

```ts
{
  primitive: "Agent",
  call: {
    subagent_type: "general-purpose",
    description,
    prompt,
    model?,
    inherit_context: false,
    run_in_background: true
  }
}
```

### R4. Policy preservation

Adapter 不得绕过 activation policy。

- `request.dispatch === false` 时不生成 Agent envelopes。
- `candidates: []` 时返回 stable fallback。
- 不重新读取 config，不重新判定 cost gate。
- 只消费已由 activation-plan 生成的 request。

### R5. Parent synthesis contract

父 Brainstorm host 负责：

1. 并行启动 envelopes。
2. 收集 child outputs。
3. 将 child outputs 转为 `normalizeBrainstormEnsemblePacket` 输入。
4. 最终仍由 `imm-brainstorm` 产出 framing 和 manifest。

Runtime helper 只构造 envelope 和 prompt，不拥有 synthesis authority。

## 4. Invariants

- 不新增 provider SDK。
- 不在 runtime 里调用 Pi `Agent`。
- 不写 `.imm/memory/`。
- 不让 child 写 Plan 或 Spec。
- 不改变 Cursor / Codex / code-review dispatch 行为。
- 不实现 browser/UI orchestration。

## 5. Acceptance Criteria

- [ ] Pi envelope helper maps Brainstorm candidates to `Agent` call objects.
- [ ] Prompt contains tool policy, advisory boundary, role, and output schema.
- [ ] `request.dispatch === false` returns no envelopes with stable fallback.
- [ ] Existing `buildAdvisoryDispatchEnvelope("pi")` tests still pass.
- [ ] Contract tests cover model propagation and background execution.
- [ ] Brainstorm docs mention Pi host adapter consumes dispatch JSON but does not give Brainstorm final Plan authority.

## 6. Non-goals

- 不真实调用 `Agent`。
- 不等待或轮询 `get_subagent_result`。
- 不实现 non-Pi host adapters in this slice。
- 不实现 UI for choosing candidates。
- 不扩展 imm-code-review reviewer catalog。
