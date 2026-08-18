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
  run_in_background: false
```

Pi `Agent` 没有 `readonly` 参数；只读边界由空工具策略、child 类型和 prompt contract 共同保证。Parent 每次只启动一个 foreground Agent，等待其 direct terminal result 后再决定是否需要下一个 child。普通 advisory/discovery 不调用 `get_subagent_result`，不依赖 completion notification 或 host `followUp`。

## Scheduling And Visibility

1. Planning、repository exploration、specialist advisory Review 和 work probe 必须 foreground 执行。Parent launches one child at a time，消费 direct terminal result，并在每个结果后 re-evaluates the remaining dispatch budget；不得把多个 foreground Agent 假定为并发 batch。
2. 普通 interactive advisory 不建立 acknowledgement deadline、后台 progress UI、completion push 或 late-notification recovery。活跃 Agent 使用 Pi 原生 foreground Tool row、host cancellation 和 steer。Footer 保持严格为空；No defined-value `setStatus` call is allowed。
3. Kernel Assurance runs in the foreground Tool call. `advance_assurance` awaits deterministic QA, emits bounded native updates, and returns a direct `review_ready` result containing exact `Agent` parameters with `run_in_background: false`. The Parent invokes that Agent once, then calls `submit_review` after the `tool_call`/`tool_result`/`tool_execution_end` bridge validates the receipt. `request_authorization` is the only literal-user confirmation path. AbortSignal cancellation is honored before the authority commit boundary; snapshot/CAS revalidation remains mandatory.
4. Kernel Assurance chat uses native Tool rendering only. It does not publish completion messages or wake a later parent turn; the direct Tool result is the continuation boundary. `awaiting_user` remains valid until the host-built authorization operation is confirmed and the immutable snapshot is revalidated.
5. Child 不得再次派发 child，nested delegation 一律禁止。Parent 保留综合与最终判断责任。
6. Kernel authority Review 对每个 immutable snapshot 恰好一个 primary reviewer，turn 预算按 workload 缩放（Quick 12 / Standard 16 / Heavy 24），并使用该 snapshot 对应的 Quick/Standard/Heavy 执行档位；不存在从 initial dispatch 起算的单一端到端总预算。Reviewer 必须先验证 immutable bundle provenance，只围绕 acceptance assertions 与 bundle 中的 `dirty_files`（diff payload）和 `neighborhood_files`（同状态机 context）内容审查，不探索无关 repository paths，并预留最后一轮输出唯一 strict JSON verdict。`path_provenance` 明确标记每个 bundled path 为 `diff` 或 `neighborhood`；所有 neighborhood context 只能从 canonical `scope_hint` 内的 Git index 选择，继续受单文件 256 KiB 与总包 2 MiB 上限约束，Reviewer 仍只能读取 bundle bytes。对 settlement-class change，Reviewer 必须先枚举 bundle 内每条 terminal、cancellation、timeout 与 race path，再对全部路径给出判断；finding summary 必须以受影响的 bundle path 开头，以便 verdict v2 引用 neighborhood context。每个 acceptance 的执行结果已由 deterministic QA 在 review 前验证并内嵌于 immutable bundle 的 `outcomes` 字段（acceptance_id -> {status, summary}）；Reviewer 不得重跑 descriptor，也不得把本地没有测试运行当作 finding——Review 只审 bundle provenance、代码正确性、回归、安全与缺失测试。除该 reviewer 外，同一触发点最多两个相互独立的 advisory/discovery children；它们只能并行读，不能写 workflow state、关闭 QA 或产生 authority。
7. Foreground assurance never sleeps, polls, or schedules a completion callback. One Tool call owns QA preparation and execution; one explicit Parent turn owns the native Agent receipt; one explicit authorization operation owns the user decision. Duplicate or stale event sequences fail closed and cannot create a second reviewer or authority write.
8. Review receipt validation requires the reserved operation, immutable snapshot digest, exact Agent parameters, matching tool-call ID, terminal tool result, and terminal execution event. Agent output is advisory and cannot apply Kernel authority. A malformed, cancelled, inverted, duplicate, or stale receipt leaves the TaskRecord unchanged; the user authorization operation revalidates record revision, Intent hash, workspace revision, and diff hash before applying the verdict.
9. The assurance Tool checks the immutable snapshot before each phase and returns a terminal structured state directly: `cancelled`, `rework`, `review_ready`, `awaiting_user`, `blocked`, or `settlement_unknown`. The commit boundary is non-cancellable. No silent task, status timer, completion notification, or result retrieval path is permitted.

## Result Synthesis

Parent workflow role 必须：

1. 每次消费一个 child 的 direct result 后再决定是否启动下一个候选。
2. 合并并去重 findings。
3. 保留 source lens 和 candidate attribution。
4. 把 partial/error 标记为 `degraded`。
5. 保留自身 baseline review，不把最终判断权交给 child。

普通 advisory/discovery 的每次启动都消耗一个 candidate budget slot；失败、取消、timeout 或 result_untrusted 均丢弃该输出且不得自动重试。Parent 仅在剩余候选仍独立有用且 evidence budget 仍需要时继续，否则转 solo/fail-closed fallback，并记录 `dispatch_failed` 或 `child_timeout`。该规则不改变 Kernel authority Review 的显式恢复协议。Child 永远不获得实现、Plan write、workflow mutation 或 QA closure authority。

Kernel authority Review 的 provider 失败分类（no-verdict dispatch failure）：standard Agent 派发因 provider quota/transport 失败（429/rate-limit/quota/overloaded/503/ECONN*/ETIMEDOUT）抛错时，归类为 no-verdict dispatch failure——零 authority 写入、reserved operation 保持有效、不产生 terminal review 事件、不消耗 review follow-up round，并允许对同一 reserved operation 恰好一次重派（reservation 复用）。第二次同类失败或非 provider 失败转入 `dispatch_unknown` settlement：reservation 释放、evidence artifact 在 terminal settlement 或显式 release 时移除。Immutable review bundle artifact（evidence.json）在 reservation 未 terminal 前永不被 GC；dispatch 或 settlement 发现 artifact 缺失时 fail closed、零写入，并通过重跑 review 命令暴露显式 re-reserve 路径。artifact 生命周期由 trigger（settle、release、crash、shutdown）x state（reserved、dispatched、settling、terminal）枚举，单 owner 每状态。

本协议是 provider-agnostic、Pi-host-specific：模型 provider 可变化，code-agent host 不可变化。
