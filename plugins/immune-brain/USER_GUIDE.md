# Immune-Brain 用户指南

## 简介

Immune-Brain 是一套 **Managed-by-default、按请求类型保留 host-native path** 的 AI 编码工作流。

仓库变更请求会自动进入 Managed Path，用户不需要说 “Managed Path”，也不需要先运行单独的 setup command。只读、解释、仅审查、仅规划和明确不修改请求停留在 host-native path，不会 Enrollment。已有 Assurance owner 通过 `imm-loop` 恢复；有实质歧义的变更先进入 `imm-brainstorm`，清晰的新变更进入 `imm-planner`。Planner 产物不会被无条件 Enrollment。

核心目标有两个：

- 高风险任务保留明确的 authority、证据和恢复边界。
- 普通任务不因文件数量、测试数量或常规返工承担 Plan、QA、Review 和流程弹窗开销。

## 路由模型

### Managed Path：仓库变更默认路径

Host 先应用 `imm-route --json <request>`（或等价 routing contract），再选择 Skill：

1. 已有 Assurance projection、TaskIntent、TaskRecord 或 reviewer follow-up：通过 `imm-loop` 继续现有 owner。
2. 只读、解释、仅审查、Plan-only、明确 no-modification：留在 host-native path，不 Enrollment、不创建 task authority。
3. 有实质歧义的 mutation：进入 `imm-brainstorm`，澄清前不 Enrollment。
4. 清晰的新 mutation：进入 `imm-planner`，Planner 只创建候选 Spec/TaskIntent；literal-user Enrollment 仍是 authority boundary。
5. Fast-Track 只压缩 Managed Path，不绕过 TaskIntent scope、Enrollment、QA、Review、authorization 或 completion。

首次 Managed 请求会自动幂等 bootstrap：完全不存在的 Immune-Brain state 才会创建；完整 state 保持 byte-stable；partial 或 schema-incompatible state 在写入前 fail closed。

### Host-native Path：非变更请求

普通 host agent 可以解释、检查和 review，而不创建 Spec、Plan、TaskIntent、TaskRecord、State Ledger、QA、mandatory Review、HANDOFF 或 Compounder state。

## 用户确认边界

只为会产生特权或不可逆外部效果的 exact operation 请求 host confirmation：

- release、deployment、remote/external write；
- secret、credential、permission 变更；
- destructive deletion、irreversible mutation、Git history rewrite；
- authority discard、task stop、breaking intent revision、risk/policy override。

普通本地编辑、本地验证、host-native rework、scoped diff review 和完成报告不需要流程确认。Managed 的 evidence、QA、Review 与 completion authority 由 Kernel contract 决定。

## 快速上手

### 1. 自动 bootstrap

无需先运行 setup command。第一次仓库变更请求由 host 调用 `imm-route`，在 Managed phase 开始前完成严格、幂等 bootstrap。`/imm-init` 只作为显式诊断入口；partial 或 schema-incompatible state 会 fail closed。

### 2. 先选择路径

Host 先应用 Managed-by-default route：

- 只读、解释、review-only、Plan-only、明确 no-modification：host-native，不 Enrollment；
- 有实质歧义的 mutation：`imm-brainstorm`；
- 清晰的新 mutation：`imm-planner`；
- 已有 Assurance owner：`imm-loop`。

### 3. 执行非变更请求

Host agent 直接完成 explanation、inspection 或 review，不创建 workflow authority。

### 4. 执行 Managed Kernel 工作

新的 Managed 任务使用一个 Git-tracked TaskIntent 与一个 worktree-local TaskRecord：

1. `imm-planner` 定义目标、acceptance、risk 与 canonical scope envelope；后续任何 scope 扩展都是 breaking revision，需要重新 enrollment。
2. canonical `imm-kernel intent author/validate` 生成并验证 TaskIntent；`intent validate` 输出 `descriptor_rehearsal.status=pending_tui_enrollment` 时，表示 structural eligibility 已通过，但最终 `enrollment_ready` 仍须由 TUI enrollment preflight 决定。
3. Pi TUI 的 `/imm-canary-new <task-id>` 只发送一条可见 Parent request；Parent 随即在前台调用一次 `imm_canary_enrollment` Tool 并直接消费 terminal result。Tool 冻结 Git index snapshot，把 `index_digest` 绑定进 enrollment receipt，并通过 host-native `onUpdate`/`renderResult` 展示有界 stage，不写 Footer、不创建 Widget、不发送 completion notification，也不要求轮询或 `get-result` recovery。`scope_hint`（含 TaskIntent sidecar）存在 unstaged/untracked bytes、确认后 index drift 或 snapshot integrity drift 时一律 non-waivable fail closed。每个 canonical verification descriptor 从同一个 frozen index 创建独立 copy，copy/setup 与 argv execution 从同一起点并行且共同受该 descriptor timeout 和 Tool `AbortSignal` 约束，并报告逐项耗时；live integrity monitor 比较 index、scope 与含 tracked dirty/untracked content bytes 的 parent fingerprint，漂移时立即 abort 全部 descriptor。timeout/cancel/output-limit/integrity-drift 先终止 process group，发起终止后 child `error` 只记录诊断，必须等待 child `close` terminal receipt 后才 cleanup copy。`setup_timed_out`、`cancelled`、`integrity_drift`、`output_exceeded` 与 `setup_failed` 是不可 waiver 的终态；只有 descriptor validation、nonzero exit 或 descriptor execution timeout 能产生可 waiver 的 `enrollment_ready=false`。Escape/host cancellation 是唯一的 pre-commit cancellation path；commit owner 建立后 settlement 不可取消，Tool 必须返回 success、known failure 或 `settlement_unknown`。
4. `/imm-canary-enroll <task-id>` 使用同一个 foreground Tool 的显式 waiver action；它只可覆盖 descriptor validation/nonzero/descriptor-execution-timeout。同一个 literal-user confirmation 必须展示全部失败项和 `REHEARSAL WAIVER`，确认后的 backend claim receipt ref 记录 `descriptor-rehearsal/v1:waived:<digest>`，其中 digest 同时绑定 frozen `index_digest` 与 scope paths。scope/index snapshot integrity、live integrity drift、setup timeout、cancellation、output-limit 与 setup failure不可 waiver；拒绝或取消确认保持零 authority writes。
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
| `imm-route --json <request>` | 按自然语言请求选择 host-native、Brainstorm、Planner 或 Loop，并在 Managed phase 自动 bootstrap |
| `imm-init` | Managed Path 自动 bootstrap 的显式诊断入口；不替代请求路由 |
| `imm-brainstorm` | 澄清关键需求、约束和风险；不写计划或代码 |
| `imm-planner` | 为清晰的仓库变更创建或修订候选 Spec/TaskIntent；不自动 Enrollment |
| `imm-kernel intent author/validate` | canonical TaskIntent authoring 与 validation |
| `imm-kernel status --json` | read-only Kernel/legacy shadow status |
| `imm-kernel audit --legacy` | 显式 read-only legacy audit |
| `/imm-canary-new <task-id>` | 发送可见 Parent request，并通过一次 foreground `imm_canary_enrollment` Tool 创建新 Managed TaskIntent；默认 route 不允许 waiver |
| `/imm-canary-enroll <task-id>` | 发送可见 Parent request，并通过同一个 foreground Tool 展示 explicit descriptor waiver；Escape/host cancellation 仅在 commit 前生效 |
| `imm_canary_enrollment` | Parent 调用的 foreground Enrollment Tool；直接返回 bounded progress 与唯一 terminal result，不使用 background recovery |
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
| Compounder | 对已闭合工作按需沉淀可复用知识 | 阻塞普通 host-native completion、处理未闭合工作 |

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

Pi native subagent 负责可见的 agent UI 与模型执行。Interactive advisory、Enrollment 与 Assurance lifecycle 均按 foreground contract 运行；只有显式配置的 offline sidecar 可以后台执行。Immune-Brain 不维护其他 code-agent host adapter、私有模型 runtime 或独立 credential injection 路径。

## 适用边界

适合：

- 普通本地工程任务：仓库变更自动进入 Managed；只读请求保持 host-native 实现与验证体验；
- 高风险、公共契约、持久化、并发或多 owner 任务：Managed 提供明确 authority 和恢复边界；
- 需要审计 provenance、snapshot-bound approval 和可复现证据的长期项目。

不进入 workflow 的情况：

- generic chat；
- 与仓库工程结果无关的纯创意请求；
- 用户没有要求持久化或工程交付的临时讨论。
