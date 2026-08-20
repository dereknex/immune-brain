# Spec: default subagent-first activation alignment

**任务 ID**: IMM-SUBAGENT-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把仓库共享 workflow / reviewer contract 的默认 subagent 激活策略，对齐到以下 repo-local truth：

- 当任务可以被清晰拆成边界独立、可并行推进的子任务时，默认优先激活 bounded subagents
- 只有在不可清晰拆分、强耦合阻塞、运行环境不支持、或用户明确要求 solo 时，才 fallback 到 solo
- 继续保留既有 workflow 主链与 authority boundary，不把 subagent 默认化理解成越权执行

首版只修复共享 orchestration / skill contract / focused verification truth，不扩展到新的 runtime dispatcher、后台自动化、shared reviewer platform 或 project-specific skill 全量改写。

## 2. 问题背景

`2026-05-10-032-feat-subagent-activation-audit-plan` 已确认两件事：

- 当前共享 contract 仍以 “conditional trigger + solo default” 为主，而不是 “subagent-first + solo fallback”
- 纯 audit-only step 无法通过现有 `imm-executor -> imm-qa` 生命周期闭环，因为 `.imm/imm-work.py` 的 execution evidence 目前要求至少一个 changed file

因此本轮不再继续只读审计路线，而是收窄为可执行的 contract alignment slice：直接把共享 truth 改到用户要求的默认策略，并保留 focused verification。

## 3. 功能需求

### R1. Default activation policy

- 对共享 workflow / orchestration truth，默认策略应改为：
  - 只要任务可被清晰拆分为 bounded、互不阻塞的子任务，优先激活 subagents
  - 不再把 `multi_domain >= 2`、`risk_high = true`、`artifact_count >= 3` 这类较高门槛作为默认拆分前提
- 保留“bounded”前提：不是无条件 fan-out，也不是为 ceremony 而拆分

### R2. Solo fallback contract

- 以下任一条件成立时，允许或要求 fallback 到 solo：
  - 任务是单一紧耦合执行链，下一步直接依赖上一子任务结果
  - 子任务边界不清晰，拆分会导致重复或冲突
  - 当前环境不支持可靠并行 subagent
  - 用户明确要求 solo
- fallback 需要被写成明确 contract，而不是隐式习惯

### R3. Workflow guard preservation

- `imm-brainstorm -> imm-preplan-review`（conditional）`-> imm-planner -> imm-work -> imm-executor / imm-qa` 主链保持不变
- `imm-work` 仍是 validated plan 后的默认 continue entry
- dedicated reviewer / advisor 仍保持 advisory-only 或 trigger-bounded authority，不得因“默认优先 subagents”而越权为 scope、execution 或 QA owner

### R4. Shared surface alignment

- 以下共享 contract surface 需要对齐到新 truth：
  - `.imm/specs/workflow-skill-subagent-orchestration.spec.md`
  - `.imm/specs/skill-trigger-template-routing.spec.md`
  - `skills/imm-brainstorm/SKILL.md`
  - `skills/imm-preplan-review/SKILL.md`
  - `skills/imm-planner/SKILL.md`
  - `skills/imm-work/SKILL.md`
  - `skills/imm-code-review/SKILL.md`
  - `imm-advisory-reviewer` `security` lens
  - `imm-advisory-reviewer` `api_contract` lens
  - 必要时 `README.md`

### R5. Verification path

- focused verification 至少要证明：
  - 共享 contract 默认表达为 subagent-first，而不是 solo-first
  - solo fallback 条件被明确列出
  - workflow 主链和 authority boundary 未被破坏
  - dedicated reviewer 仍然保持 bounded / advisory / non-default-gate 语义

## 4. 验收标准

- [ ] 共享 orchestration / routing spec 已明确采用 “default subagent-first, fallback solo” truth。
- [ ] 核心 workflow skills 与 reviewer skills 的默认激活描述一致。
- [ ] `imm-work` 的默认 continue entry 与 authority boundary 未被放宽。
- [ ] focused contract verification 能约束新的默认策略，防止回漂到 solo-first。

## 5. 非目标

- 不实现新的 runtime scheduler、dispatcher、后台 autowork、或 agent-to-agent 通信。
- 不把所有 project-specific skills 一次性全部纳入同一轮修复。
- 不在本轮修改 `.imm/memory/current_iteration.json`、`imm-work` runtime state machine、或 no-op evidence 机制。
- 不把 dedicated reviewer 变成无条件 gate。

## 6. 依赖项

- 依赖 [IMMUNE.md](IMMUNE.md) 的 workflow chain 与 authority boundary。
- 依赖 [workflow-skill-subagent-orchestration.spec.md](docs/specs/workflow-skill-subagent-orchestration.spec.md) 的现有 orchestration truth。
- 依赖 [skill-trigger-template-routing.spec.md](docs/specs/skill-trigger-template-routing.spec.md) 的共享路由 truth。
- 依赖 `2026-05-10-032-feat-subagent-activation-audit-plan` 的 replan 结论：当前 slice 不能继续停留在只读审计形态。
