# Immune-Brain 用户指南

## 简介

Immune-Brain 是一套 **Skill-explicit Managed Path** 的 Pi 工作流。

普通 host input 保持 host-native，不执行自然语言 Managed 路由。只有显式进入 `imm-brainstorm`、`imm-planner` 或 `imm-loop` 才启动新的 Managed workflow；已有 Assurance owner 始终通过 `imm-loop` 恢复。

核心目标有两个：

- 高风险任务保留明确的 authority、证据和恢复边界。
- 普通任务不因文件数量、测试数量或常规返工承担 Plan、QA、Review 和流程弹窗开销。

## Public Skill surface

用户可发现的 Skill 只有三个：`imm-brainstorm`、`imm-planner`、`imm-loop`。
执行、QA、Review、repair 和 learning 都由 `imm-loop` 与 runtime
内部 roles/tools 完成；它们没有独立的 public Skill 或兼容 alias。

## 路由模型

### Managed Path：显式 Skill 入口

Host 不再按自然语言请求自动选择 Managed phase。用户显式调用 public Skill 后，Skill 负责进入对应 workflow；active Assurance projection 保持权威，但不会自动改写普通输入。

1. 已有 Assurance projection、TaskIntent、TaskRecord 或 reviewer follow-up：保持现有 owner，用户显式进入 `imm-loop` 后继续。
2. 普通 host input：保持 host-native，不扫描 `.imm`，不创建 task authority。
3. 显式 `imm-brainstorm`：澄清实质歧义；显式 `imm-planner`：创建候选 Spec/TaskIntent。
4. 显式 `imm-loop`：消费已验证 Plan 或恢复 active task；literal-user Enrollment 仍是 authority boundary。
5. Fast-Track 只压缩 Managed Path，不绕过 TaskIntent scope、Enrollment、QA、Review、authorization 或 completion。

显式 Skill 直接使用项目现有结构，只创建当前 Spec、TaskIntent 或执行结果需要的目录和文件；不会安装、覆盖或校验项目级 `AGENTS.md`、`IMMUNE.md`、`CONTEXT.md` 契约。

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

### 1. 显式进入 Skill

用户显式调用 `imm-brainstorm`、`imm-planner` 或 `imm-loop`。普通 host input
不会扫描 `.imm`、不会安装项目契约，也不会因为包含 mutation 词而自动改写为 Skill 调用。

### 2. 继续当前 owner

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
3. Parent 在前台调用一次 `imm_canary_enrollment` Tool，并直接消费 terminal result。Tool 冻结 Git index snapshot，通过 host-native `onUpdate`/`renderResult` 展示有界 stage，不写 Footer、不创建 Widget，也不要求轮询。每个 canonical verification descriptor 从同一个 frozen index 创建独立 copy；结果仅作为 enrollment baseline observation，`failed` 与 execution `timed_out` 不阻止新功能任务建立。descriptor 语法、runner/setup、取消、输出上限、scope/index drift 与 integrity drift 仍 fail closed。Escape/host cancellation 是唯一的 pre-commit cancellation path；commit owner 建立后 settlement 不可取消。
4. Enrollment 没有 waiver action 或兼容字段。无法证明 runner、隔离或 snapshot integrity 时必须修复根因后重试。
5. Agent 在当前 owner 内连续实现，并用 `git add -- <exact task paths>` 显式声明 task-owned `HEAD -> index` snapshot；禁止在 dirty worktree 使用 bulk staging。
6. `advance_assurance` 冻结 planning artifacts，并由 host deterministic QA 运行 acceptance descriptors；Kernel 在一个 mutation 内写入 QA attestation 与全部 acceptance results。
7. `routine` 在 QA 后完成；`material` 追加单一 Pi native Review 后自动完成；`critical` 在 QA 与 Review 后通过 `request_authorization` 要求 literal-user final authorization。
8. completion predicate 满足后，Kernel 将 `lifecycle` 转为 `done` 并释放 owner。

Managed freshness、QA、Review、authorization 与 completion 都绑定同一个 TaskRecord scope envelope 和 index-backed digest。范围外 unstaged、untracked 或 staged paths 不会进入 task snapshot，也不会使 evidence stale；范围内 unstaged/untracked bytes、index mutation、unsupported object mode、path ambiguity 或 `HEAD` 变化均在 authority write 或 Review spawn 前 fail closed。Review current bytes 由已捕获的 Git blob OID 提供，不读取 parent live worktree。

## 当前 authority 与存储

新的 Managed 生产路径使用 Assurance Kernel v4：

- `docs/plans/*.intent.json`：Git-tracked TaskIntent，保存目标、acceptance、scope hint、risk 与 revision；
- `.imm/tasks/<task-id>.json`：worktree-local TaskRecord v3，以 `lifecycle`、`artifact_state`、`attestations`、`findings` 与 `history` 保存唯一 durable workflow state；
- `.imm/workspace.json`：当前 worktree 的 Managed ownership；
- Kernel content-hash CAS、锁与 transaction marker：保证 mutation 失败关闭并可恢复。

TaskIntent 与 TaskRecord 是独立 authority。对话 memory、session ID、HANDOFF 文本或 reviewer 自报结果都不能替代 Kernel record。

### Legacy v3 边界

v3 mutating commands 已退出生产路径。历史 v3 State Ledger 只能通过显式 read-only legacy audit 读取；v4 不自动迁移，也不会在首次写入时隐式升级旧状态。仍有 nonterminal v3 owner 的项目必须使用先前 runtime 完成 drain 或明确终止，之后才能进入 v4。

## 工作流入口

| 入口 | 用途 |
| --- | --- |
| `imm-brainstorm` | 澄清关键需求、约束和风险；不写计划或代码 |
| `imm-planner` | 为清晰的仓库变更创建或修订候选 Spec/TaskIntent；不自动 Enrollment |
| `imm-loop` | 消费已验证计划并协调执行、QA、Review、repair 与 settlement；不绕过 Planner 或 authority gate |

### Internal runtime operations

The following are runtime tools or TUI operations, not public Skills:

| 入口 | 用途 |
| --- | --- |
| `imm_canary_enrollment` | Parent 调用的 foreground Enrollment Tool；直接返回 bounded progress 与唯一 terminal result，不使用 background recovery |
| `imm_kernel_canary` | Parent 调用的 artifact freeze、assurance、authorization 与 completion Tool |



## Managed 角色边界

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| Planner | 定义 Managed Spec/TaskIntent | 实现代码、QA closure |
| Executor/host agent | 在当前 owner 范围内实现并运行 focused verification | 改写 authority、手写 acceptance evidence、给自己签发 QA/Review approval |
| Deterministic QA | 执行 acceptance descriptors 并原子写入 host-attested QA attestation | 编辑实现、接受 stale attestation |
| Native Reviewer | 对锁定 snapshot 提供 advisory verdict | 直接写 Kernel authority、修改文件 |
| Host authorization | 展示 exact operation 并绑定 literal-user confirmation | 推断或扩大用户批准内容 |
| Compounder | 对已闭合工作按需沉淀可复用知识 | 阻塞普通 host-native completion、处理未闭合工作 |

并行只用于无状态只读工作，例如仓库探索、独立 advisory review 或测试 probe。Task mutation、QA decision、review authority 与 owner transition 保持串行。

Legacy v3 mutation entrypoints are retired and are not new-task operation paths。
历史兼容 alias 也不再作为 public Skill；需要执行、Review 或 learning 时，统一由
`imm-loop` 通过内部 runtime role dispatch 完成。

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
