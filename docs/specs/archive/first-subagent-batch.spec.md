# Spec: first subagent batch

**任务 ID**: IMM-BATCH-001
**负责人**: Planner
**状态**: Accepted（验收证据：首批 slice 已有 runtime spec + focused regression；security/api_contract 当前通过 `imm-advisory-reviewer` lenses 可激活，prompt-contract-reviewer/ai-eval-planner/docs-verifier 通过独立 skill surface 可激活；tests/test_skill_contracts.py 通过）

## 1. 目标

定义 Immune-Brain 第一批需要进入 standalone slice 规划的 subagents，范围固定为 4 个：

- `security-reviewer`
- `api-contract-reviewer`
- `ai-eval-planner`
- `docs-verifier`

这 4 个 slice 需要在同一轮规划中完成统一边界锁定：每个 slice 都必须有独立 contract、
最小 activation host 目标、fallback、以及验证路径，但首版仍不实现 registry、自动 dispatch、
多 reviewer 编排或共享平台。

## 2. 问题背景

仓库已经完成 `system-subagents-design` 治理契约、`imm-party` advisory delegation、
以及 `prompt-contract-reviewer` 的 docs-first 与 runtime-host 窄切片。这说明 subagent
规划已经具备可复用模板，但目前仍只有少数命名能力进入了真正可验证的 slice 层。

用户明确要求第一批不再只做单个 slice，而要覆盖：

- 两个跨项目高复用、触发面明确的 conditional-risk reviewers：
  - `security-reviewer`
  - `api-contract-reviewer`
- 两个与当前仓库定位直接相关、fallback 清晰的 project-specific specialists：
  - `ai-eval-planner`
  - `docs-verifier`

当前任务不是执行这 4 个实现，而是先把这 4 个 slice 的 planning boundary 一次锁住，并且保持
每个 slice 仍可独立执行、独立验收。

## 3. 功能需求

### R1. Batch composition

首批 batch 只包含以下 4 个 slice：

- `security-reviewer`
- `api-contract-reviewer`
- `ai-eval-planner`
- `docs-verifier`

本轮不加入：

- `data-integrity-reviewer`
- `reliability-reviewer`
- `release-readiness-checker`
- `debug-investigator`

### R2. Shared slice requirements

4 个 slice 都必须遵守同一组首版要求：

- 有独立、可引用的 standalone contract
- 明确 trigger surface
- 明确 `authority_class`
- 明确 `write_boundary`
- 明确 fallback
- 明确最小 activation host 目标
- 明确 focused regression 与 Codex runtime manual validation 路径

### R3. Conditional-risk slice boundaries

`security-reviewer` 与 `api-contract-reviewer` 必须保持：

- `advisory`
- read-only
- trigger-only
- not default

其 contract 输出分别聚焦：

- `security-reviewer`: exploitable risks、severity、affected surface、required mitigation
- `api-contract-reviewer`: breaking-change risk、compatibility notes、consumer impact

fallback 必须回到现有基础审查链，不得伪装成 dedicated reviewer：

- `security-reviewer`: `imm-code-review` 或当前 active step 的最小修复建议
- `api-contract-reviewer`: `imm-code-review` 与 `imm-planner` / `executor` 的现有 contract 审查链

### R4. Project-specific slice boundaries

`ai-eval-planner` 与 `docs-verifier` 必须保持：

- `advisory`
- read-only
- trigger-only
- not default

其 contract 输出分别聚焦：

- `ai-eval-planner`: eval dimensions、failure modes、reference set suggestion、rubric notes、
  guardrail checks、monitoring notes
- `docs-verifier`: stale docs、missing instructions、source/evidence mismatch

fallback 必须明确且收窄：

- `ai-eval-planner`: `imm-planner` 最小 eval 方案或人工验收路径
- `docs-verifier`: `executor` / `imm-code-review` 在变更范围内手动核对关键文档

### R5. Activation-host intent

每个 slice 的首版都必须定义最小 activation host 目标，推荐为独立本地 skill：

- `imm-advisory-reviewer` `security` lens
- `imm-advisory-reviewer` `api_contract` lens
- `skills/ai-eval-planner/SKILL.md`
- `skills/docs-verifier/SKILL.md`

首版不得为了这 4 个 host：

- 引入通用 runtime registry
- 实现自动 availability detection 平台
- 实现多 reviewer dispatch / composition
- 引入 agent-to-agent 通信
- 引入 benchmark / telemetry / docs publishing 平台

### R6. Verification path

每个 slice 至少要有：

- focused textual regression
- Codex runtime manual validation 场景

batch 级验证只负责证明：

- 4 个 slice 的 planning boundary 已锁定
- 每个 slice 都能独立进入后续执行
- 本轮没有把 scope 扩成 shared platform work

## 4. 验收标准

- [ ] 首批 batch 范围明确固定为 4 个 slice。
- [ ] 每个 slice 都有独立 contract、activation-host 目标、fallback 与验证路径要求。
- [ ] `security-reviewer` 与 `api-contract-reviewer` 保持 conditional-risk、只读、非默认 gate。
- [ ] `ai-eval-planner` 与 `docs-verifier` 保持 project-specific、只读、非默认 gate。
- [ ] batch 计划把 4 个 slice 拆成可独立闭合结果，而不是混成一个大平台任务。
- [ ] 本轮明确排除 registry、dispatch、multi-reviewer composition 与共享基础设施。

## 5. 非目标

- 不实现完整自动调度平台或 runtime registry。
- 不把 4 个 slice 合并成共享 reviewer framework。
- 不加入 `data-integrity-reviewer`、`reliability-reviewer`、`release-readiness-checker`、
  `debug-investigator`。
- 不授予任何 slice 写 spec、写 plan、改代码、改测试或改 workflow state 的权限。
- 不要求本轮证明完整运行时 orchestration。

## 6. 依赖项

- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  作为三层 roster、authority class 与 manifest vocabulary 的来源。
- 依赖 [project-specific-reviewer-contract-slices.md](docs/solutions/project-specific-reviewer-contract-slices.md)
  作为 project-specific slices 的收敛模式。
- 依赖 [dedicated-reviewer-activation-hosts.md](docs/solutions/dedicated-reviewer-activation-hosts.md)
  作为最小 activation host 的收敛模式。
- 依赖现有 `prompt-contract-reviewer` docs/runtime slice，作为相邻参考而不是强绑定依赖。
