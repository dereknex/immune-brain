# Immune-Brain 架构梳理：Pragmatic Clean Boundaries

**Status**: Advisory analysis. Not a Spec, not enrolled, grants no authority.
**Snapshot**: Git HEAD `5575a38f11e` + working tree (uncommitted changes included), 2026-11-05.
**Analysis hash**: `sha256:ef7ebd8fb78f320e7f6a610a0fb19f3f8d10733779a108fb11ef5652f438b436` (over `runtime/` + `.pi-extension/` 129 个 `.ts` 文件内容与路径)。

## 结论

Immune-Brain 不需要"引入 Clean Architecture"——它已经具备 Clean Architecture 最难的两件事：**单一权威源**（一个 Kernel、一个 SQLite authority、Git 只拥有代码身份）和**一个真实存在的端口**（`assurance/host_port.ts`，Pi / Claude Code / Antigravity 三个适配器）。这两个决定比任何分层图都值钱，并且由 ADR-0004、ADR-0010 锁定。

真正的问题不是"层不够多"，而是**层的位置与依赖方向有 6 处具体错误**，其中最关键的一处正好印证了你说的第一点：

> 纯粹的领域 reducer（`kernel/reducer.ts`，0 行 I/O、注释断言"Never reads files, Git, workspace, or host context"）的**传递闭包是 19 个文件，并经由一条 4 文件环最终到达 `node:sqlite`**。Agent 要安全修改它，理论上必须读完整个 authority 存储层。

129 个文件里只有 60 个直接持有 I/O，中位数文件的闭包只有 4 个——说明**大部分模块是健康的**，问题集中在少数几个主干节点上，可以用 4 次小手术收掉，不需要重写。

**不建议**做的事：引入 UseCase/DTO/Presenter 层、为 Git 或 workspace 造接口、给 Kernel 加通用 repository 抽象。这些在本仓会立刻退化成你列出的"样板代码过载"。理由见 §3.3。

---

## 方法与证据可信度

- **依赖图**：TypeScript 编译器 API 静态扫描 `plugins/immune-brain/runtime/**` 与 `.pi-extension/**` 的 `import` / `export from` / 字面量 `import()`，排除 type-only 边，解析 `package.json` 的 `imports` 别名。产出 SCC（强连通分量）、跨组边计数、每文件闭包大小。脚本与原始输出在 `/tmp/immune-brain-pragmatic-clean-analysis.{mjs,json}` 与 `/tmp/immune-brain-closure.mjs`（本报告不依赖它们长期存在，数字可复算）。
- **测试基线**：`bun test tests/kernel-r2c2-reducer.test.ts tests/host-neutral-assurance-coordinator.test.ts tests/dual-host-assurance-conformance.test.ts tests/antigravity-assurance-conformance.test.ts tests/unattended-batch-schedule.test.ts tests/loop-execution-routing.test.ts` → **216 pass / 0 fail / 2637 expect()**。这 6 个文件覆盖本报告触及的全部主干，改动前后可直接对拍。
- **未验证**：未运行全量 `bun test`（220 个 `*.test.ts`，仓库内共 277 个测试相关文件）与 `bun run typecheck`；未测量运行时耦合（动态 `import()` 只有 14 处，已逐个解析，但 `${}` 模板拼接的路径无法静态证明不存在）；未审计 `dist/` 生成物与 `skills/` 提示词文本；未访问任何 `.imm/` 运行态数据库或历史 session。**本报告只描述结构，不声称任何运行时缺陷。**

---

## 一、现状落位：三层映射

按"是否直接持有 I/O"而非目录名判定（目录名在这里有误导性：`runtime/kernel/` 同时装着纯规则和 SQLite 适配器）。下表的 Domain 行是**目标归属**，不是现状——`reducer`/`completion`/`spec_binding` 目前属于其中但尚未满足判据（F1）。

| 层 | 判据 | 实际落位 | 文件/行数 |
|---|---|---|---|
| **Domain**（纯规则） | 无 `node:fs`/`child_process`/`sqlite`，且传递闭包也不到 | `kernel/{reducer,intent,validation,completion,spec_binding,refutation,risk_floor,acceptance_repeats,actor_identity,types,intent_readiness}`, `verification_descriptor.ts`, `canonical_json.ts`, `decision_model/*` | `kernel` 33 文件中 20 个无直接 I/O；`decision_model` 7 文件 879 行，**0 个 I/O** |
| **Application**（编排） | 有顺序/事务/重试语义，但不该直接碰 fs/进程 | `assurance/{coordinator,verdict_authority,review_mediation,run_continuation}`, `kernel/{enrollment,assurance_projection,canary_application,application}`, `unattended/{batch_plan,batch_runner,lane_decision,batch_schedule,batch_reasons,batch_kernel_port,run_entry_manifest,types}`, `loop_contract.ts`, `role_prompt_bridge.ts` | `assurance` 18 文件 5,666 行（其中 9 个直接 I/O）、`unattended` 23 文件 8,743 行（**8 个纯策略 / 15 个直接 I/O**） |
| **Infrastructure**（适配器） | 直接持有 fs/sqlite/Git/进程/网络 | `kernel/{storage,sqlite_store,storage_paths,run_identity}`, `workspace_scope.ts`, `github_issue_tracker.ts`, `unattended/{batch_git,batch_state,batch_worktrees,batch_lanes}`, `claude/*`, `antigravity/*`, `.pi-extension/*`, `config/layered_config.ts` | `runtime` 根 17 文件 7,571 行（11 个 I/O）、host 适配器 28 文件 8,914 行 |

### 已经做对、不要动的三件事

1. **单一 Kernel authority + 事务边界**：`.imm/state/kernel.sqlite` 一次事务一次 mutation（ADR-0010）。`kernel/authority_port.ts` 的 `MutationAuthorityRegistry` 与 `capability_registry.ts` 让"谁能写"成为显式能力，而不是约定。这是本仓最接近"深模块"的地方——接口小、实现重、且被 `tests/kernel-p2b0-boundary.test.ts` 与 `tests/kernel-canary-claim-writer-boundary.test.ts` 锁住。
2. **`assurance/host_port.ts` 是真端口**：`AssuranceHostPort` 有 3 个真实适配器，`FakeReviewHost` 还能在测试里替换（`tests/host-neutral-assurance-coordinator.test.ts`）。按"一个适配器是假设的端口，两个才是真端口"的标准，这个必须保留，且**不该再抽象一层**。
3. **`decision_model/` 是本仓的教科书样本**：879 行、0 I/O、`decide()` 只依赖注入的 `fetch`/`env`/`adapters`，且有一条**已经存在的 import 边界测试**（`tests/decision-model.test.ts:482`）禁止 `runtime/kernel|assurance|unattended|claude|.pi-extension` 导入它，也禁止插件任何文件导入 `scripts/`。**这条测试就是本报告 §4 要推广的模板，不需要新工具。**

---

## 二、六个结构性问题

每条给出：实测证据 → 对 Agent 的真实代价 → 最小修法。按投入产出排序。

### F1. 纯 reducer 的闭包穿进 SQLite（领域层唯一一处依赖方向倒置，全部 9 个纯 kernel 文件都经由它被污染）

**证据**：4 文件环，全部为 value import：

```
kernel/reducer.ts:6      → completion.ts
kernel/reducer.ts:33     → spec_binding.ts
kernel/completion.ts:4   → spec_binding.ts
kernel/spec_binding.ts:7 → storage.ts      ← 只用 readSecureProjectFile（:53）
kernel/storage.ts:59     → reducer.ts      ← 只用 canonicalRecordHash
```

`reducer.ts` 自身 0 行 I/O，闭包却含 `node:fs` / `node:sqlite` / `node:child_process`。**全部污染都经由 `spec_binding.ts:7` 这一条边**：`assurance_projection.ts:23,25,29`、`enrollment.ts:11`、`canary_application.ts:16,29`、`application.ts:11`、`completion.ts:4`、`reducer.ts:6,33` 都只是间接继承。所以切掉这一条边，同时解开 9 个文件的 SQLite 闭合。

**代价**：修一条完成规则或验收投影，Agent 必须把 SQLite CAS、WAL、迁移与路径安全一起装进上下文；这正是你列的第 1 条痛点。而且它让"这是纯函数、可以放心改"这个**最强的心智捷径失效**——注释说纯，实际不是。

**最小修法（唯一必要的一刀）**：把 `storage.ts:399-532` 的路径安全组（`safeCandidate` / `pathStatOrNull` / `assertNoSymlinkSegments` / `capturePathIdentities` / `assertPathIdentitiesUnchanged` / `readSecureProjectFile` / `readSecureProjectBytes`，约 130 行）移到新叶模块 `kernel/secure_fs.ts`，`storage.ts` 从中 import 并 re-export 保持 `kernel/index.ts:16` 与 `commands/kernel.ts:17` 的导出面不变。`storage → reducer`（基础设施依赖领域）方向正确，保留。

**验收**：新增一条闭包断言（§4 T2）在 `reducer/completion/spec_binding/assurance_projection/canary_application/enrollment/application/intent_readiness/index` 上全部为真（从当前 9 个失败降到 0）；`bun test tests/kernel-r2c2-reducer.test.ts tests/kernel-storage-layout-migration.test.ts tests/batch-completion-verifier.test.ts` 全绿。

### F2. `assurance/coordinator.ts`：2224 行、81 个导出，且向 batch 反向依赖

**证据**：
- 文件 2,224 行，`export` 81 处，被 **119 个文件**引用。
- 反向依赖批处理：`coordinator.ts:33 → unattended/lane_workspace`、`:34 → unattended/batch_preflight`、`:35 → unattended/batch_state`；`workflow_autocommit.ts:14 → batch_preflight`；`active_task_notice.ts:7 → batch_preflight`；`run_continuation.ts:5,6,7,8,10` 分别 → `batch_schedule`/`batch_state`/`batch_plan`/`batch_git`/`batch_preflight`。
- 与同目录两个模块成环，环上边是**纯函数**：`qa.ts:2` 与 `verdict_authority.ts:17` 从 coordinator 取 `snapshotDigest`、`reviewReworkFindings`、`reviewAdvisoryRecords`，而 `coordinator.ts:25` 又 import `verdict_authority`。

**代价**：这是典型的"浅接口深实现"反面——**接口宽到 81 个导出，任何调用方都得先读懂 2224 行才能确定自己该用哪一个**。对 Agent 更糟：跨层职责（assurance 编排 / 证据摘要算法 / 批处理状态查询 / 状态投影文案）挤在一个文件，任何改动都可能触碰三者，而这正是 review 返工的常见来源。

**最小修法（两步，第二步可选）**：
1. 提取 `assurance/evidence_rules.ts`：`snapshotDigest`、`reviewReworkFindings`、`reviewAdvisoryRecords`、`qaDiagnosticMetadata`、finding/anchor 相关纯函数。这一步同时断掉 `coordinator ↔ qa` 与 `coordinator ↔ verdict_authority` 两条环边，**零行为变化**。
2. 把批处理事实查询从 coordinator 移出：`projectTaskStatus` 已接受可选 `loadedFrom`（`coordinator.ts:411`），照此加一个可选 `batchContext?: (root, taskId) => BatchContext | null`，默认值由 composition root（`commands/kernel.ts`、Pi/Claude/Antigravity 适配器）注入。非测试、非 dist 的调用点只有 5 处（`antigravity/run_continuation.ts:18`、`claude/run_continuation.ts:203,264`、`claude/kernel_ports.ts:464`、`batch_git.ts:1123`），改动面可控。

**不做**：不把 coordinator 拆成 UseCase 类、不引入 Presenter。`projectTaskStatus` 返回的 `status + warnings` 已经是本仓的事实标准，再叠一层 response model 只会制造你列的第 2 条 Mapping Hell。

### F2b. Kernel 的存储迁移反过来依赖 batch 状态读取（唯一一条 Kernel→feature 边）

**证据**：`unattended → kernel` 有 **41 条** value 边（batch 依赖 Kernel，方向正确）；反向只有**一条**：

```
kernel/sqlite_migration.ts:59 → unattended/batch_state.ts  （isTerminalBatchState, BatchRunState）
```

即：**权威存储的迁移逻辑依赖批处理功能的 runs 记录格式**。

**代价**：`batch_state.ts` 1,292 行、直接 `node:fs` 全套（`openSync`/`renameSync`/`lstatSync` 用于 CAS 与原子写）。Kernel 的迁移路径因此无法在不加载批处理文件格式的前提下被理解——而迁移正是最不该被无关上下文污染的一段代码（ADR-0010 要求迁移 claimless、可校验、原子发布）。

**最小修法**：不造新抽象。把 `batch_state.ts` 里的**记录形状与终态判定**（`BatchRunState` 类型、`isTerminalBatchState`、解析器）移到 `unattended/batch_record.ts`（保持零 I/O），`batch_state.ts` 保留读写。`sqlite_migration.ts` 改依赖 `batch_record`，I/O 边消失。与 F1 的 `secure_fs` 同一手法：**把规则和存储拆开，而不是加接口。**

### F3. Antigravity 用继承复用了 Claude 的 runtime，且两者互相 import

**证据**（5 条跨 host value 边，全量扫描结果，无遗漏）：

```
antigravity/kernel_ports.ts:1   → claude/kernel_ports.ts   （class AntigravityRuntime extends ClaudeRuntime）
antigravity/mcp_server.ts:3     → claude/mcp_server.ts
antigravity/interaction.ts:35   → claude/interaction.ts    （re-export NativeAuthorityError）
claude/kernel_ports.ts:115      → antigravity/capability.ts（probeHost as probeAntigravityHost）
.pi-extension/pi-canary-assurance-progression.ts:58 → claude/review_host.ts（parseReviewMarker）
```

后果量化：`antigravity/kernel_ports.ts` **只有 18 行，闭包却有 91 个文件**——这 18 行是整仓"上下文放大率"最高的文件。

**代价**：ADR-0004 要求"一个 Kernel、一个持久化协议、**无通用 host registry**"。当前形态微妙地违反了它的精神：host 之间不是平等的适配器，而是 Antigravity **寄生**在 Claude 上，同时 Claude 又反向知道 Antigravity 的存在（`probeAntigravityHost`）。任何改 `ClaudeRuntime` 都在隐式改 Antigravity，而这个耦合没有任何一处测试或文档声明过。

**最小修法**：把 `ClaudeRuntime` 里真正 host 无关的部分（hook 事件分发、operation marker、权限模式探测、lane guard 骨架）上移到 `runtime/host_runtime/`（与 `assurance/` 同级，仍属 Application/Infrastructure 混合区的**单一**共享模块），由 `claude/` 与 `antigravity/` 各自**组合**而非继承。`parseReviewMarker` 属于协议、不属于任何一个 host → 移到 `assurance/`。**不引入 host registry、不引入插件系统**。

### F4. 只读的 batch 投影依赖 3270 行的 GitHub 传输层

**证据**：
- `unattended/batch_plan.ts:3` → `github_issue_tracker.ts` 的 `observeGithubInitiative`。`batch_plan` 是"确定性、只读、不写任何东西"的 Plan 投影（CONTEXT.md: *Batch Plan … observes Tracker and TaskRecord facts and writes nothing*），却静默继承了 `node:child_process`（spawn `gh`）。
- `github_issue_tracker.ts` 3,270 行 / 23 导出，并在 `:885`、`:930`、`:1749` 三处 `await import("./unattended/batch_git")`；反向 `batch_lanes.ts:28` 静态 import tracker。这构成一个 10 文件 SCC，把 assurance 也卷进去。
- 它和 `local_initiative.ts` 是**同一个抽象的两个实现**（GitHub Issue 载体 / 本地 Markdown 载体），`batch_plan.ts:3-4` 并列调用两者——这是全仓**唯一一个"已经有两个适配器、却还没有端口"**的地方。

**代价**：`batch_plan` 的测试与推理必须能构造 `gh` 环境；只读投影的安全性（"writes nothing"）无法从依赖结构上被证明，只能靠约定。

**最小修法**：抽一个极窄的 `InitiativeSource` 端口（`observe(root, slug) → InitiativeObservation`），两个实现 `github_issue_tracker` 与 `local_initiative` 各自 satisfies；`batch_plan` 只依赖端口。这个端口**不新增文件数**（两个实现已在），只把已有的隐式协议显式化。`observeParentCompletion` 的动态 import 保留——它已经在 `batch_git` 里，属基础设施之间的协作。

### F5. Pi 扩展的两个巨型文件互引

**证据**：`imm-canary-work.ts`（1,981 行，含 52 个 import）`:31` import `imm-unattended-batch.ts`（805 行）；后者 `:35` 反向 import 前者。两者闭包都是 97（并列全仓最大）。

**代价**：这是 F2/F3 的宿主侧同构问题——单文件承载工具注册 + 编排 + 格式化。对 Agent 的伤害不是"看不懂"，而是**改动辐射面不可预测**：任何一个函数的改动都可能被另一侧的 52 个 import 之一消费。

**最小修法**：把两者共有的、无 schema 依赖的部分（entry token、task intent 读取、reason 文案）提取为 `runtime/assurance/pi_entry.ts`，让依赖单向：`imm-canary-work → pi_entry ← imm-unattended-batch`。**不重命名、不拆分工具注册表**（那会触发 `dist/` 与包边界测试的连锁改动，收益远小于风险）。

---

## 三、目标架构

### 3.1 三层（不是四层）

```
┌──────────────────────────────────────────────────────────────┐
│ Infrastructure   storage/sqlite · workspace_scope · git      │
│                  github_issue_tracker · claude/ · antigravity│
│                  .pi-extension/ · config/layered_config      │
│  ↕ 只能被端口调用；可以依赖下面全部                            │
├──────────────────────────────────────────────────────────────┤
│ Application      assurance/coordinator · verdict_authority   │
│                  unattended/batch_* · kernel/enrollment      │
│                  kernel/assurance_projection · loop_contract │
│  ↕ 依赖 Domain + 端口接口；禁止直接 node:fs / node:sqlite      │
├──────────────────────────────────────────────────────────────┤
│ Domain           kernel/{reducer,intent,validation,          │
│                    completion,spec_binding,refutation,        │
│                    risk_floor,actor_identity,types}           │
│                  verification_descriptor · canonical_json     │
│                  decision_model/*                             │
│  ↕ 零 I/O，闭包不到 fs/sqlite/进程；可被任何人依赖            │
└──────────────────────────────────────────────────────────────┘
```

判据只有一条，而且可以机检：**这个文件的传递闭包能不能碰到 `node:fs|sqlite|child_process`**。mermaid 图不画——一张能自动判定的数据比一张需要人读的箭头图更适合本仓（也与本仓既有 Spec 的 "Diagram decision: not_required" 惯例一致）。

### 3.2 端口清单：4 个，且只保留 4 个

| 端口 | 已有？ | 变化点是否已存在 | 处置 |
|---|---|---|---|
| Kernel authority store（SQLite） | `kernel/sqlite_store.ts` 内部 | 历史上换过一次（ADR-0010 从文件存储迁来），且测试需要 seed | **保留现状**，不新加 interface，不改名 |
| Host transport | `assurance/host_port.ts` | 3 个真实适配器 + 测试 fake | **保留**，禁止再包一层 |
| Initiative source | 两个实现已存在，端口未显式 | GitHub Issue / 本地 Markdown | **新增端口**（F4） |
| Mutation authority | `kernel/authority_port.ts` | capability 已可注入 | **保留** |

**明确不建端口**：`workspace_scope.ts`（单实现，无变化预期）、`storage.ts` 内部路径安全（F1 用**叶模块**而非接口解决——同进程、无替换需求，接口化只会新增一层转调）、`config/layered_config.ts`（单实现，测试已通过临时目录隔离）。

### 3.3 明确不做的四件事

1. **不引入 UseCase / InputPort / OutputPort / Presenter / DB Model 的映射链**。当前 `TaskIntent → TaskRecord → AssuranceProjection` 已经是 3 个契约，再加 DTO 就是第 4、5、6 个，正好复现你说的 Mapping Hell。
2. **不把三层变成目录大搬迁**。目录名不改变依赖方向；`runtime/kernel/` 同时放 Domain 与 Infrastructure 是可接受的，只要 §4 的闭包断言成立。搬迁 129 个文件的路径会同时打破 `package.json` 的 `imports`、`files`、`tests/pi-canary-package-boundary.test.ts` 与两个 build 脚本——成本极高、收益为零。
3. **不加 ESLint / dependency-cruiser**。本仓没有 linter 依赖，但**已经有 AST 级别的 import 边界测试**（`tests/decision-model.test.ts:482`、`tests/kernel-r2c1-boundary.test.ts:102`）。复用已有模式，不新增工具链。
4. **不追求"四层对齐"或指标好看**。`assurance` 5,666 行不会因为拆分变少；目标是让**每个文件能被独立推理**，不是让行数均匀。

---

## 四、把规则变成机器约束（Agent 的可执行反馈环）

三条测试，放在 `tests/architecture-boundaries.test.ts`，复用 `tests/decision-model.test.ts:482` 的 AST 扫描写法（`readFileSync` + 正则/`typescript` API 均可，不新增依赖）。每条都带一个**只减不增的 allowlist**，让约束成为 ratchet 而不是教条。

| ID | 断言 | 当前状态 | 失败信息应包含 |
|---|---|---|---|
| **T1** Host 隔离 | `runtime/claude/**` 与 `runtime/antigravity/**` 不得互相 import；`runtime/assurance/**`、`runtime/kernel/**`、`runtime/unattended/**` 不得 import 任何 host 目录 | **5 处失败**（见 F3） | `from` 文件:行、`to` 文件、建议落位（`runtime/host_runtime/` 或 `assurance/`） |
| **T2** Domain 纯净 | Domain 白名单文件的**传递闭包**不得含 `node:sqlite` / `node:fs` / `node:child_process` | **失败 9 处**（均经由 `spec_binding.ts:7`）：`reducer`(19) · `completion`(19) · `spec_binding`(19) · `application`(21) · `intent_readiness`(21) · `canary_application`(22) · `assurance_projection`(22) · `enrollment`(24) · `kernel/index`(20)，括号为闭包文件数 | 闭包路径（哪个文件、哪一行把 I/O 引进来） |
| **T3** 层方向 | `runtime/assurance/**` 与 `runtime/kernel/**` 不得 import `runtime/unattended/**` 中持有 I/O 的文件；`runtime/unattended/batch_plan.ts` 不得 import `github_issue_tracker` | **失败 11 处**：`coordinator.ts:33,34,35`、`active_task_notice.ts:7`、`workflow_autocommit.ts:14`、`run_continuation.ts:5,6,7,8,10`、`kernel/sqlite_migration.ts:59`、`batch_plan.ts:3` | 同上 |

这三条之所以优于文档，正是因为你文章里的第 3 点：**Agent 需要的是"报错 + 精确位置"，不是"读一篇架构文档再自己判断"。** 一条 T2 失败能直接指向 `spec_binding.ts:7`，Agent 的修正动作是确定的。

---

## 五、迁移顺序

每刀独立可发布、可回退、可对拍同一组 216 个测试。**严格按此顺序**——W1 不落地时 W2 的收益会被 F1 的噪声淹没。

| 刀 | 内容 | 涉及 | 验收 | 回退 |
|---|---|---|---|---|
| **W1** | 提取 `kernel/secure_fs.ts`（F1） | ~130 行移动 + `storage.ts` re-export；`kernel/index.ts` 导出面不变 | T2 的 9 个失败全部归零；`bun test tests/kernel-r2c2-reducer.test.ts tests/kernel-storage-layout-migration.test.ts tests/batch-completion-verifier.test.ts` | 纯移动，`git revert` 即恢复 |
| **W2** | 提取 `assurance/evidence_rules.ts`（F2 步 1） | `snapshotDigest` 等纯函数迁出；`coordinator.ts` 减约 200-400 行 | `coordinator ↔ qa`、`coordinator ↔ verdict_authority` value 边消失；`host-neutral-assurance-coordinator` + 双 host conformance 全绿 | re-export 保留，可逐函数回退 |
| **W3** | `InitiativeSource` 端口（F4）→ 拆分 `batch_record.ts`（F2b）→ `batchContext` 注入（F2 步 2） | `batch_plan.ts` 依赖端口；`sqlite_migration.ts` 改依赖纯记录模块；`projectTaskStatus` 加可选参数 | T3 为真；`unattended-batch-plan` / `batch-plan-reconfirmation` / `kernel-storage-layout-migration` | 端口是新增文件，默认实现即当前行为；`batch_record` 为纯移动 |
| **W4** | Host 整合（F3 + F5） | `runtime/host_runtime/`、`parseReviewMarker` 迁入 `assurance/`、`pi_entry.ts` | T1 为真（allowlist 归零）；`dual-host` + `antigravity` conformance + `pi-canary-package-boundary` | 风险最高的一刀，必须最后做且单独 PR |

**W1 的性价比最高**：一次纯移动，同时解锁 9 个纯 kernel 文件的独立性，并让 T2 从"全红"变成"只差 W3"。建议它单独成为一个 routine 风险任务。

---

## 六、与既有决策的关系

| 既有决策 | 本报告立场 |
|---|---|
| **ADR-0004**（单一 Kernel、无通用 host registry） | **强化**。F3 指出现状让 Antigravity 通过继承 Claude 获得了"事实上的 registry 语义"，与 ADR 精神不符；修法是共享模块 + 组合，不是新建 registry。 |
| **ADR-0010**（SQLite workflow authority） | **不改**。`storage → reducer` 方向正确。F1 只移动路径安全组，不触碰事务、CAS、迁移、审计导出。 |
| **ADR-0034**（分层配置） | **不改**。`config/layered_config.ts` 的 I/O 属 Infrastructure，位置正确；其与 `decision_model` 的双向 import 是两个基础设施模块的互助，无害。 |
| **CONTEXT.md「Batch Plan … writes nothing」** | **用结构证明它**。F4 的端口是让这句不变式从"约定"变成"依赖图上的事实"。 |
| 历史 Wave 1/3/4（`docs/specs/archive/architecture-*.spec.md`） | **不复用其"大扫除"手法**。那三轮以文档/脚本/包安装为主，未触及依赖方向；本报告的每一刀都以闭包断言为准入。 |

**需要新增 ADR 吗**：只有 W4 值得。理由是它满足全部三条判据——难以回退（跨 host 继承关系）、无上下文会令人困惑（为什么 Antigravity 不继承 Claude 了）、真实权衡（组合 vs 继承 vs 共享基类）。W1/W2/W3 都是可逆的机械移动，**不写 ADR**（按 `docs/agents/domain.md` 的标准，缺任一条就跳过）。

**CONTEXT.md 是否需更新**：暂不。三层判据是设计约束而非领域词汇；等 W1 落地后，若 `secure_fs` 成为新的稳定术语再补一行 Architecture Map。

---

## 七、未验证与风险

1. **未跑全量回归**。工作区有 20+ 个未提交改动（含 `unattended/*`、`claude/kernel_ports.ts`、`tests/*batch*`），全量 `bun test` 与 `bun run typecheck` 未执行，**不能断言主干当前是绿的**。
2. **运行时耦合未测**。14 处字面量 `import()` 已解析；用模板拼路径的动态加载无法静态排除。若存在，SCC 图会低估耦合。
3. **`dist/` 未审计**。`dist/claude/mcp-server.mjs` 与 `dist/antigravity/mcp-server.mjs` 是 checked-in 生成物，W3/W4 必然要求重新生成（`bun scripts/build-{claude,antigravity}-plugin.ts`），diff 体量会很大但机械。
4. **闭包阈值是启发式，不是定理**。`median=4`、`19` 这些数字刻画的是"读代码要装多少上下文"，不是缺陷计数。**明确仅此一处是倒置**：`spec_binding.ts:7`。至于 `assurance_projection`/`canary_application`/`enrollment` 是否*应该*属于 Domain（因而共享这条修复），是另一个判断，本报告不主张。
5. **F3 的修法有真实分歧空间**。把 `ClaudeRuntime`（1,328 行）上移为共享模块，可能让 Claude 侧承担 Antigravity 的差异；组合重写的行数不小。若时间有限，**W4 可以先只做 `parseReviewMarker` 归位 + T1 的 allowlist 冻结**，把继承关系作为已知债务显式登记（带退出条件：Antigravity 出现第一个 Claude 不需要的行为时）。
6. **本报告不含性能结论**。未测 QA/Review 时长、SQLite 争用或 `gh` 调用延迟。

---

*生成于 2026-11-05 | 快照 `5575a38f11e` + 工作区 | 证据：AST 依赖扫描 + 216 个聚焦测试通过 | 非权威，未入账*
