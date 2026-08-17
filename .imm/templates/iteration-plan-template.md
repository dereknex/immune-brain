# Iteration Plan

## Task

- Summary: <用一句话描述这次任务>
- Origin: <optional: 来自哪个文档/issue/讨论>
- Research: <本次计划做了哪些调研，结论是什么>
- Decisions: <关键设计决策（编号）及简要理由>
- Assumptions: <尚未验证但接受的假设（可空）>
- Workflow profile: <optional: standard or strict; omitted legacy Plans default to strict>
- Compounder: <optional for standard: optional or required; strict always requires it>
- Plan contract: <optional: roadmap-slice/v1 for the opt-in static successor-ready contract>
- Roadmap source: <optional: docs/specs/... roadmap source when this is a slice of larger work>
- Current phase: <optional: stable Roadmap Phase ID, required by roadmap-slice/v1>
- Plan boundary: <optional: the one coherent executable slice promised by this Plan>
- Boundary rationale: <optional: why outcome, authority, risk, verification, review, and rollback boundaries belong together>
- Scope pressure: <optional: advisory breadth evidence or none; never a fixed workflow/session gate>
- Execution scope: <optional: current executable slice, e.g. Phase 0/1 only>
- Deferred phases: <optional: future phases not executed by this Plan>
- Successor candidate: <optional: zero or one stable Roadmap Phase ID, or none>
- Successor preconditions: <optional: what must hold before the candidate is planned, or none>
- Current-slice warning: <optional: state when this is not the full roadmap implementation Plan>

## Output Language

- Human-readable prose: English
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Steps

Repeat one Step block for each independently closable result. Do not target a fixed
number of steps.

### Step 1

- Step ID: U1
- Result: <当前小步唯一承诺的结果>
- Verification: <如何独立验证这一步已经完成>
- Agent Hint: <可选: spawn_agent 给哪个角色/代理；例如 imm-executor, imm-research, imm-qa>
- Test scenarios: <Covers AE1.、Covers U1.C2 可选的可追踪测试场景，用 ; 分隔>
- Depends on: none

### Step N

- Step ID: U<N>
- Result: <当前小步唯一承诺的结果>
- Verification: <如何独立验证这一步已经完成>
- Agent Hint: <可选: 为上层调度器提供提示，不影响本地流程执行>
- Test scenarios: <Covers AE1.、Covers U1.C2 可选的可追踪测试场景，用 ; 分隔>
- Depends on: <none 或更早步骤编号>

## Notes

- 每个 Step 只能承诺一个结果。
- 如果一个 Step 需要同时完成多个混合目标才能证明价值，继续拆分。
- 如果多个 Step 只是读取、编辑、运行命令或记录同一结果的执行动作，合并回对应结果。
- Step 数量由可独立闭合结果自然决定，不为了满足数量拆分或合并。
- Step granularity 与 Plan granularity 分开判断：独立 authority、risk、verification、promotion、review 或 rollback boundary 应提升为 successor Plan，而不是继续扩大当前 Step。
- `Scope pressure` 只提供 Planner retain-or-split reasoning，不把文件数、token、compaction、耗时或 session 变成硬门禁。
- `Successor candidate` 只是静态 Roadmap Phase 引用，不创建、批准、排队、激活或执行 Plan。
- session 是否延续由用户决定；Plan template 不定义自动 session 行为。
- `Depends on` 只能引用更早的步骤编号，多个依赖用逗号分隔。
- 有明显外部约束或不确定点时，优先补齐 `Research` 与 `Decisions`，避免在 `Work` 阶段临时猜测。
- Roadmap 保存完整记忆，Plan 只承诺当前可执行切片；不要把 deferred phase 当作当前验收。

## Roadmap Continuation

- Preserved deferred content: <optional: discussion points kept for future planning>
- Coverage matrix: <optional: how compound roadmap items map to current steps or deferred work>
- Open questions: <optional: questions blocking later phases>
- Promotion criteria: <optional: what must be true before a deferred phase becomes a Plan>
- Candidate next Plan: <optional: likely next docs/plans/... slice or planning target>
- Explicit non-goals: <optional: roadmap items intentionally not promised by this Plan>
