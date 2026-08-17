# Spec: debug-investigator slice

**任务 ID**: IMM-DBG-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 定义一条 project-specific reviewer slice：`debug-investigator`。
这个 reviewer 面向 incident、tricky bug、复现困难与需要系统性排查的故障场景，
负责输出只读的调查与探针设计结论。

首版只收敛 docs-first manifest contract、fallback 与验证路径；不实现通用 runtime registry，
不把它升级成默认 gate，也不授予任何写 plan、改代码、改测试或改 workflow state 的权限。

## 2. 问题背景

仓库已经完成两层与本任务直接相关的前置工作：

- `system-subagents-design` 已把 `debug-investigator` 放进 project-specific 层，并明确它的存在理由是
  incident 与调查型场景，而不是 steady-state 开发中的通用风险面。
- `prompt-contract-reviewer`、`docs-verifier` 与 `release-readiness-checker` 的相邻 contract work 证明：
  当前 repo 更适合先把 project-specific reviewer 从 roster prose 收敛成 standalone contract，
  再考虑独立 activation host，而不是先做 incident 平台或共享 reviewer framework。

当前缺口在于：`debug-investigator` 虽然已经在 README / spec 里被点名，但还没有一份独立、
可验证、可被后续 planner / reviewer / orchestrator 消费的 contract slice。

## 3. 功能需求

### R1. Trigger boundary

- `debug-investigator` 只在以下变化面被显式触发：
  - incident response scenarios
  - tricky bug investigations
  - hard-to-reproduce failures
  - missing-signal debugging situations
  - hypothesis-driven investigation tasks
- 首版不因为“总会遇到 bug”而默认常驻；必须由任务内容、diff 或故障场景显式触发。

### R2. Docs-first manifest contract

- 首版必须沿用 `system-subagents-design` 已定义的 manifest field vocabulary，至少包含：
  - `id`
  - `version`
  - `role`
  - `trigger`
  - `invocation_stage`
  - `authority_class`
  - `tools_allowed`
  - `write_boundary`
  - `input_schema`
  - `output_schema`
  - `failure_mode`
- `authority_class` 必须保持 `advisory`。
- `write_boundary` 必须保持只读，不允许写 plan、实现代码、测试或 workflow state。

推荐 contract 形状：

```yaml
id: debug-investigator
version: v1
role: Review investigation scenarios for hypotheses, repro paths, missing signals, and next probes
trigger:
  - incident response scenarios
  - tricky bug investigations
  - hard-to-reproduce failures
  - missing-signal debugging situations
  - hypothesis-driven investigation tasks
invocation_stage:
  - review
authority_class: advisory
tools_allowed: []
write_boundary: read-only; no plan writes, no code edits, no test edits, no workflow-state mutation
input_schema:
  changed_surface:
    - incident
    - tricky_bug
    - repro_gap
    - missing_signal
    - investigation_probe
  context_summary: required
  relevant_artifacts:
    - optional diff summary
    - optional issue or symptom notes
    - optional logs or traces
output_schema:
  status: ok | partial | blocked | failed
  summary: string
  hypotheses: []
  repro_path: []
  missing_signals: []
  next_probes: []
  recommendations: []
  risks: []
  confidence: 0.0-1.0
failure_mode:
  unavailable_reviewer: fallback to context-mapper plus imm-code-review plus current-step repro notes
  ambiguous_trigger: do not activate by default; require explicit trigger evidence
```

### R3. Output and fallback

- 输出必须聚焦：
  - hypotheses
  - repro path
  - missing signals
  - next probes
- 当 dedicated reviewer 不可用时，fallback 必须回到：
  - `context-mapper` 的最小上下文梳理；
  - `imm-code-review` 的基础技术审查；以及
  - 当前 active step 的最小 repro notes
- fallback 不得被描述成 dedicated reviewer 的等价完整替代。

### R4. Validation path

- 首版必须至少有一条 focused regression 或可复现检查，证明 contract 字段、trigger 面、
  advisory-only boundary 和 fallback 路径没有只留在文档里。
- 若 repo 无法自动模拟真实 reviewer activation，则 spec 或 plan 必须提供人工 runtime
  验证路径，明确 reviewer available / unavailable 时的预期行为。

## 4. 验收标准

- [ ] `debug-investigator` 有独立、可引用的 docs-first contract slice，而不只是 README 中的一行 roster 描述。
- [ ] trigger 面明确覆盖 incident、tricky bug、repro gap、missing signal、investigation probe 场景。
- [ ] contract 明确保持 `advisory` authority 与只读 write boundary。
- [ ] fallback 明确指向 `context-mapper` + `imm-code-review` + 当前 step repro notes。
- [ ] focused regression 或人工验证路径证明该 reviewer slice 不是纯文档承诺。
- [ ] 本切片不引入 registry、自动 reviewer 派发、incident platform 或执行权限升级。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不把 `debug-investigator` 升级成默认 gate 或所有 bugfix 的常驻 reviewer。
- 不授予写 plan、改代码、改测试、写 workflow state 的权限。
- 不构建日志聚合、可观测性平台或自动化 incident pipeline。

## 6. 依赖项

- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  对 project-specific 层、manifest vocabulary 和 authority boundary 的定义。
- 依赖 [project-specific-reviewer-contract-slices.md](docs/solutions/project-specific-reviewer-contract-slices.md)
  作为 standalone contract + fallback + focused regression 的收敛模式。
- 依赖 [dedicated-reviewer-activation-hosts.md](docs/solutions/dedicated-reviewer-activation-hosts.md)
  作为独立 activation host 的相邻模式。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动模拟真实 reviewer activation 时，使用以下人工验证路径：

### Scenario A. reviewer available

1. 在支持本地 skill / reviewer activation 的 Codex runtime 中，准备一次明确涉及 incident、
   tricky bug、复现困难、missing signal 或 hypothesis-driven investigation 的任务。
2. 显式请求 `debug-investigator` 参与审查。
3. 预期行为：
   - reviewer 只以 `advisory` 身份参与；
   - 输出聚焦 hypotheses、repro path、missing signals、next probes；
   - reviewer 不写 plan、不改代码、不记录 QA 决策。

### Scenario B. reviewer unavailable

1. 在当前环境没有 dedicated reviewer 路径时，触发同类调查型审查。
2. 预期行为：
   - 系统不会伪装成已有 dedicated reviewer；
   - fallback 明确回到 `context-mapper` + `imm-code-review` + 当前 step 的最小 repro notes；
   - 输出应说明这是基础调查替代，而不是完整等价替代。
