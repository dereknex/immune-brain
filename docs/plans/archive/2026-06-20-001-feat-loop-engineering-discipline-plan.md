---
title: "feat: adopt loop engineering discipline"
type: feat
status: proposed
date: 2026-06-20
origin: imm-brainstorm framing - user chose total design before executable slices
---

# Iteration Plan

## Task

- Summary: 将 loop engineering 中的 failure exit、structured feedback、loop trace、strategy change 和 budget stop 吸收到 Immune-Brain 的现有 workflow contract 中。
- Spec: docs/specs/archive/loop-engineering-discipline.spec.md
- Origin: 用户要求读取 MindStudio loop engineering 文章并分析 Immune-Brain 差异；随后选择“提炼可吸收改进点”，并确认先写总设计说明再拆执行切片。
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-DEC-001; BR-DEC-002; BR-OUT-001; BR-DEFER-001; BR-Q-001
- Research: `CONTEXT.md` 定义 `Step`、`Executor`、`QA`、`State Ledger` 和 `Compounder` 边界；`IMMUNE.md` 明确 authority 分离、host-bound evidence loops 和 `imm-autowork` deterministic checkpoint runtime；`docs/reference/workflow-and-subagents.md` 描述 `imm-executor`、`imm-qa`、`imm-autowork` 和 subagent 权限；`docs/reference/planning-quality-gate.md` 要求 elevated-risk plan 明确 contract surface、compatibility、interruption recovery、rollback path 和 verification strength；rejected learnings 已明确反对 `imm-autowork-driver`、runtime default QA pass、shared registry、generic dispatcher 和 SQLite/wiki memory authority。
- Decisions: D1 总设计说明落地为 `docs/specs/archive/loop-engineering-discipline.spec.md`，不额外写 `docs/brainstorms/`。D2 当前切片先做 contract adoption：更新 skill contract、repo-facing guidance 和 focused tests。D3 只吸收 failure exit、structured feedback、loop trace、strategy change 和 budget stop。D4 不新增 runtime authority、dispatcher、driver、registry 或 memory plane。D5 后续 machine-readable runtime fields 只作为 Phase 2，必须另开 Plan。
- Assumptions: 现有 `tests/test_skill_contracts.py` 足以承载第一刀 focused contract coverage；当前无需修改 `.imm/imm-autowork.py` 或 State Ledger schema。用户确认 C 后，`BR-Q-001` 由 planner 决定为 “Spec first”。
- Scope Mode: Hold Scope
- Planner research dispatch: solo；这是 workflow contract 单域切片，本地文档和 rejected learnings 已足够拆步。

## Output Language

- Human-readable prose: Chinese
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Manifest

| ID | Item |
|----|------|
| BR-REQ-001 | 写一份总设计说明，先统一方向再拆实现。 |
| BR-REQ-002 | 吸收 loop engineering 的 failure exit、structured feedback、loop trace、budget control。 |
| BR-DEC-001 | 保持 Immune-Brain 的 authority 分离和 Step evidence 闭环。 |
| BR-DEC-002 | 优先文档/契约层增强，再判断是否需要 runtime 变更。 |
| BR-OUT-001 | 不做 shared registry / generic dispatcher / default QA pass。 |
| BR-DEFER-001 | 具体实现拆分、测试矩阵、文件改动留给后续规划。 |
| BR-Q-001 | 总设计说明落地为 `docs/brainstorms/`、`docs/specs/`，还是先只做 `docs/specs/`，需规划阶段决定。 |

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | U1 更新 repo-facing guidance，使总设计说明从 Spec 进入用户可见 workflow contract。 |
| BR-REQ-002 | covered_by_step | U1 | U1 覆盖 failure exit、structured feedback、loop trace、strategy change；U2 继续覆盖 budget control。 |
| BR-DEC-001 | captured_as_decision | D4 | 本 Plan 保持 authority 分离，不新增 runtime authority 或 QA bypass。 |
| BR-DEC-002 | covered_by_step | U1 | 当前切片只做 contract/guidance/test adoption，U1-U3 均保持 runtime fields 延后。 |
| BR-OUT-001 | out_of_scope | D4 | 本 Plan 明确拒绝 shared registry、generic dispatcher、driver 和 default QA pass。 |
| BR-DEFER-001 | covered_by_step | U3 | U3 建立测试矩阵并保留 Phase 2 runtime slice 的后续入口。 |
| BR-Q-001 | resolved_as_assumption | D1 | Planner 决定总设计说明先作为 Spec 落地，避免 brainstorm artifact 与 Spec 重复。 |

## Devil's Advocate Audit

1. **Rollback Resilience**: 当前切片只应触碰 `docs/specs/archive/loop-engineering-discipline.spec.md`、repo-facing workflow guidance、skill contract 文本和 focused tests。若 contract 过重或测试误伤，回退这些文件即可恢复旧行为；不需要 State Ledger migration。
2. **Verification Vanity**: 只检查出现 “loop engineering” 或 “budget” 太弱。验证必须证明 contract 同时包含 failure exit、structured feedback、loop trace、strategy change、budget stop，并继续拒绝 default QA pass、generic dispatcher 和 shared registry。
3. **Spec Dilution Detection**: 用户要求的是先做总设计再拆，不是直接实现 runtime 自动化。Plan 将当前 slice 限定为 contract adoption，并把 runtime signal tightening 明确 defer，避免把设计说明稀释成一组散落 wording tweaks。

## Planning Quality Gate

- contract surface: `docs/specs/archive/loop-engineering-discipline.spec.md`、`README.md`、`docs/reference/workflow-and-subagents.md`、`plugins/immune-brain/dist/imm-executor.md`、`plugins/immune-brain/dist/imm-qa.md`、`plugins/immune-brain/dist/imm-autowork.md`、`tests/test_skill_contracts.py`、本 Plan。
- compatibility: additive contract tightening；不改变 Plan file schema、State Ledger schema、MCP tool schema 或 existing queue behavior。
- interruption recovery: 如果执行中断，已完成的 contract text 和 tests 可通过 focused unittest 重新校验；未同步 runtime state 不影响已有计划。
- rollback path: 回退本 Spec、本 Plan、相关 skill contract/guidance 文案和 focused tests；无需数据迁移。
- verification strength: 使用 `tests/test_skill_contracts.py` focused assertions 加 `imm-plan --json`，避免只靠人工阅读。
- Brainstorm traceability: `BR-*` 全部在 `Brainstorm Trace` 中映射，`BR-Q-001` 已由 D1 resolved。

## Steps

### Step 1

- Step ID: U1
- Result: Executor QA loop discipline contract is documented
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_loop_engineering_executor_qa_contract && python3 .imm/imm-plan.py docs/plans/2026-06-20-001-feat-loop-engineering-discipline-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers failure exit categories; Covers structured tool feedback summary; Covers minimal loop trace from Executor to QA; Covers repeated failure requiring strategy change; Covers repo-facing guidance saying this enhances existing `Step` evidence loop rather than adding a new platform.
- Discovery cache: docs/specs/archive/loop-engineering-discipline.spec.md (accepted design contract); plugins/immune-brain/dist/imm-executor.md (Executor evidence contract); plugins/immune-brain/dist/imm-qa.md (QA rework/replan gate); docs/reference/workflow-and-subagents.md (repo-facing Skill guidance); README.md (main workflow guidance); tests/test_skill_contracts.py (focused contract assertions)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: 如果 required wording 与既有 concise output contract 冲突，保留 concise output，要求 loop trace 是 evidence 摘要而不是完整 transcript。
- security_considerations: 本 Step 不处理 secret 或 auth；主要风险是过度暴露 raw tool output，contract 应鼓励摘要化而不是泄露完整日志。

### Step 2

- Step ID: U2
- Result: Autowork budget stop contract is documented
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_loop_engineering_autowork_budget_contract && python3 .imm/imm-plan.py docs/plans/2026-06-20-001-feat-loop-engineering-discipline-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers explicit opt-in bounded autowork; Covers max Step budget and max rework budget wording; Covers no-progress, tool-failure, missing-input stop semantics; Covers contract preserving no default QA pass and no `imm-autowork-driver`.
- Discovery cache: docs/specs/archive/loop-engineering-discipline.spec.md (budget stop requirements); plugins/immune-brain/dist/imm-autowork.md (autowork skill contract); docs/solutions/rejected-autowork-driver-default-pass.md (rejected boundary); tests/test_skill_contracts.py (focused contract assertions)
- Agent Hint: imm-executor
- Depends on: 1
- failure_behavior: 如果 budget wording implies runtime-only enforcement, stop and reword it as host/skill contract guidance for this slice; do not edit `.imm/imm-autowork.py` in this Step.
- security_considerations: Budget stops must not convert executor verification into QA approval or create hidden state mutation paths.

### Step 3

- Step ID: U3
- Result: Loop discipline rejected boundaries are regression protected
- Verification type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_loop_engineering_rejects_platform_expansion tests.test_skill_contracts.SkillContractTests.test_loop_engineering_executor_qa_contract tests.test_skill_contracts.SkillContractTests.test_loop_engineering_autowork_budget_contract && python3 .imm/imm-plan.py docs/plans/2026-06-20-001-feat-loop-engineering-discipline-plan.md --json`
- Execution note: test-first
- Test scenarios: Covers no shared registry; Covers no generic dispatcher; Covers no SQLite or wiki memory authority; Covers no runtime default QA pass; Covers Phase 2 runtime signal tightening staying deferred unless a future Plan promotes it.
- Discovery cache: docs/specs/archive/loop-engineering-discipline.spec.md (non-goals and roadmap); docs/solutions/rejected-shared-registry-generic-dispatcher.md (rejected dispatcher boundary); docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md (rejected memory boundary); docs/solutions/rejected-autowork-driver-default-pass.md (rejected QA bypass boundary); tests/test_skill_contracts.py (regression surface)
- Agent Hint: imm-executor
- Depends on: 2
- failure_behavior: 如果 rejected boundary assertions require touching runtime files, return to planner; this Step should remain contract-test and guidance only.
- security_considerations: Preserving rejected boundaries protects QA authority and avoids unreviewed cross-host dispatch or memory expansion.

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-20-001-feat-loop-engineering-discipline-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-20-001-feat-loop-engineering-discipline-plan.md --sync`

## Notes

- 当前 Plan 是 Phase 1 contract adoption，不实现 runtime signal tightening。
- 若 Step U1-U3 完成后发现 runtime snapshot 也需要 machine-readable fields，应另开 Phase 2 Plan，并重新评估 migration、compatibility 和 QA authority 风险。
- 验证通过并完成 runtime sync 后，继续通过 `imm-work` 激活 Step 1。
