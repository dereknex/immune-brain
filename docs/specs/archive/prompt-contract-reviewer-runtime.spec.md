# Spec: prompt-contract-reviewer runtime slice

**任务 ID**: IMM-PROMPT-002
**负责人**: Planner
**状态**: Accepted（验收证据：skills/prompt-contract-reviewer/SKILL.md 提供独立 activation host + advisory-only/trigger-only contract + delegation packet + fallback；docs/solutions/dedicated-reviewer-activation-hosts.md 记录 U1-U3 全步骤验收；tests/test_skill_contracts.py 通过）

## 1. 目标

把 `prompt-contract-reviewer` 从已闭环的 docs-first contract slice，推进成首个真正可激活的
project-specific reviewer runtime slice。

首版只要求一个最小、可验证的 activation host：独立的本地 reviewer skill surface，
用于 AI / agent 项目中的 prompt / tool contract / instruction / structured output /
safety boundary 审查。它仍然保持 `advisory`、只读、trigger-only，不升级成默认 gate，
也不引入通用 subagent registry 或多 reviewer dispatch。

## 2. 问题背景

仓库已经完成两层与本任务直接相关的前置工作：

- `prompt-contract-reviewer` docs-first slice 已把 trigger、manifest-style contract、
  fallback 和 focused textual regression 收口到可验证文档层。
- `imm-party` explicit delegation slice 已证明：对只读 advisory 角色，先交付
  最小 activation path、明确 fallback、并把真实 runtime 验证留在 manual path，比直接做
  registry 或宽平台更稳。

当前缺口在于：`prompt-contract-reviewer` 仍只存在于 README / spec / tests 中，还没有一个
父 orchestrator 或用户可以真实触发的最小 runtime 宿主。结果是它仍然是“被命名的 reviewer”，
而不是“可激活的 reviewer 功能”。

## 3. 功能需求

### R1. Minimal activation host

- 首版必须定义一个最小 activation host，推荐为独立本地 skill：
  `skills/prompt-contract-reviewer/SKILL.md`。
- 该 host 必须可被显式触发，用于 AI / agent 项目中的以下变化面：
  - system prompt
  - tool contract
  - agent instruction
  - structured output schema
  - safety boundary
- 首版不得为了激活这个 reviewer，引入通用 registry、自动 reviewer dispatch，
  或把它塞回 `imm-code-review` / `imm-preplan-review` 里伪装成已有默认能力。

### R2. Advisory-only skill contract

- runtime host 必须保持：
  - `advisory`
  - read-only
  - no tools
  - no code edits
  - no plan writes
  - no workflow-state mutation
  - no QA closure
- skill contract 必须显式声明：
  - 适用场景和不适用场景
  - 必要输入面：`changed_surface`、`context_summary`、`relevant_artifacts`
  - 输出聚焦：
    - instruction conflicts
    - output schema risks
    - safety regressions
  - dedicated reviewer unavailable 时的 fallback 指向：
    `scope-reviewer` + `imm-code-review`

### R3. Trigger-only routing

- `prompt-contract-reviewer` 不得被描述成默认 gate。
- 只有当任务内容、diff 或用户请求明确命中 prompt/tool/instruction/structured output/
  safety boundary 审查时，才应激活这个 reviewer。
- 当当前环境不支持 dedicated reviewer path，或父流程没有这条 skill surface 时，
  输出必须明确这是 fallback，而不是静默假装 reviewer 已存在。

### R4. Verification path

- 本地 focused regression 必须覆盖：
  - reviewer skill surface exists
  - advisory-only / read-only boundary
  - explicit trigger surface
  - fallback wording
  - 非默认 gate posture
- 若 repo 不能自动端到端证明真实 activation / delegation，可接受 Codex runtime
  manual validation，但必须写清 reviewer available / unavailable 两类预期行为。

## 4. 验收标准

- [ ] 存在一个独立、可引用的 `prompt-contract-reviewer` activation host，而不只是文档中的 roster 名称。
- [ ] host contract 明确保持 `advisory`、只读和 trigger-only posture。
- [ ] trigger 面仍收敛在 prompt / tool contract / instruction / structured output / safety boundary。
- [ ] unavailable path 明确回退到 `scope-reviewer` + `imm-code-review`，且不伪装成 dedicated reviewer。
- [ ] focused regression 与 manual runtime validation 至少共同证明：这条 reviewer 已进入可激活功能层。
- [ ] 本切片不引入 registry、自动多 reviewer 调度、agent-to-agent 通信或非 advisory 权限。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不新增 `ai-eval-planner`、`docs-verifier`、`release-readiness-checker` 或
  `debug-investigator` 的 runtime slice。
- 不把 `prompt-contract-reviewer` 升级成默认 gate 或跨项目通用 reviewer。
- 不授予写 plan、改代码、改测试、写 workflow state 的权限。
- 不要求自动化证明所有 runtime activation 细节。

## 6. 依赖项

- 依赖 [prompt-contract-reviewer.spec.md](docs/specs/prompt-contract-reviewer.spec.md)
  作为 docs-first contract 与 fallback 基线。
- 依赖 [imm-party-subagent-delegation.spec.md](docs/specs/imm-party-subagent-delegation.spec.md)
  提供只读 advisory activation、named fallback 与 manual runtime validation 的窄切片模式。
- 依赖 [project-specific-reviewer-contract-slices.md](docs/solutions/project-specific-reviewer-contract-slices.md)
  约束 project-specific reviewer 应先有独立 contract，再有最小 activation host。
- 依赖 [tested-skill-contracts.md](docs/solutions/tested-skill-contracts.md)
  作为 focused regression 的首选收敛方式。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动端到端模拟真实 reviewer activation 时，使用以下人工验证路径：

### Scenario A. reviewer available

1. 在支持项目本地 skill / reviewer activation 的 Codex runtime 中，准备一次明确涉及
   prompt / tool contract / instruction / structured output / safety boundary 的 AI/agent 变更。
2. 显式请求 `prompt-contract-reviewer` 参与审查。
3. 预期行为：
   - reviewer 以独立只读 skill / reviewer surface 被激活；
   - 输出聚焦 instruction conflicts、output schema risks、safety regressions；
   - reviewer 不写 plan、不改代码、不记录 QA 决策；
   - reviewer 不被当作默认 gate，而是只对命中的变化面提供 advisory 结果。

### Scenario B. reviewer unavailable

1. 在当前环境没有 dedicated reviewer path，或父流程未加载该 skill surface 时，触发同类
   AI/agent contract review。
2. 预期行为：
   - 系统不会伪装成已有 dedicated reviewer；
   - fallback 明确回到 `scope-reviewer` + `imm-code-review`；
   - 输出说明这是基础一致性审查，而不是完整等价替代。
