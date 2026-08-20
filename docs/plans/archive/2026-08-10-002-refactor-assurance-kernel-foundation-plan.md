# Iteration Plan

## Task

- Summary: 执行 Assurance Kernel v4 程序的第一个可执行切片——修复 v3 replan 死锁（P0 止血），并以 additive-only 方式落地 v4 内核核心与 shadow 观测面（P1 内核基础），不切换任何生产行为。
- Origin: 用户要求对 Immune-Brain 流程僵化进行根因分析与重大重构；本会话完成 runtime 静态勘察、3 天 Pi session 取证（79 sessions / 19 项目）、两次独立 advisory review（reliability 与 simplification-risk 双 `conditional_go`），并就「state 按所有权拆分存储」达成方向结论。
- Spec: `docs/specs/assurance-kernel-v4.spec.md`
- Scope Mode: New Slice（roadmap-slice/v1）

## Output Language

- Human-readable prose: Chinese
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Roadmap Slice

- Plan contract: roadmap-slice/v1
- Roadmap source: `docs/specs/assurance-kernel-v4.spec.md` 第 5 节（P0–P4）
- Execution scope: P0（replan 死锁 hotfix）+ P1（kernel 核心、per-task 存储、journal、dry-run migrator、shadow CLI）
- Deferred phases: P2 受管切换、P3 迁移执行与 routine 采纳、P4 清理退出——均为非 executable，需后续 Plan 晋升
- Current phase: P0+P1 止血与内核基础
- Plan boundary: 本 Plan 只交付「v3 行为不变的止血修复 + 纯新增的内核与观测面」；不改变任何生产命令的路由或持久化语义
- Boundary rationale: P0 hotfix 与 P1 内核共享同一 authority 边界（`plugins/immune-brain/runtime`）、同一 review 边界（本仓库代码评审）与同一回滚边界（逐 Step git revert / 删除新增文件）；P2 cutover 涉及生产行为切换与迁移批准，属独立 authority，按 Plan Boundary Discipline 拆为后续 Plan
- Scope pressure: U3 单 Step 覆盖 CLI、存储、journal、migrator 四个新增面，但它们共享「shadow 可观测且 v3 零影响」这一个可闭合结果；测试面与生产面严格分离
- Successor candidate: P2 受管切换 Plan（advisory only）
- Successor preconditions: 本 Plan 全部 Step closed；shadow 与 v3 在真实仓库并行运行产生可审计的分歧报告；迁移 dry-run 报告经用户批准
- Current-slice warning: 这不是完整 roadmap 的实现 Plan；P2–P4 的 acceptance 在本 Plan 中不可执行

## Research

- 已复现错位（本会话临时项目真实 CLI）：QA replan 后 `Step.state=replanning` + `requires_replan=false` + `runtime_status=idle`，`buildStatus()` 却投影 `next_action=activate Step 1`，而 `replanning -> active` 非法。相关代码：`plugins/immune-brain/runtime/state_ledger.ts`（`reviewReplan` L594-602、`VALID_TRANSITIONS` L33-47）、`plugins/immune-brain/runtime/immune_brain_runtime.ts`（`buildStatus()` L566-600）、`plugins/immune-brain/runtime/commands/plan.ts`（semantic sync 拒绝 L351-371）。
- replan checkpoint 声称 `allowed_actions: ["revise_plan"]` 但 same-Plan semantic sync 在执行开始后被 signature 锁拒绝，cross-Plan sync 要求前序 finish——恢复只能用户 terminate/supersede。
- Session 取证：17/79 sessions 重复加载 planner 2-13 次；`idle` 过载迫使 agent 读原始 Ledger；`imm-finish` 清场阻塞后继规划。
- 单一 state 文件 `.imm/memory/current_iteration.json` 在本仓库被 git 跟踪，跨 worktree merge 冲突、单 worktree 多 pane 锁竞争（`withLedgerWriteLock` 无 backoff）。
- 既有观测只在成功 `imm-finish` 后写 insight，失败/拒绝/重试路径不可见。
- 两次独立 advisory review 结论：kernel 方向 `conditional_go`，阻断条件为 journal 补缺（F1）、review 循环升级规则（F3）、single-working 不变量显式化（F4）、legacy 保守映射（F6），全部已并入 Spec 第 4 节。

## Decisions

- D1: P0 hotfix 保持 v3 语义最小改动——`reviewReplan` 一致地持久化 `requires_replan=true`，`buildStatus()` 只投影合法 next_action（指向用户 terminate/supersede 路径），不新增状态、不放开 `replanning` 出边。
- D2: kernel 核心为纯函数模块（`runtime/kernel/`），输入 record + 当前 diff 上下文，输出派生投影；不做 IO，不依赖 v3 Ledger 内部结构。
- D3: 存储布局按 Spec 4.2：intent sidecar git 跟踪，`.imm/tasks/`、`.imm/workspace.json`、`.imm/journal.jsonl` worktree 本地且 gitignore。
- D4: migrator 本切片只做 `--dry-run`：输出逐记录映射与歧义报告，歧义记录 fail closed，不写任何目标文件。
- D5: journal 从本切片开始记录全量命令结果（含拒绝与 reason_code），但永不参与 gate。
- D6: shadow CLI（`imm-kernel`）全部只读 v3 状态；v3 生产命令路由零变化。
- D7: CONTEXT.md 词汇更新（TaskRecord、Intent sidecar、Assurance Kernel 等）推迟到 P2 cutover，避免当前 runtime 文档描述未来概念。

## Assumptions

- v3 仍是生产 runtime，直到 P2 经用户批准的单独 Plan 切换。
- 本仓库 `.imm/` 的 git 跟踪现状只对本切片新增文件按 D3 处理；存量 `current_iteration.json` 的跟踪状态调整属于 P3。
- kernel 模块测试放置于 repo 根 `tests/`（与既有 runtime 行为测试一致）。

## Devil's Advocate Audit

### 1. Rollback Resilience

- U1 触碰 v3 生产转换：单 commit 原子落地，回滚 = git revert；其余 v3 语义不变。
- U2/U3 纯新增：回滚 = 删除新增文件与 `.gitignore` 条目，v3 零依赖。
- 中途停止安全性：U2/U3 不写 v3 Ledger，任何中途状态不会污染生产状态；U1 若部分应用，测试套件（含重启回归）必然 RED，无法静默通过。

### 2. Verification Vanity

- U1 的重启回归测试以真实复现的矛盾 fixture 断言持久状态一致性与 next_action 合法性——对目标回归必然失败，而非证明文本存在。
- U2 fixture 必须包含从真实 bug 提取的矛盾状态与 property 测试（派生投影幂等、不变量违例必拒绝）。
- U3 测试断言「shadow 与 v3 的分歧如实报告」，构造注入分歧的 fixture 使谄媚实现（永远报一致）失败。

### 3. Spec Dilution Detection

- 未稀释项核对：journal 必须记录拒绝路径（Spec G4，不只成功）；migrator 歧义 fail closed（Spec 4.7/4.8，不猜测）；single-working 不变量在 workspace.json CAS 层有据（Spec 4.5）；shadow 只读（D6）。任何一项缺失则对应 Step 不得 closed。

## Steps

### Step 1

- Step ID: U1
- Result: QA replan 后的持久化状态在重启后保持一致，status 投影的 next_action 仅包含合法转换。
- Scope: `plugins/immune-brain/runtime/state_ledger.ts`; `plugins/immune-brain/runtime/immune_brain_runtime.ts`; `plugins/immune-brain/runtime/commands/review.ts`; `tests/replan-recovery-runtime.test.ts`
- Verification: `bun test tests/replan-recovery-runtime.test.ts tests/runtime-state.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-002-refactor-assurance-kernel-foundation-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first
- Discovery cache: `plugins/immune-brain/runtime/state_ledger.ts` (VALID_TRANSITIONS 与 reviewReplan 持久化路径); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (buildStatus next_action 投影); `plugins/immune-brain/runtime/commands/plan.ts` (sync 拒绝路径，确认 next_action 文案指向合法恢复命令)
- failure_behavior: 若一致化 requires_replan 会破坏既有 follow-up 或 termination 测试，停止并回报 Planner，不得通过放宽既有断言让测试转绿。
- security_considerations: 无新增攻击面；仅收紧 status 投影的合法性。

### Step 2

- Step ID: U2
- Result: v4 kernel 核心模块以纯函数从唯一 phase 权威确定性地派生任务生命周期真相。
- Scope: `plugins/immune-brain/runtime/kernel/`; `tests/kernel-core.test.ts`
- Verification: `bun test tests/kernel-core.test.ts && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-002-refactor-assurance-kernel-foundation-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: none
- Execution note: test-first
- Discovery cache: `docs/specs/assurance-kernel-v4.spec.md` (4.1-4.5 权威模型、schema、phase 机、完成谓词、升级规则的唯一设计基线); `plugins/immune-brain/runtime/loop_contract.ts` (既有 decision payload 形状，供 Finding/Approval 类型对齐参考)
- failure_behavior: kernel 为纯函数无 IO；任何不变量违例必须抛出结构化错误，不得返回降级投影。
- security_considerations: schema 校验拒绝未知字段与非法枚举，防止后续 CLI 层把未校验输入写入 record。

### Step 3

- Step ID: U3
- Result: 操作者可通过只读 `imm-kernel` CLI 检查 v4 shadow 投影、journal 与迁移 dry-run 报告，且 v3 生产行为无任何变化。
- Scope: `plugins/immune-brain/runtime/kernel/`; `plugins/immune-brain/runtime/commands/`; `plugins/immune-brain/bin/imm-kernel`; `tests/kernel-shadow-cli.test.ts`; `tests/kernel-migrate.test.ts`; `.gitignore`
- Verification: `bun test tests/kernel-shadow-cli.test.ts tests/kernel-migrate.test.ts tests/runtime-state.test.ts && plugins/immune-brain/bin/imm-kernel status --json && plugins/immune-brain/bin/imm-kernel migrate --dry-run --json && plugins/immune-brain/bin/imm-plan docs/plans/2026-08-10-002-refactor-assurance-kernel-foundation-plan.md --json && git diff --check`
- Verification type: automated
- Depends on: 2
- Discovery cache: `plugins/immune-brain/runtime/state_ledger.ts` (withLedgerWriteLock/CAS 原语，供 workspace.json 与 TaskRecord 写入复用); `plugins/immune-brain/runtime/project_migration.ts` (既有 legacy 格式唯一解释器，migrator 读取复用); `plugins/immune-brain/runtime/immune_brain_runtime.ts` (CLI router 注册模式); `plugins/immune-brain/bin/imm-work` (bin wrapper 模式)
- failure_behavior: journal 写入失败不阻断主命令（降级为 stderr 警告）；migrator 遇歧义记录输出报告并以结构化字段标记 `ambiguous`，绝不猜测映射；shadow 读取 v3 Ledger 失败时如实报错，不合成状态。
- security_considerations: migrator 与 status 读取 `.imm/` 路径时做 canonical root 约束与符号链接校验（对齐 progress_projection/v1 既有防护）。

## Test scenarios

- T1 (U1): 构造 QA replan 场景，断言 `Step.state=replanning` 与 `requires_replan=true` 同时持久化；进程重启后 `buildStatus()` 的 next_action 不含 `activate` 该 Step，且包含指向 terminate/supersede 的合法恢复指引；`replanning -> active` 仍被拒绝。
- T2 (U1): 既有 follow-up、termination、autowork 测试套件不回归。
- T3 (U2): 完成谓词对 fresh/stale evidence、缺失 approval、blocking finding、未解决用户决策的每一种组合给出确定性布尔结果；review 循环满 2 轮自动升级为 unresolved user decision。
- T4 (U2): 真实 bug 矛盾 fixture（replanning + idle + active_step=null）经 legacy 映射函数产出 `stopped("legacy-inconsistent")`，绝不产出可激活状态。
- T5 (U2): 派生投影幂等性与「phase 之外无持久化权威」的 property 测试。
- T6 (U3): shadow status 对注入分歧的 fixture 如实报告 divergence 字段；对一致 fixture 报告 match；v3 测试套件全绿证明零生产影响。
- T7 (U3): migrator dry-run 对本仓库当前 Ledger 与构造的各 legacy 状态 fixture 输出确定性逐记录映射报告；歧义记录 `ambiguous: true` 且不写任何文件。
- T8 (U3): journal 对一条故意被拒绝的命令（非法转换）记录 `result=rejected` 与 reason_code；`.gitignore` 覆盖 `.imm/tasks/`、`.imm/workspace.json`、`.imm/journal.jsonl`。
