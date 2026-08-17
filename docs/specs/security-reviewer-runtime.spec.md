# Spec: security-reviewer runtime slice

**任务 ID**: IMM-SEC-002
**负责人**: Planner
**状态**: Superseded（当前事实：独立 `security-reviewer` skill surface 已删除；security 审查通过 `imm-advisory-reviewer` 的 `security` lens 触发）

> Historical note: 本 spec 记录旧的独立 reviewer runtime slice。它不再声明已删除的独立 skill path 是当前 activation host。

## 1. 目标

把 `security-reviewer` 从已闭环的 docs-first contract slice，推进成第一条真正可激活的
conditional-risk reviewer runtime slice。

当前 activation host 已合并到 `imm-advisory-reviewer`，security-sensitive changes 通过
`security` lens 审查。它仍然保持 `advisory`、只读、trigger-only，不升级成默认 gate。

## 2. 问题背景

仓库已经完成三层与本任务直接相关的前置工作：

- `security-reviewer` docs-first slice 已把 trigger、manifest-style contract、fallback 和
  focused regression 要求收口到可验证文档层。
- `prompt-contract-reviewer`、`ai-eval-planner` 与 `docs-verifier` runtime slices 已证明：
  对 reviewer，先交付最小 activation host、明确 trigger-only routing，并把真实 runtime 验证留在
  manual path，比直接做 shared runtime 更稳。
- `remaining-first-batch-runtime-activation` 已把当前阶段锁定为：补齐首批中尚未可激活的
  conditional-risk reviewers，而不是继续扩 roster 或 shared platform。

当前缺口在于：`security-reviewer` 仍只存在于 README / spec / plan 的 contract 层，还没有一个
父 orchestrator 或用户可以真实触发的最小 runtime 宿主。结果是它仍然是“被命名的 reviewer”，
而不是“可激活的 reviewer 功能”。

## 3. 功能需求

### R1. Minimal activation host

- 当前 runtime 不再定义独立本地 skill；使用 `imm-advisory-reviewer` 的 `security` lens。
- 该 host 必须可被显式触发，用于以下变化面：
  - authentication changes
  - authorization changes
  - input validation or deserialization changes
  - public endpoints or externally reachable surfaces
  - secrets handling or credential flow changes
  - permission model or access policy changes
  - security-sensitive configuration changes
- 首版不得为了激活这个 reviewer，引入通用 registry、自动 reviewer dispatch，
  或把它塞回 `imm-code-review` / `imm-executor` 里伪装成已有默认能力。

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
  - 必要输入面：`changed_surface`、`context_summary`、`relevant_artifacts`
  - 输出聚焦：
    - exploitable risks
    - severity
    - affected surface
    - required mitigation
  - dedicated reviewer unavailable 时的 fallback 指向：
    `imm-code-review` plus current step security notes

### R3. Trigger-only routing

- `security-reviewer` 不得被描述成默认 gate。
- 只有当任务内容、diff 或用户请求明确命中 auth / authz / input handling / public endpoint /
  secret flow / permission model / security config 审查时，才应激活这个 reviewer。
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

- [x] 不再存在独立 `security-reviewer` activation host；当前使用 `imm-advisory-reviewer` 的 `security` lens。
- [x] lens contract 明确保持 `advisory`、只读和 trigger-only posture。
- [ ] trigger 面仍收敛在 auth / authz / input handling / public endpoint / secret flow /
      permission model / security config 变化。
- [x] unavailable path 明确回退到 `imm-code-review` 与当前 step 的最小 security notes，
      且不伪装成 dedicated reviewer。
- [x] focused regression 与 manual runtime validation 至少共同证明：该 lens 已进入可激活功能层。
- [x] 本切片不引入 registry、自动多 reviewer 调度、agent-to-agent 通信或非 advisory 权限。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不新增 `api-contract-reviewer`、`data-integrity-reviewer`、`reliability-reviewer` 或
  `debug-investigator` 的 runtime slice。
- 不把 `security-reviewer` 升级成默认 gate 或所有安全相关变更的常驻 reviewer。
- 不授予写 plan、改代码、改测试、写 workflow state 的权限。
- 不构建 threat-model platform、scanner integration 或 exploit harness。

## 6. 依赖项

- 依赖 [security-reviewer.spec.md](docs/specs/security-reviewer.spec.md)
  作为 docs-first contract 与 fallback 基线。
- 依赖 [prompt-contract-reviewer-runtime.spec.md](docs/specs/prompt-contract-reviewer-runtime.spec.md)
  与 [docs-verifier-runtime.spec.md](docs/specs/docs-verifier-runtime.spec.md)
  提供 reviewer 进入最小 activation host 的相邻模板。
- 依赖 [dedicated-reviewer-activation-hosts.md](docs/solutions/dedicated-reviewer-activation-hosts.md)
  约束 reviewer 应先有独立 contract，再有最小 activation host。
- 依赖 [tested-skill-contracts.md](docs/solutions/tested-skill-contracts.md)
  作为 focused regression 的首选收敛方式。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动端到端模拟真实 reviewer activation 时，使用以下人工验证路径：

### Scenario A. reviewer available

1. 在支持项目本地 skill / reviewer activation 的 Codex runtime 中，准备一次明确涉及
   auth、authz、input handling、public endpoint、secret flow、permission model 或
   security config 变化的任务。
2. 显式请求 `security-reviewer` 参与审查。
3. 预期行为：
   - reviewer 以独立只读 skill / reviewer surface 被激活；
   - 输出聚焦 exploitable risks、severity、affected surface、required mitigation；
   - reviewer 不写 plan、不改代码、不记录 QA 决策；
   - reviewer 不被当作默认 gate，而是只对命中的变化面提供 advisory 结果。

### Scenario B. reviewer unavailable

1. 在当前环境没有 dedicated reviewer path，或父流程未加载该 skill surface 时，触发同类
   security-sensitive review。
2. 预期行为：
   - 系统不会伪装成已有 dedicated reviewer；
   - fallback 明确回到 `imm-code-review` 与当前 step 的最小 security notes；
   - 输出说明这是基础安全审查，而不是完整等价替代。
