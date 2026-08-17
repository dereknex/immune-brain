# Spec: ai-eval-planner runtime slice

**任务 ID**: IMM-EVAL-002
**负责人**: Planner
**状态**: Accepted（验收证据：skills/ai-eval-planner/SKILL.md 提供独立 activation host + advisory-only/trigger-only contract + delegation packet + fallback；tests/test_skill_contracts.py 通过）

## 1. 目标

把 `ai-eval-planner` 从已闭环的 docs-first contract slice，推进成第一批 subagent activation roadmap
里的首个真正可激活的 project-specific runtime slice。

首版只要求一个最小、可验证的 activation host：独立的本地 specialist skill surface，用于
AI / agent 项目中的 behavior / eval set / rubric / guardrail / monitoring 设计审查。
它仍然保持 `advisory`、只读、trigger-only，不升级成默认 gate，也不引入通用 subagent
registry、shared reviewer runtime 或 automatic dispatch。

## 2. 问题背景

仓库已经完成三层与本任务直接相关的前置工作：

- `ai-eval-planner` docs-first slice 已把 trigger、manifest-style contract、fallback 和
  focused regression 要求收口到可验证文档层。
- `prompt-contract-reviewer` runtime slice 已证明：对 project-specific reviewer，先交付
  最小 activation host、明确 trigger-only routing，并把真实 runtime 验证留在 manual path，
  比直接做 shared runtime 更稳。
- `first-subagent-batch` activation roadmap 已把当前阶段锁定为“逐个推进到可激活使用”，并默认
  由 `ai-eval-planner` 先行，而不是四个 slice 一起进入 runtime。

当前缺口在于：`ai-eval-planner` 仍只存在于 README / spec / tests 的 contract 层，还没有一个
父 orchestrator 或用户可以真实触发的最小 runtime 宿主。结果是它仍然是“被命名的 specialist”，
而不是“可激活的 specialist 功能”。

## 3. 功能需求

### R1. Minimal activation host

- 首版必须定义一个最小 activation host，推荐为独立本地 skill：
  `skills/ai-eval-planner/SKILL.md`。
- 该 host 必须可被显式触发，用于 AI / agent 项目中的以下变化面：
  - model or agent behavior changes
  - eval set or reference set changes
  - rubric or scoring-dimension changes
  - guardrail design changes
  - production monitoring or observable-failure changes
- 首版不得为了激活这个 specialist，引入通用 registry、自动 reviewer dispatch，
  或把它塞回 `imm-planner` / `imm-code-review` 里伪装成已有默认能力。

### R2. Advisory-only skill contract

- runtime host 必须保持：
  - `advisory`
  - read-only
  - no tools
  - no code edits
  - no plan writes
  - no test edits
  - no workflow-state mutation
  - no QA closure
- skill contract 必须显式声明：
  - 适用场景和不适用场景
  - 必要输入面：`behavior_surface`、`success_target`、`relevant_artifacts`
  - 输出聚焦：
    - eval dimensions
    - failure modes
    - reference set suggestion
    - rubric notes
    - guardrail checks
    - monitoring notes
  - dedicated specialist unavailable 时的 fallback 指向：
    `imm-planner` minimal eval plan or manual acceptance path

### R3. Trigger-only routing

- `ai-eval-planner` 不得被描述成默认 gate。
- 只有当任务内容、diff 或用户请求明确命中 behavior / eval set / rubric / guardrail /
  monitoring 设计时，才应激活这个 specialist。
- 当当前环境不支持 dedicated specialist path，或父流程没有这条 skill surface 时，
  输出必须明确这是 fallback，而不是静默假装 specialist 已存在。

### R4. Verification path

- 本地 focused regression 必须覆盖：
  - specialist skill surface exists
  - advisory-only / read-only boundary
  - explicit trigger surface
  - fallback wording
  - 非默认 gate posture
- 若 repo 不能自动端到端证明真实 activation / delegation，可接受 Codex runtime
  manual validation，但必须写清 specialist available / unavailable 两类预期行为。

## 4. 验收标准

- [ ] 存在一个独立、可引用的 `ai-eval-planner` activation host，而不只是文档中的 roster 名称。
- [ ] host contract 明确保持 `advisory`、只读和 trigger-only posture。
- [ ] trigger 面仍收敛在 behavior / eval set / rubric / guardrail / monitoring 变化。
- [ ] unavailable path 明确回退到 `imm-planner` minimal eval plan 或人工验收路径，且不伪装成 dedicated specialist。
- [ ] focused regression 与 manual runtime validation 至少共同证明：这条 specialist 已进入可激活功能层。
- [ ] 本切片不引入 registry、自动多 reviewer 调度、agent-to-agent 通信或非 advisory 权限。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不新增 `docs-verifier`、`security-reviewer`、`api-contract-reviewer` 或
  `release-readiness-checker` 的 runtime slice。
- 不把 `ai-eval-planner` 升级成默认 gate 或跨项目通用 reviewer。
- 不授予写 plan、改代码、改测试、写 workflow state 的权限。
- 不要求自动化证明所有 runtime activation 细节。

## 6. 依赖项

- 依赖 [ai-eval-planner.spec.md](docs/specs/ai-eval-planner.spec.md)
  作为 docs-first contract 与 fallback 基线。
- 依赖 [prompt-contract-reviewer-runtime.spec.md](docs/specs/prompt-contract-reviewer-runtime.spec.md)
  提供 project-specific reviewer 进入最小 activation host 的相邻模板。
- 依赖 [dedicated-reviewer-activation-hosts.md](docs/solutions/dedicated-reviewer-activation-hosts.md)
  约束 project-specific reviewer 应先有独立 contract，再有最小 activation host。
- 依赖 [tested-skill-contracts.md](docs/solutions/tested-skill-contracts.md)
  作为 focused regression 的首选收敛方式。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动端到端模拟真实 specialist activation 时，使用以下人工验证路径：

### Scenario A. specialist available

1. 在支持项目本地 skill / specialist activation 的 Codex runtime 中，准备一次明确涉及
   AI / agent behavior、eval set、rubric、guardrail 或 monitoring 设计变化的任务。
2. 显式请求 `ai-eval-planner` 参与 eval-design 审查。
3. 预期行为：
   - specialist 以独立只读 skill / specialist surface 被激活；
   - 输出聚焦 eval dimensions、failure modes、reference set suggestion、rubric notes、
     guardrail checks 与 monitoring notes；
   - specialist 不写 plan、不改代码、不记录 QA 决策；
   - specialist 不被当作默认 gate，而是只对命中的变化面提供 advisory 结果。

### Scenario B. specialist unavailable

1. 在当前环境没有 dedicated specialist path，或父流程未加载该 skill surface 时，触发同类
   AI / agent eval-design review。
2. 预期行为：
   - 系统不会伪装成已有 dedicated specialist；
   - fallback 明确回到 `imm-planner` minimal eval plan 或人工验收路径；
   - 输出说明这是基础替代，而不是完整等价替代。
