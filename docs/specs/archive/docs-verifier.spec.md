# Spec: docs-verifier slice

**任务 ID**: IMM-DOCS-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 定义一条 project-specific reviewer slice：`docs-verifier`。
这个 reviewer 面向用户文档、README、操作手册、公开说明与使用方式变化，负责输出只读的文档一致性审查结论。

首版只收敛 docs-first manifest contract、fallback 与验证路径；不实现通用 runtime registry，
不把它升级成默认 gate，也不授予任何写 plan、改代码、改测试或改 workflow state 的权限。

## 2. 问题背景

仓库已经完成两层与本任务直接相关的前置工作：

- `system-subagents-design` 已把 `docs-verifier` 放进 project-specific 层，并明确它的存在理由是
  public surface 与 docs burden，而不是所有任务共享的风险面。
- `prompt-contract-reviewer` 与 `ai-eval-planner` 的相邻 contract work 证明：当前 repo 更适合先把
  project-specific reviewer 从 roster prose 收敛成 standalone contract，再考虑独立 activation host，
  而不是先做 docs pipeline、发布系统或共享 reviewer framework。

当前缺口在于：`docs-verifier` 虽然已经在 README / spec 里被点名，但还没有一份独立、可验证、
可被后续 planner / reviewer / orchestrator 消费的 contract slice。

## 3. 功能需求

### R1. Trigger boundary

- `docs-verifier` 只在以下变化面被显式触发：
  - README changes that affect user behavior
  - user-facing documentation changes
  - operator or setup instructions changes
  - public usage examples or command examples changes
  - behavior changes that require docs updates
- 首版不因为“有文档”而默认常驻；必须由任务内容、diff 或交付面显式触发。

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
id: docs-verifier
version: v1
role: Review user-facing documentation changes for stale guidance and source-evidence mismatch
trigger:
  - README changes
  - user-facing documentation changes
  - setup or operator instruction changes
  - public usage example changes
  - behavior changes requiring docs updates
invocation_stage:
  - review
authority_class: advisory
tools_allowed: []
write_boundary: read-only; no plan writes, no code edits, no test edits, no workflow-state mutation
input_schema:
  changed_surface:
    - readme
    - user_docs
    - setup_instructions
    - usage_examples
    - behavior_to_docs_delta
  context_summary: required
  relevant_artifacts:
    - optional diff summary
    - optional spec or README references
    - optional screenshots or command excerpts
output_schema:
  status: ok | partial | blocked | failed
  summary: string
  stale_docs: []
  missing_instructions: []
  source_evidence_mismatch: []
  recommendations: []
  risks: []
  confidence: 0.0-1.0
failure_mode:
  unavailable_reviewer: fallback to executor or imm-code-review manual docs check
  ambiguous_trigger: do not activate by default; require explicit trigger evidence
```

### R3. Output and fallback

- 输出必须聚焦：
  - stale docs
  - missing instructions
  - source/evidence mismatch
- 当 dedicated reviewer 不可用时，fallback 必须回到：
  - `executor` 在当前变更范围内手动核对关键文档；或
  - `imm-code-review` 做基础文档一致性检查
- fallback 不得被描述成 dedicated reviewer 的等价完整替代。

### R4. Validation path

- 首版必须至少有一条 focused regression 或可复现检查，证明 contract 字段、trigger 面、
  advisory-only boundary 和 fallback 路径没有只留在文档里。
- 若 repo 无法自动模拟真实 reviewer activation，则 spec 或 plan 必须提供人工 runtime
  验证路径，明确 reviewer available / unavailable 时的预期行为。

## 4. 验收标准

- [ ] `docs-verifier` 有独立、可引用的 docs-first contract slice，而不只是 README 中的一行 roster 描述。
- [ ] trigger 面明确覆盖 README、用户文档、setup instructions、usage examples、behavior-to-docs delta 变化。
- [ ] contract 明确保持 `advisory` authority 与只读 write boundary。
- [ ] fallback 明确指向 `executor` / `imm-code-review` 的手动 docs check 路径。
- [ ] focused regression 或人工验证路径证明该 reviewer slice 不是纯文档承诺。
- [ ] 本切片不引入 registry、自动 reviewer 派发、docs pipeline 或执行权限升级。

## 5. 非目标

- 不实现通用 system subagent runtime registry。
- 不把 `docs-verifier` 升级成默认 gate 或所有文档变更的常驻 reviewer。
- 不授予写 plan、改代码、改测试、写 workflow state 的权限。
- 不构建 docs build/publish pipeline、public docs index 或 release-notes framework。
- 不与 `security-reviewer`、`api-contract-reviewer`、`ai-eval-planner` 打包成交付。

## 6. 依赖项

- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  对 project-specific 层、manifest vocabulary 和 authority boundary 的定义。
- 依赖 [project-specific-reviewer-contract-slices.md](docs/solutions/project-specific-reviewer-contract-slices.md)
  作为 standalone contract + fallback + focused regression 的收敛模式。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动模拟真实 reviewer activation 时，使用以下人工验证路径：

### Scenario A. reviewer available

1. 在支持本地 skill / reviewer activation 的 Codex runtime 中，准备一次明确涉及 README、
   用户文档、setup instructions、usage examples 或 behavior-to-docs delta 的任务。
2. 显式请求 `docs-verifier` 参与审查。
3. 预期行为：
   - reviewer 只以 `advisory` 身份参与；
   - 输出聚焦 stale docs、missing instructions、source/evidence mismatch；
   - reviewer 不写 plan、不改代码、不记录 QA 决策。

### Scenario B. reviewer unavailable

1. 在当前环境没有 dedicated reviewer 路径时，触发同类 docs consistency review。
2. 预期行为：
   - 系统不会伪装成已有 dedicated reviewer；
   - fallback 明确回到 `executor` / `imm-code-review` 的手动 docs check；
   - 输出应说明这是基础文档核对，而不是完整等价替代。
