# Pi Subagent Dispatch Protocol

本文档定义 Immune-Brain workflow role 在 Pi 中调度 advisory child 的唯一可执行协议。`imm-code-review`、`imm-ui-review`、`imm-brainstorm` 和其他可派发 role 引用本协议，不内联另一套宿主分支。

## Eligibility

派发前依次执行：

1. 从任务摘要、changed paths 和显式请求分类为 `trivial`、`single_domain`、`multi_domain` 或 `high_risk`。
2. 优先读取 `CONTEXT.md` Architecture Map、当前任务证据和相关 `docs/solutions/`，避免每个 child 重复探索。
3. 低风险单领域任务可在一次直接验证可关闭时走 solo；多领域、高风险、显式 subagent 请求或有明确 parallel probe 时才派发。
4. 从 `~/.pi/agent/immune-brain/config.toml` 解析 `auto|explicit_only|disabled`。
5. 只有边界清晰、Pi 暴露 `Agent` 工具且满足 authorization 时才派发。

常用 fallback reason：`cost_scope_mismatch`、`explicit_required`、`config_disabled`、`unavailable_environment`、`host_authorization_required`、`trigger_not_hit`、`unclear_boundary`。

## Authorization

Canonical session grant:

> This session authorizes Immune-Brain to auto-use bounded read-only subagents/parallel probes when the mode is auto and boundaries are clear.

Eligibility 与 authorization 是不同门槛：

1. 用户显式 solo/no-subagent 会拒绝派发。
2. 当前请求显式要求 subagent 会授权该请求。
3. 当前 session 的用户授权可覆盖后续符合边界的派发。
4. 项目 `AGENTS.md` 的 standing authorization 仅在 Pi host policy 接受时有效。
5. 否则走 solo，并记录 `host_authorization_required`。

不得把项目指令描述为覆盖 Pi tool policy；也不得伪装发生过 child review。

## Trigger Matching

根据 `docs/reference/subagent-trigger-catalog.yaml` 匹配 lens。只有明确命中才派发；每个 child 只获得与其 lens 相关的 path shard。未匹配文件只进入共享摘要，不复制整份 diff。

Delegation packet：

```text
shared_context_summary:
  goal: <goal>
  changed_surface: <bounded paths>
  project_constraints: <relevant constraints>

focus_delta:
  role: <reviewer role>
  lens: <one lens>
  specific_changes: <lens shard>
  audit_question: <one concrete question>
  tool_policy: no tools
  boundary: advisory-only; no code edits; no plan writes; no workflow-state mutation; no QA closure
```

## Model Resolution

按以下顺序取第一个非 `inherit` 值：

1. `[subagent_models.lens_overrides][lens]`
2. activation plan 的 `lens_model_tiers[lens]`
3. `model_tiers[candidate]`
4. 当前 Pi session model

Model ID 可以来自任意 Pi 已配置 provider。未解析到具体 ID 时省略 `model`。

## Pi Agent Invocation

```text
Agent:
  subagent_type: "general-purpose"
  description: "<role>/<lens> review"
  prompt: <delegation packet>
  model: <resolved model id; omit for inherit>
  inherit_context: false
  run_in_background: true
```

Pi `Agent` 没有 `readonly` 参数；只读边界由空工具策略、child 类型和 prompt contract 共同保证。并行 child 应在一个并行 dispatch 批次发起。Parent 不得轮询 `get_subagent_result`；completion notification 或 host `followUp` 是唯一正常完成信号，收到信号后才读取一次最终结果。

## Scheduling And Visibility

1. Planning、repository exploration、Review 以及其他耗时不可预知的 child 必须使用 `run_in_background: true`；只有一次性、短时、同步 lookup 才可 foreground。
2. Dispatch 后 250ms 内发布可见 acknowledgement，说明 role/lens、边界和 operation ID。耗时阶段使用 Footer/Widget 保持 stage、elapsed、deadline、cancel 状态；有原生 progress event 时推送 current activity，没有时明确显示 telemetry unavailable，不得虚构 tool/turn 进度。
3. Kernel Review 使用互不挤占的阶段预算：immutable snapshot/准备 30 秒、父 Agent 的标准 `Agent` receipt 120 秒、verdict freshness/parse 30 秒。执行档位只能从 frozen intent risk 和 immutable bundle 指标推导：Quick 为 5 分钟 soft / 15 分钟 stop，Standard 为 10/30 分钟，Heavy 为 20/60 分钟。Soft expiry 只投影 `slow` 并继续接收匹配 verdict；不能因缺少 native event 宣称 `stalled`。Stop threshold 请求停止后进入 settlement，native terminal 到达前不得发布 `timed_out` terminal。Deterministic QA 总预算为 `max(15 分钟, Σ descriptor timeout + 2 分钟)`；超过 60 分钟必须在首个 verifier 前拒绝，同时保留每个 descriptor 自身 timeout。
4. Chat 只记录 dispatch、major milestone、slow warning、terminal result 和 user authority request。每秒渲染只进入 transient Footer/Widget，不刷写 transcript。`awaiting_user` 不按墙钟过期，写 authority 前始终重验 snapshot；跨 session advisory/tombstone persistence 属于后续独立切片。
5. Child 不得再次派发 child，nested delegation 一律禁止。Parent 保留综合与最终判断责任。
6. Kernel authority Review 对每个 immutable snapshot 恰好一个 primary reviewer，turn 预算按 workload 缩放（Quick 12 / Standard 16 / Heavy 24），并使用该 snapshot 对应的 Quick/Standard/Heavy 执行档位；不存在从 initial dispatch 起算的单一端到端总预算。Reviewer 必须先验证 immutable bundle provenance，只围绕 acceptance assertions 与 bundle 中的 `dirty_files`（diff payload）和 `neighborhood_files`（同状态机 context）内容审查，不探索无关 repository paths，并预留最后一轮输出唯一 strict JSON verdict。`path_provenance` 明确标记每个 bundled path 为 `diff` 或 `neighborhood`；所有 neighborhood context 只能从 canonical `scope_hint` 内的 Git index 选择，继续受单文件 256 KiB 与总包 2 MiB 上限约束，Reviewer 仍只能读取 bundle bytes。对 settlement-class change，Reviewer 必须先枚举 bundle 内每条 terminal、cancellation、timeout 与 race path，再对全部路径给出判断；finding summary 必须以受影响的 bundle path 开头，以便 verdict v2 引用 neighborhood context。每个 acceptance 的执行结果已由 deterministic QA 在 review 前验证并内嵌于 immutable bundle 的 `outcomes` 字段（acceptance_id -> {status, summary}）；Reviewer 不得重跑 descriptor，也不得把本地没有测试运行当作 finding——Review 只审 bundle provenance、代码正确性、回归、安全与缺失测试。除该 reviewer 外，同一触发点最多两个相互独立的 advisory/discovery children；它们只能并行读，不能写 workflow state、关闭 QA 或产生 authority。
7. Background completion 必须 push 回 parent；不得 sleep、busy-wait 或周期调用 status/get-result。重复 completion/follow-up 以 `(task_id, operation_id, role)` 去重，任何 competing terminal 类型共享同一 single-terminal CAS。所有 Assurance follow-up 的显示文本必须携带 task_id 与 operation_id，使旧 operation 的迟到投递可从文本直接区分；对已结算、已被更新 operation 取代或任务已 terminal 的迟到投递，必须标注 `[superseded]` 且不得提示用户对过期状态采取动作。
8. Review timeout/cancel 后，在 reserved Review observation 结束前必须保留 snapshot-scoped ownership；重复 advance 不得请求第二个 reviewer，Kernel authority Review 也不得自动重试。Production Review 通过父 Agent 的标准 `Agent` tool dispatch，不发射 `subagents:rpc`，也不把共享 `subagents:*` 事件当 settlement。后台 `Agent` `tool_execution_end` 只是 spawn 回执；advisory JSON 只能来自 reserved `get_subagent_result`。只有 agent identity 与 reservation 匹配且 status 经显式 allowlist 验证为 terminal 的 `get_subagent_result` 才能结算；standard Agent 与 injected adapter result 各自与 host terminal receipt 保持独立，`handle.result` 仅承载 advisory，绝不能用于 verdict parsing 或赋给 `hostTerminalReceipt`，local result resolve/reject 也不能结算 host receipt；stop acknowledgement 与任何 nonterminal/unknown status 均不构成 terminal，late injected handle 也不得回退到 local result。Stop helper 只有在该 receipt 已验证并作为 branded `native_terminal` receipt resolve 后才返回同一 branded outcome；validated native failure status 必须作为该 resolved receipt 内的 failure payload，不能通过 deferred rejection 表示。Host receipt rejection 属于未验证 settlement，helper 必须 reject、保留 ownership 与 immutable evidence，并执行零 terminal follow-up；caller 只在 resolved branded outcome 上发布 terminal 和释放 settlement，cleanup error 只作为 receipt 后 telemetry。测试注入的 unknown-settlement Promise 仍 fail closed，不得用释放 ownership 伪造 child terminal。Reviewer-local finding ID 不可直接写入 append-only TaskRecord；Host 必须用 snapshot digest 和 finding ordinal 生成 deterministic canonical ID，并把该 ID 同时显示在确认框、绑定 capability digest、写入 reducer action。
9. Agent-callable advance 必须把 preflight 的 TaskRecord revision、Intent hash 与 diff hash 注入后台 job。Pre-dispatch preparation failure/cancellation 只结束本地 startup lifecycle，不发布 correlated native terminal follow-up。Dispatch 一旦开始但未返回 handle 或 validated receipt，必须进入 `dispatch_unknown`、保留 immutable evidence 且不发布 terminal；不得降级为 `failed`/`timed_out`，也不得调用 provider stop RPC。所有 TUI authority invocation 在每个退出路径都必须从 session cleanup 集合移除，避免后续 token replacement 使 shutdown cleanup 处理 stale nonce。

## Result Synthesis

Parent workflow role 必须：

1. 收集全部 child 结果或 timeout。
2. 合并并去重 findings。
3. 保留 source lens 和 candidate attribution。
4. 把 partial/error 标记为 `degraded`。
5. 保留自身 baseline review，不把最终判断权交给 child。

第一次普通 advisory/discovery 派发失败可按相同 packet 重试一次；第二次失败转 solo，记录 `dispatch_failed`。该通用重试规则不适用于 Kernel authority Review；其 timeout/cancel/failed 结果必须停在显式恢复边界，不自动重试。Timeout 记录 `child_timeout`。Child 永远不获得实现、Plan write、workflow mutation 或 QA closure authority。

Kernel authority Review 的 provider 失败分类（no-verdict dispatch failure）：standard Agent 派发因 provider quota/transport 失败（429/rate-limit/quota/overloaded/503/ECONN*/ETIMEDOUT）抛错时，归类为 no-verdict dispatch failure——零 authority 写入、reserved operation 保持有效、不产生 terminal review 事件、不消耗 review follow-up round，并允许对同一 reserved operation 恰好一次重派（reservation 复用）。第二次同类失败或非 provider 失败转入 `dispatch_unknown` settlement：reservation 释放、evidence artifact 在 terminal settlement 或显式 release 时移除。Immutable review bundle artifact（evidence.json）在 reservation 未 terminal 前永不被 GC；dispatch 或 settlement 发现 artifact 缺失时 fail closed、零写入，并通过重跑 review 命令暴露显式 re-reserve 路径。artifact 生命周期由 trigger（settle、release、crash、shutdown）x state（reserved、dispatched、settling、terminal）枚举，单 owner 每状态。

本协议是 provider-agnostic、Pi-host-specific：模型 provider 可变化，code-agent host 不可变化。
