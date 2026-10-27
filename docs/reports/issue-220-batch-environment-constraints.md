# #220：当前 Batch 环境约束调查

## 结论

**不应将 #220 视为已被 #273 完全解决；也不应继续按旧架构的五条绝对限制提出修改。** 当前实现已将用户 checkout 与 batch progress 分离，并自动管理新模式的 Lane。应保留保护交付身份、历史可达性和授权边界的约束，重点补足资源归属、清理安全、局部授权变化的隔离，以及现行契约的一致性。

本报告只调查并提出建议，不修改实现、契约、测试或 GitHub Issue。后续变更需另行规划。

## 基线、范围与证据

- Issue：[#220](https://github.com/dereknex/immune-brain/issues/220)。
- 代码基线：`4d2924ce6652f36c2d95140e34fb80898593d58e`，当前 `i220` worktree；调查开始时工作区干净。
- 依赖背景：#219 已 completed，其要求是搬迁契约而非取消约束；#273 已 completed，owner 评论报告交付到 main。关闭状态与历史测试报告不是本次运行验证。
- 方法：读取 Issue 及评论，静态追踪相关 runtime、调用方、ADR、现行 run contract 和已有测试；对关键归属、lineage、清理、resume 分支再次核对源码。
- 范围：原五项及解释它们所必需的关联机制。排除 Review cost、`inspected_paths`、QA execution environment，以及完整 r2 历史审计。
- 未运行测试或实际 batch；下文“已有覆盖”仅表示存在相关测试代码，不表示本次通过。进程占用和 ignored 文件的清理后果没有做动态复现。
- 下文路径和行号均对应上述基线；链接指向文件，行号仅作为定位辅助。

## 用户确认的评判标准

1. 用户已有 checkout、branch、worktree 不得被擅自改动。runtime 自建资源可有固定约定，但需要归属证明、防冲突及清理规则。
2. 强制用户遵守的限制必须保护具体保证，不能仅以实现方便为理由；不默认通过新增配置解决问题。
3. 内部固定名称可以保留；无法证明已有资源属于当前 batch 时拒绝复用，不静默换名。
4. 保留每个 Child 一个最终交付 commit；不承诺永久保留中间历史，但保护未交付工作及必要证据。
5. 不承诺 runtime Parent 被重写后原 batch 仍可继续；不自动做破坏性历史修复。
6. 自建 Lane 清理需要 Executor 不再使用目录、交付和证据已保存。未知 ignored 文件保留并报告；用户提供的外部 Lane 不自动删除。
7. Terminal 约束能力而非产品。自建会话安全结束且必要记录保存后可以关闭；用户已有会话不关闭，用户对话不代答。
8. Child 新验收批准不自动扩大 batch 授权。局部变化暂停该 Child 及依赖者，独立 siblings 保留执行资格；恢复需明确批准受影响的 batch 授权更新。拓扑变化需重新审视整体计划。

## 建议总览

| 原议题 | 当前事实 | 建议 | 主要归属 |
| --- | --- | --- | --- |
| 固定命名、单 Child commit | 新 Parent/Lane 仍固定命名；允许中间 commits，最终单 commit 交付 | 保留内部约定；补足已有资源的归属证明，不新增命名配置 | 名称是环境管理；交付 commit 是交付保证 |
| 外部非 FF HEAD 变化 | 新模式检查 progress ref，不依赖用户 checkout HEAD | 保留 progress lineage 检查；移除将其表述成用户分支禁令的规则 | 交付完整性 |
| 清理由用户负责 | 新 Parent 模式自动清理 Lane；legacy offered Lane 仍走外部清理 | 移除一概禁止自动清理的表述；保留 ownership 区分并补足安全条件 | 环境所有权与数据保护 |
| terminal multiplexer 绑定 | runtime 不启动 terminal；contract 有 Herdr 固定路由和关闭规则冲突 | 移除产品级强制与自建会话绝对不可关闭规则；保留能力要求 | 环境选择与执行隔离 |
| Child revision 令整体失效 | 已区分 scope 与 authority subject；Lane 局部停顿与整体 resume 拒绝并存 | 保留授权和拓扑检查；移除 Child 局部变化对无关 siblings 的不必要阻断 | 授权与交付依赖 |

“移除”是后续改进方向，不表示本次已删除代码。没有一项需要仅为灵活性引入新配置。

## 1. 固定分支名与每个 Child 一个 commit

### 实施位置与当前行为

- [batch_ref.ts](../../plugins/immune-brain/runtime/unattended/batch_ref.ts)：`parentBranchRef`（26–37）生成 `refs/heads/imm/<slug>`；`createBatchRef`（88–107）拒绝已被 checkout 的 Parent，以旧值为零的 CAS 创建 ref；若已有 ref 的 tip 等于 base，则接受为重试。
- [batch_preflight.ts](../../plugins/immune-brain/runtime/unattended/batch_preflight.ts)：约 672 行，新 batch 默认使用 `parentBranchRef`，已有记录保留原 branch。
- [batch_worktrees.ts](../../plugins/immune-brain/runtime/unattended/batch_worktrees.ts)：`createLaneWorktree`（26–45）创建固定 Lane 名称，在 Git common directory 下存放 worktree；已有路径仅在 repository、branch、HEAD、clean 状态匹配时复用。
- [batch_git.ts](../../plugins/immune-brain/runtime/unattended/batch_git.ts)：515–541，允许 Lane 内存在中间 commits，最终构建以 base 为 parent 的单一交付 commit。
- [batch_integration.ts](../../plugins/immune-brain/runtime/unattended/batch_integration.ts)：98–108、208–247，验证交付 commit 为单 parent 且 parent 等于 Lane base。
- 契约：[ADR 0027](../adr/0027-parent-branch-merge-queue.md) Decision 1–3；[imm-run-batch.md](../../plugins/immune-brain/dist/imm-run-batch.md) 的 Unattended Batch Opt-In、Parallel Batch Opt-In。

### 保证与建议

单一交付 commit 保护 Child 交付身份、集成与恢复定位，属于交付保证；固定字符串只是一种环境资源定位约定，不是安全保证本身。

**保留**内部固定命名和单一交付 commit；不要求用户自己的分支采用相同规则，也不要求用户自己的历史只有一个 commit。

**补足**复用时的归属证明：同名、同 tip 只证明内容位置相同，不能独立证明资源属于当前 batch。`createBatchRef` 当前把相同 tip 视为重试，调用链应有与实际 batch 记录相绑定的证明，而不是只依赖命名。无法证明时拒绝，不覆盖、不自动换名。具体证明形式留给后续设计，不在报告中强行引入新 token 系统。

### 影响面与验证

调用方包括 preflight 的 Parent 选择、batch 启动的 ref 创建，以及 `batch_lanes.ts` 的 Lane 创建、commit 和集成流程。重点测试为 [batch-parent-branch.test.ts](../../tests/batch-parent-branch.test.ts) 与 [unattended-batch-lanes.test.ts](../../tests/unattended-batch-lanes.test.ts)。

已有测试覆盖相同 tip 复用、不同 tip 碰撞、单 Child commit、coordinator checkout 不变。后续应区分“本 batch 重试”与“用户同名同 tip 分支”，保证后者没有副作用；保留多中间 commit 到单交付 commit 的行为覆盖。

## 2. 外部非 fast-forward HEAD 变化

### 实施位置与当前行为

- [batch_preflight.ts](../../plugins/immune-brain/runtime/unattended/batch_preflight.ts)：`classifyBatchLineage`（228–301）在 Parent/hidden-ref 模式读取 progress ref；只有 legacy branch 模式依赖当前 checkout branch/HEAD。
- 非 FF、已记录 Child commit 不再可达、或出现冒认本 batch trailer 的未记录 commit，均拒绝；合法 FF 可接受。
- [batch_lanes.ts](../../plugins/immune-brain/runtime/unattended/batch_lanes.ts)：913–928，处理 broken lineage 和 `adopted_heads`；集成通过 `moveBatchRef` CAS 更新。
- 契约：[imm-run-batch.md](../../plugins/immune-brain/dist/imm-run-batch.md) 114–116 明确用户 commits、amends、branch switches 不移动 batch；[ADR 0027](../adr/0027-parent-branch-merge-queue.md) Decision 5 区分最终返回用户 branch 的独立步骤。

### 保证与建议

这保护已记录交付的可达性与真实性，属于交付保证，**保留**。不应将其扩大为禁止用户 amend/rebase 自己的分支。

不承诺用户直接重写 runtime Parent 后仍能续跑。拒绝时保留现场并说明受损 ref；不自动 reset、强推或猜测历史对应关系。最终返回用户分支遇到 dirty/diverged/detached 等情况，应保留 Parent 并报告，而不是强行应用。

### 影响面与验证

影响 runner reconcile、preflight、`batch_ref.ts` 的 CAS 集成，以及自动返回 coordinator 的流程。相关测试：[unattended-batch-commit.test.ts](../../tests/unattended-batch-commit.test.ts)、[unattended-batch-lanes.test.ts](../../tests/unattended-batch-lanes.test.ts)、[batch-parent-branch.test.ts](../../tests/batch-parent-branch.test.ts)。

后续验证应明确区分“用户 checkout 非 FF”与“runtime Parent 非 FF”：前者不应破坏 batch；后者应安全拒绝。还需覆盖已交付 commit 可达性、非法 trailer 和 CAS 竞争。本报告未建立完整动态操作矩阵。

## 3. worktree 与 branch 清理

### 实施位置与当前行为

- [batch_lanes.ts](../../plugins/immune-brain/runtime/unattended/batch_lanes.ts)：1294–1309，新 Parent 模式对 integrated Lane 自动清理，检查 repository、worktree root、clean、branch/head、无 active claim 和 audit 在 Parent 可达；legacy 记录仍保留 offered Lane 路径。
- [batch_worktrees.ts](../../plugins/immune-brain/runtime/unattended/batch_worktrees.ts)：`removeLaneWorktree`（122–135）限制 runtime 目录、拒绝 symlink 和状态不符，使用不带 `--force` 的 worktree remove，再以旧 tip CAS 删除 branch。
- 同文件 `recreateLaneWorktree`（60–95）在 redo 前校验新 base，拒绝 active claim，并通过 `refs/imm/retained/...` 保留新 base 不包含的旧 commit。
- 这些检查没有读取 Executor OS process 或 Herdr tab 状态；Git status 检查也不列出 ignored 文件。redo 注释明确其 ignored Authority Store 可被丢弃。不能把这些事实扩大为“已确认所有被忽略文件都会删除”或“已确认进程退出”。

### 契约冲突

[imm-run-batch.md](../../plugins/immune-brain/dist/imm-run-batch.md) Parallel Batch Opt-In 155–157 描述自动清理 clean、unoccupied Lane；但约 431 行又绝对宣称 runner 不删除 worktree/branch。

[CONTEXT.md](../../CONTEXT.md) Lane 定义约 146 行仍称 runner 只接纳、不创建或删除 Lane；`batch_git.ts`、`batch_integration.ts` 顶部也保留类似绝对注释。[ADR 0027](../adr/0027-parent-branch-merge-queue.md) 已替代旧 worktree 政策。这里需要明确新模式与仍可运行的 legacy 记录，不能简单把所有旧描述当作无用代码删除。

### 保证与建议

**移除**“所有 Lane 都只能用户清理”的绝对规则。**保留**外部用户 Lane 的控制权和现有数据保护检查。

runtime 自建 Lane 可自动清理，但应明确取得 Executor 不再使用该目录的证据，并确认交付及必要记录已保存。无 active claim 不等于无活跃进程；不能把 Git clean 等同于目录中无用户数据。已知 runtime 可丢弃文件可清理，未知 ignored 文件保留并报告。普通 Lane 清理与其他临时验证目录不能不加区分地套用同一结论。

### 影响面与验证

影响 `batch_lanes.ts` 的 release/redo、`batch_worktrees.ts`、Host 的 Executor 生命周期通知、run contract 与相关注释。重点测试：[batch-parent-branch.test.ts](../../tests/batch-parent-branch.test.ts) clean/dirty 清理；[role-prompt-bridge.test.ts](../../tests/role-prompt-bridge.test.ts) 327–353 仍保护旧清理文字；Lane 测试中的 redo/retention 路径。

后续至少覆盖：Executor 仍使用目录时保留；未知 ignored 文件保留；正常安全清理；外部 Lane 不删除；redo 的未集成交付仍可达。更新文字测试应改为保护 ownership 分界，不削弱数据安全检查。

## 4. terminal multiplexer 绑定与会话关闭

### 实施位置与当前行为

- [imm-run-batch.md](../../plugins/immune-brain/dist/imm-run-batch.md) Lane Executor Supervision（277 起）要求独立 Host process、Lane cwd、显式任务入口、事件通知和停止能力。
- 约 310 行路由表指定 Herdr 环境优先使用 Herdr tab；Claude 使用宿主 background execution；Pi 使用用户配置的通知设施；缺失能力时返回 handoff，不偷偷降级为 detached job 或共享 root 的 subagent。
- Herdr Lane Tabs 章节规定由 Parent 操作 CLI，不能代答用户 dialog，Kernel 而非终端输出决定任务进展。
- 路由表 Stop 栏允许关闭自建 tab，但 407、419 附近又禁止关闭任何 tab 或停止任何 session，包括自建会话：这是现行契约内的冲突。
- shared runner 不启动 terminal，只产生 handoff、接收 intervention。Host 入口：[.pi-extension/imm-unattended-batch.ts](../../plugins/immune-brain/.pi-extension/imm-unattended-batch.ts) 与 [runtime/claude/kernel_ports.ts](../../plugins/immune-brain/runtime/claude/kernel_ports.ts)。

### 保证与建议

独立 root、单 Lane 单会话、通知和停止能力保护执行隔离与可管理性；不代答 dialog 保护用户权限。这些保证**保留**。

**移除**永久产品绑定及“自建会话也永远不能关闭”的规则。Herdr 可作为已有默认实现，不因此新增通用 adapter 框架。自建会话安全结束、必要记录已保存后可以关闭；用户会话不关闭。缺失能力时继续明确 handoff，而非静默降级。允许安全关闭不等于允许任意终止仍在写入的 Executor。

### 影响面与验证

主要影响 run contract 和 [role-prompt-bridge.test.ts](../../tests/role-prompt-bridge.test.ts) 303–353；若清理需要新增生命周期证据，也会涉及两个 Host 边界与 runner 消费该证据的位置，具体接口需另行设计。

验证应保护能力等价的启动方式、无能力时不启动、用户会话不被关闭、不代答确认，以及自建会话和 Lane 清理的正确先后关系。文本一致性检查不能替代真实 Host 生命周期验证。

## 5. Child intent revision 与整个 batch 的有效性

### 实施位置与当前行为

- [kernel/intent.ts](../../plugins/immune-brain/runtime/kernel/intent.ts)：300–311，authority subject 包含 task、goal、owner、绑定 Spec 路径、acceptance assertion 与 verification command，不是整个 Intent JSON。
- [kernel/batch_authority.ts](../../plugins/immune-brain/runtime/kernel/batch_authority.ts)：120–142，新 binding 使用 `intent_authority_hash`；旧 binding 仍依赖 revision/content hash。
- [batch_lanes.ts](../../plugins/immune-brain/runtime/unattended/batch_lanes.ts)：512–522、1094–1097、1189–1192、1225–1228，在执行、commit、集成边界隔离 authority subject 变化的 Child。
- [batch_preflight.ts](../../plugins/immune-brain/runtime/unattended/batch_preflight.ts)：451–469、499–560、约 785，拓扑漂移或缺少 topology evidence 拒绝 resume；未 enrolled Child 保留原授权 hash，主体变化在 enrollment 拒绝；已运行 Child 的 coordinator 恢复视图读到主体变化时，仍可能使整体 plan digest 不匹配。
- 契约：[ADR 0028](../adr/0028-scope-as-estimate.md) 规定 scope-only 且绑定 Spec path 不变为 compatible，delegated revision/reseal 已退休；[imm-run-batch.md](../../plugins/immune-brain/dist/imm-run-batch.md) 中 batch 授权与 Child 决策边界需与之保持一致。

### 保证与建议

禁止悄悄改变用户批准的验收目标和依赖图属于授权保证，**保留**。原“任何 revision 都令 batch 失效”的表述已不准确。

**移除**仅由 Child 局部主体变化导致的无关 siblings 整体阻断，统一 Lane 执行与 coordinator resume 的隔离语义。该 Child 及依赖者暂停；独立 siblings 保留执行资格。Child gate 批准新验收不自动修改 batch authorization，恢复须明确批准受影响的授权更新。拓扑变化继续重新审视整体计划；不恢复 coordinator 自批/reseal，不跳过 digest 检查。

这不是要求任意损坏记录都能局部恢复；无法证明独立性或整体授权完整性时，安全拒绝仍合理。

### 影响面与验证

影响 `batch_preflight.ts` 的 resume projection、`batch_lanes.ts` 的 parking/dependency 行为、`kernel/batch_authority.ts` 的绑定更新及 Host 原生批准边界。后续设计需明确授权更新入口，报告不假设现有入口已能完成。

[unattended-batch-lanes.test.ts](../../tests/unattended-batch-lanes.test.ts) 2155–2203 已覆盖 acceptance/argv 变化隔离 Child、独立 sibling 继续；2278 起覆盖 scope-only 不 reseal 且 digest 不变。[batch-delegation-gate.test.ts](../../tests/batch-delegation-gate.test.ts) 保护两个 Host 不再提供 delegation choice。

后续应扩展现有用例覆盖中断后 resume 的等价行为、Child 已批准但 batch 未批准时不得集成、明确批准更新后的恢复，以及拓扑变化仍拒绝。旧 binding 与新主体 binding 分别验证，不以删掉旧测试掩盖仍支持的记录格式。

## 后续规划建议

按风险排序，分别规划，不直接合并为全面重构：

1. **资源安全**：补足同名资源复用的归属证明；确认 Lane 清理的 Executor 生命周期和未知 ignored 文件保护。
2. **契约一致性**：修正现行入口中的自动清理、会话关闭冲突，区分新 Parent 模式与 legacy offered Lane；同步已有文字测试及注释。
3. **局部授权恢复**：统一执行中与 resume 的 Child 隔离语义，设计明确的受影响 batch 授权更新，不扩大 Child gate 权限。

固定内部命名、单一交付 commit、progress lineage 校验无需为了“环境自由”被整体移除。Terminal 以能力为边界即可，不预先建设新的配置或 adapter 抽象。

若后续保留任何临时兼容路径，规划必须给出 owner、退出条件和清理里程碑；本报告不新增兼容机制，也不决定现存 legacy 记录的退休时间。

## 完成与限制

本报告完成原五项的静态实施位置、契约、保证分类、建议及 callers/tests 影响面调查，并记录用户确认的判断标准。未实施建议，未运行测试，未独立复现潜在数据清理问题，未验证实际 Host 会话退出行为，也未关闭或修改 #220。不能将这份报告当作上述改进已经交付或运行安全已经通过验证的证明。
