# Immune-Brain 用户指南

## 简介

Immune-Brain 是一套 **Direct-first、按风险启用 Managed authority** 的 AI 编码工作流。

普通本地任务由 Pi host agent 直接实现和验证。只有已有 Managed owner、用户明确要求规划或审计，或任务触及安全、公共契约、迁移、并发、发布、外部写入、不可逆操作等硬边界时，才进入可审核、可恢复的 Managed lifecycle。

核心目标有两个：

- 高风险任务保留明确的 authority、证据和恢复边界。
- 普通任务不因文件数量、测试数量或常规返工承担 Plan、QA、Review 和流程弹窗开销。

## 路由模型

### Direct Path：默认路径

当没有 Managed trigger 时，普通 host agent：

1. 在用户请求范围内实现本地修改。
2. 运行可复现的 task-scoped verification。
3. 检查 stable task-owned diff，确认没有误改或无关改动。
4. 在 zero task-owned unresolved failure 时报告完成。

Direct 不创建 Spec、Plan、TaskIntent、TaskRecord、State Ledger、QA、mandatory Review、HANDOFF 或 Compounder 状态，也不写 `.imm/` workflow authority。

以下因素本身不会把 Direct 升级为 Managed：

- 修改多个文件；
- 运行多条本地 verifier；
- 普通测试失败、修复和重试；
- 使用可选的只读 subagent；
- worktree 中存在无关的用户改动。

整个 Git worktree 不必干净。Agent 只检查 task-owned diff，不触碰无关修改；需要 staging 时必须列出明确路径，不能在 dirty worktree 使用 `git add .` 或 `git add -A`。

### Managed Path：按触发器启用

以下任一条件成立时使用 Managed：

- 已有 Plan、TaskIntent、TaskRecord 或 reviewer follow-up 正在拥有任务；
- 用户明确要求规划、审计、安全或合规审查、独立闭环或 Managed lifecycle；
- 涉及安全、凭据、权限、公共 API/schema/兼容性；
- 涉及迁移、持久化、并发、恢复或跨 worktree ownership；
- 涉及发布、部署、远程或外部系统写入；
- 涉及破坏性或不可逆操作、Git history rewrite、authority discard、risk/policy override；
- 多个独立 owner 无法作为一个连贯的 task-owned outcome 闭合；
- 最小澄清或只读 probe 后，material risk/ownership 仍不明确。

已有 Managed owner 具有排他所有权，必须完成或明确终止，不能为了减少流程切回 Direct。Direct 执行中发现 hard trigger 时，应停止进一步修改、保留当前工作，再进入 Managed。

## 用户确认边界

只为会产生特权或不可逆外部效果的 exact operation 请求 host confirmation：

- release、deployment、remote/external write；
- secret、credential、permission 变更；
- destructive deletion、irreversible mutation、Git history rewrite；
- authority discard、task stop、breaking intent revision、risk/policy override。

普通本地编辑、本地验证、Direct rework、scoped diff review 和完成报告不需要流程确认。Managed 的 evidence、QA、Review 与 completion authority 由 Kernel contract 决定。

## 快速上手

### 1. 初始化

在目标项目根目录运行 `imm-init`：

```text
/imm-init
```

初始化会安装共享规则、Skill 入口和 Managed 所需目录。初始化本身不代表后续请求都必须走 Managed。

### 2. 先选择路径

收到请求后先应用 Direct/Managed matrix：

- 没有 Managed trigger：直接实现和验证，不调用 Planner。
- 命中 Managed trigger：需求明确时由 `imm-planner` 创建 Spec 与 TaskIntent；关键需求仍有歧义时先用 `imm-brainstorm` 做最小澄清。

### 3. 执行 Direct 工作

Direct 没有专用命令或持久化 router。普通 host agent 完成实现、verification 与 diff 检查后直接报告结果。

### 4. 执行 Managed Kernel 工作

新的 Managed 任务使用一个 Git-tracked TaskIntent 与一个 worktree-local TaskRecord：

1. `imm-planner` 定义目标、acceptance、risk 与 canonical scope envelope；后续任何 scope 扩展都是 breaking revision，需要重新 enrollment。
2. canonical `imm-kernel intent author/validate` 生成并验证 TaskIntent；`intent validate` 输出 `descriptor_rehearsal.status=pending_tui_enrollment` 时，表示 structural eligibility 已通过，但最终 `enrollment_ready` 仍须由 TUI enrollment preflight 决定。
3. Pi TUI 通过 `/imm-canary-new <task-id>` 在 session-owned background job 中冻结一个 Git index snapshot，并把 `index_digest` 绑定进 enrollment receipt；`scope_hint`（含 TaskIntent sidecar）存在 unstaged/untracked bytes、确认后 index drift 或 snapshot integrity drift 时一律 non-waivable fail closed。每个 canonical verification descriptor 从同一个 frozen index 创建独立 copy，copy/setup 与 argv execution 从同一起点并行且共同受该 descriptor timeout 和 AbortSignal 约束，并报告逐项耗时；live integrity monitor 比较 index、scope 与含 tracked dirty/untracked content bytes 的 parent fingerprint，漂移时立即 abort 全部 descriptor。timeout/cancel/output-limit/integrity-drift 先终止 process group，发起终止后 child `error` 仅记录诊断，必须等待 child `close` terminal receipt 后才 cleanup copy。`setup_timed_out`、`cancelled`、`integrity_drift`、`output_exceeded` 与 `setup_failed` 是不可 waiver 的终态；只有 descriptor validation、nonzero exit 或 descriptor execution timeout 能产生可 waiver 的 `enrollment_ready=false`。handler 立即返回、footer 持续显示 stage，主输入保持可用；对 parent worktree 与 authority 零写入。可用 `/imm-canary-new cancel <task-id>` 取消，session shutdown 也会 abort 未完成 job；取消只在线性化 commit 前生效，commit owner 建立后会拒绝取消并完成 authority settlement。
4. 仅显式 `/imm-canary-enroll <task-id>` route 可覆盖 descriptor validation/nonzero/descriptor-execution-timeout；同一个 literal-user confirmation 必须展示全部失败项和 `REHEARSAL WAIVER`，确认后的 backend claim receipt ref 记录 `descriptor-rehearsal/v1:waived:<digest>`，其中 digest 同时绑定 frozen `index_digest` 与 scope paths。scope/index snapshot integrity、live integrity drift、setup timeout、cancellation、output-limit 与 setup failure 不可 waiver；取消确认保持零 authority writes。
5. Agent 在当前 owner 内连续实现，并用 `git add -- <exact task paths>` 显式声明 task-owned `HEAD -> index` snapshot；禁止在 dirty worktree 使用 bulk staging。
6. Agent 针对该 staged snapshot 运行 acceptance verification，并把 evidence 记录到 Kernel。
7. `advance_assurance` 运行 deterministic host QA；通过后启动单一 Pi native Review。
8. 需要 literal-user authority 时，Agent 调用 `request_authorization` 打开 exact host confirmation。
9. completion predicate 满足后，Kernel 将任务转为 `done` 并释放 owner。

Managed freshness、QA、Review、authorization 与 completion 都绑定同一个 TaskRecord scope envelope 和 index-backed digest。范围外 unstaged、untracked 或 staged paths 不会进入 task snapshot，也不会使 evidence stale；范围内 unstaged/untracked bytes、index mutation、unsupported object mode、path ambiguity 或 `HEAD` 变化均在 authority write 或 Review spawn 前 fail closed。Review current bytes 由已捕获的 Git blob OID 提供，不读取 parent live worktree。

## 当前 authority 与存储

新的 Managed 生产路径使用 Assurance Kernel v4：

- `docs/plans/*.intent.json`：Git-tracked TaskIntent，保存目标、acceptance、scope hint、risk 与 revision；
- `.imm/tasks/<task-id>.json`：worktree-local TaskRecord，保存 phase、evidence、findings、approvals 与 history；
- `.imm/workspace.json`：当前 worktree 的 Managed ownership；
- Kernel content-hash CAS、锁与 transaction marker：保证 mutation 失败关闭并可恢复。

TaskIntent 与 TaskRecord 是独立 authority。对话 memory、session ID、HANDOFF 文本或 reviewer 自报结果都不能替代 Kernel record。

### Legacy v3 边界

v3 mutating commands 已退出生产路径。历史 v3 State Ledger 只能通过显式 read-only legacy audit 读取；v4 不自动迁移，也不会在首次写入时隐式升级旧状态。仍有 nonterminal v3 owner 的项目必须使用先前 runtime 完成 drain 或明确终止，之后才能进入 v4。

## 当前命令与入口

| 入口 | 用途 |
| --- | --- |
| `imm-init` | 初始化项目规则、Skill 与目录 |
| `imm-brainstorm` | 澄清关键需求、约束和风险；不写计划或代码 |
| `imm-planner` | 为 Managed 任务创建或修订 Spec/TaskIntent |
| `imm-kernel intent author/validate` | canonical TaskIntent authoring 与 validation |
| `imm-kernel status --json` | read-only Kernel/legacy shadow status |
| `imm-kernel audit --legacy` | 显式 read-only legacy audit |
| `/imm-canary-new <task-id>` | Pi TUI 中启动 background descriptor rehearsal；全部通过后确认并 enrollment 新 Managed TaskIntent；`cancel <task-id>` 可取消 |
| `/imm-canary-enroll <task-id>` | 显式 waiver route；只在 literal-user confirmation 展示失败明细后覆盖 descriptor rehearsal failure，并在 enrollment receipt 记录 override；`cancel <task-id>` 可取消 |
| `imm_kernel_canary` | Agent 调用的 evidence、assurance、authorization 与 completion 工具 |
| `imm-pr-fix` | 在当前 PR scope 内修复 review/CI feedback |
| `imm-arch-explorer` | 只读探索陌生仓库结构 |
| `imm-advisory-reviewer` | 按明确 lens 做只读 advisory review（含 `debug_hypothesis`） |

`imm-work`、`imm-review`、`imm-autowork`、`imm-finish`、`imm-migrate` 等 v3 mutation 入口已 retired；它们不是新任务的操作路径。兼容入口 `imm-page-design`、`imm-party`、`imm-preplan-review`、`debug-investigator` 已 retired，改用 canonical 技能（`imm-planner` `page_design`、`imm-brainstorm` `roundtable`/`adversarial`、`imm-advisory-reviewer` `debug_hypothesis`）。

## Managed 角色边界

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| Planner | 定义 Managed Spec/TaskIntent | 实现代码、QA closure |
| Executor/host agent | 在当前 owner 范围内实现并记录事实证据 | 改写 authority、给自己签发 QA/Review approval |
| Deterministic QA | 重验 acceptance descriptors 与 freshness | 编辑实现、接受 stale evidence |
| Native Reviewer | 对锁定 snapshot 提供 advisory verdict | 直接写 Kernel authority、修改文件 |
| Host authorization | 展示 exact operation 并绑定 literal-user confirmation | 推断或扩大用户批准内容 |
| Compounder | 对已闭合工作按需沉淀可复用知识 | 阻塞普通 Direct completion、处理未闭合工作 |

并行只用于无状态只读工作，例如仓库探索、独立 advisory review 或测试 probe。Task mutation、QA decision、review authority 与 owner transition 保持串行。

## 配置

Immune-Brain 读取 Pi 本机配置：`~/.pi/agent/immune-brain/config.toml`。可通过 `IMMUNE_BRAIN_CONFIG` 和 `IMMUNE_BRAIN_AGENT_CONFIG` 指定附加配置，后者优先级更高。

```toml
[output_language]
default = "zh-CN"

[subagent_activation]
default = "auto"  # auto | explicit_only | disabled

[workflow]
model_preset = "balanced"  # off | budget | balanced | quality | ensemble

[subagent_models]
fast = "deepseek/deepseek-v4-flash"
mid = "deepseek/deepseek-v4-pro"
strong = "inherit"
```

Pi native subagent 负责可见的后台 agent UI 与模型执行。Immune-Brain 不维护其他 code-agent host adapter、私有模型 runtime 或独立 credential injection 路径。

## 适用边界

适合：

- 普通本地工程任务：Direct 保持 host-native 实现与验证体验；
- 高风险、公共契约、持久化、并发或多 owner 任务：Managed 提供明确 authority 和恢复边界；
- 需要审计 provenance、snapshot-bound approval 和可复现证据的长期项目。

不进入 workflow 的情况：

- generic chat；
- 与仓库工程结果无关的纯创意请求；
- 用户没有要求持久化或工程交付的临时讨论。
