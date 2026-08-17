> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: data-integrity reviewer runtime slice

**任务 ID**: IMM-DINT-001
**负责人**: Planner
**状态**: Superseded（当前事实：独立 `data-integrity-reviewer` skill surface 已删除；data integrity 审查通过 `imm-advisory-reviewer` 的 `data_integrity` lens 触发）

> Historical note: 本 spec 记录旧的独立 reviewer runtime slice。它不再声明已删除的独立 skill path 是当前 activation host。

## 1. 目标

`data-integrity-reviewer` 的独立 activation host surface 已被
`imm-advisory-reviewer` 的 `data_integrity` lens 取代，并保持 `advisory`、
只读、trigger-only、non-default。

## 2. 问题背景

仓库已完成四类首批 subagent 的 runtime 首刀，并在 `docs-solutions` 与
contract tests 中沉淀了“先单条 host、再验证”的模式。`data-integrity-reviewer`
目前处于能力命名层，没有独立的本地 activation-host。该 reviewer 需要明确
的变更面（数据完整性校验、数据迁移/清理策略、权限边界与持久化面）
才能闭环为最小可激活路径。

## 3. 功能需求

### R1. Minimal activation host

- 当前 runtime 不再定义独立本地 skill；使用 `imm-advisory-reviewer` 的 `data_integrity` lens。
- host 仅用于明确触发场景，不作为默认 gate：
  - schema/data migration 改动
  - 删除/重命名持久化数据路径
  - 数据脱敏/匿名化策略变更
  - 数据一致性边界涉及的重要语义变更
  - 导入导出流程变更
- host 目标是提供可复用的审查 evidence：风险面、影响范围、建议补充验证。

### R2. Advisory-only skill contract

- host contract 必须明确：
  - no tools
  - no code edits
  - no plan writes
  - no test edits
  - no workflow-state mutation
  - no QA closure
- 输出聚焦：
  - data integrity risk
  - migration/contract break risks
  - recovery or rollback建议
- fallback 路径清晰：未提供专用 runtime path 时，回退到 `imm-code-review`
  与当前 step 的最小安全/数据修正 notes，明确它是替代而非等价。

### R3. Trigger-only routing

- 非默认 gate。
- 仅在变更与数据完整性显式命中时触发。
- 当前环境无 dedicated path 时不应伪装成已经可用的 reviewer。

### R4. Verification path

- focused regression（后续通过 `tests/test_skill_contracts.py` 增量）：
  - host 文件存在
  - advisory-only / read-only 边界
  - trigger surface 明确
  - fallback wording 明确
  - 非默认姿态（not default）
- 若自动验证不足，保留 Codex runtime manual validation 场景。

## 4. 验收标准

- [x] 不再存在独立 `data-integrity-reviewer` activation host；当前使用 `imm-advisory-reviewer` 的 `data_integrity` lens。
- [x] lens contract 明确 advisory-only / read-only / trigger-only / non-default。
- [x] fallback 明确指向 `imm-code-review` 与当前 step notes。
- [x] 形成可执行的手动激活预期与 unavailable 预期（两个场景）。
- [x] 不引入 shared registry、multi-reviewer composition、自动分发平台。

## 5. 非目标

- 不同时并入 `api-contract`、`security` 或 `reliability` 的平台化变更。
- 不要求自动扫描、威胁建模平台、agent-to-agent 通信。
- 不在本切片一次性闭合超出本 reviewer 的更多 roster。

## 6. 依赖项

- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  的 conditional-risk 分层与 roster 上下文。
- 依赖 [remaining-first-batch-runtime-activation.spec.md](docs/specs/remaining-first-batch-runtime-activation.spec.md)
  的 runtime-host 进化规则。
- 依赖 [dedicated-reviewer-activation-hosts.md](docs/solutions/dedicated-reviewer-activation-hosts.md)
  与 [conditional-risk-reviewer-activation-hosts.md](docs/solutions/conditional-risk-reviewer-activation-hosts.md)
  的模式约束。
- 依赖 `tests/test_skill_contracts.py`
  和其 future 扩展点。
