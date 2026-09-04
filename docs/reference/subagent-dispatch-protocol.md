# Pi Subagent Dispatch Protocol

本文档定义 Immune-Brain workflow role 在 Pi 中调度 advisory child 的唯一可执行协议。公共 `imm-brainstorm`、`imm-planner`、`imm-loop` 和 runtime 内部 roles 引用本协议，不内联另一套宿主分支。

## Eligibility

派发前依次执行：

1. 从任务摘要、changed paths 和显式请求分类为 `trivial`、`single_domain`、`multi_domain` 或 `high_risk`。
2. 优先读取 `CONTEXT.md` Architecture Map、当前任务证据和相关 `docs/solutions/`，避免每个 child 重复探索。
3. 低风险单领域任务可在一次直接验证可关闭时走 solo；多领域、高风险、显式 subagent 请求或有明确 bounded probe 时才派发。
4. 只有边界清晰、Pi 暴露 `Agent` 工具且满足 authorization 时才派发。

常用 fallback reason：`cost_scope_mismatch`、`unavailable_environment`、`host_authorization_required`、`trigger_not_hit`、`unclear_boundary`。

## Authorization

Canonical project grant:

> This project authorizes bounded read-only advisory subagents and parallel probes unless the user asks for solo work.

Eligibility 与 authorization 是不同门槛：

1. 用户显式 solo/no-subagent 会拒绝派发。
2. 当前请求显式要求 subagent 会授权该请求。
3. 当前 session 的用户授权可覆盖后续符合边界的派发。
4. 项目 `AGENTS.md` 的 standing authorization 仅在 Pi host policy 接受时有效。
5. 否则走 solo，并记录 `host_authorization_required`。

不得把项目指令描述为覆盖 Pi tool policy；也不得伪装发生过 child review。

## Trigger Matching

Parent 根据任务目标、changed paths 与显式请求选择 bounded advisory role。只有明确命中才派发；每个 child 只获得与其 role 相关的 path shard。未匹配文件只进入共享摘要，不复制整份 diff。

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

## Model Selection

Immune-Brain owns Role, evidence, authority, tool policy, and output contracts.
Pi Host owns model, provider, and thinking defaults. Immune-Brain does not define
model tiers, provider mapping, cost routing, or provider fallback.

Agent defaults to the current Pi session model. Only an explicit Parent requirement
selects another Pi-configured model through host-native `Agent.model`. Kernel
Review returns a complete foreground `Agent` envelope with empty `name`, `model`,
`thinking`, `resume`, and `schedule` fields so Pi Host resolves the Review agent
configuration. The Parent may use any compatible foreground Agent adapter and
submits the resulting structured verdict directly; lifecycle event matching is
not part of the local authority contract.

## Pi Agent Invocation

```text
Agent:
  subagent_type: "general-purpose"
  description: "<role>/<lens> review"
  prompt: <delegation packet>
  name: <optional; empty for Kernel authority Review>
  model: <optional Pi-configured model id; empty to inherit the Review agent config>
  thinking: <optional; empty to inherit the Review agent config>
  inherit_context: false
  run_in_background: false
  resume: ""
  schedule: ""
```

Pi `Agent` has no `readonly` parameter; the empty tool policy, child type, and prompt contract enforce the read-only boundary. The Parent starts one foreground Agent at a time and consumes its direct result before deciding whether another child is needed. Advisory and discovery work does not call `get_subagent_result` or depend on completion notifications or host `followUp`. Kernel Review uses `subagent_type: "Review"`; its structured verdict is submitted by the Parent and validated against the current immutable snapshot. Loop `arch-explorer` uses `subagent_type: "Explore"`; other advisory/discovery and Loop internal roles use `general-purpose`.

## Scheduling And Visibility

1. Planning、repository exploration、specialist advisory Review 和 work probe 必须 foreground 执行。Parent launches one child at a time，消费 direct terminal result，并在每个结果后 re-evaluates the remaining dispatch budget；不得把多个 foreground Agent 假定为并发 batch。
2. 普通 interactive advisory 不建立 acknowledgement deadline、后台 progress UI、completion push 或 late-notification recovery。活跃 Agent 使用 Pi 原生 foreground Tool row、host cancellation 和 steer。Footer 保持严格为空；No defined-value `setStatus` call is allowed。
3. Kernel Assurance runs in the foreground Tool call. `advance_assurance` awaits deterministic QA, emits bounded native updates, and returns `review_ready` with foreground `Agent` parameters. The Parent invokes a reviewer, reads its direct result, and passes the structured verdict to `submit_review`. `request_authorization` is the only literal-user confirmation path. AbortSignal cancellation before authority commit and snapshot/CAS revalidation remain mandatory.
4. Kernel Assurance chat uses native Tool rendering only. It does not publish completion messages or wake a later parent turn; the direct Tool result is the continuation boundary. `awaiting_user` remains valid until the host-built authorization operation is confirmed and the immutable snapshot is revalidated.
5. Child 不得再次派发 child，nested delegation 一律禁止。Parent 保留综合与最终判断责任。
6. Kernel authority Review 对每个 immutable snapshot 恰好一个 primary reviewer，turn 预算按 workload 缩放（Quick 12 / Standard 16 / Heavy 24），并使用该 snapshot 对应的 Quick/Standard/Heavy 执行档位；不存在从 initial dispatch 起算的单一端到端总预算。Reviewer 必须先验证 immutable v5 manifest 的 `base_head`、`review_commit`、单一 parent、`review_tree` 与 `manifest_digest`，再用只读 Git 命令从 synthetic revision 获取源码；manifest 只有 metadata，不复制 source bytes，也不枚举 neighborhood files。审查只围绕 acceptance assertions 与 `changed_paths`，未变更路径只有在 acceptance、changed caller 或同一 state machine 直接需要时按需读取并注明理由；Reviewer 不探索无关 repository paths。对 settlement-class change，Reviewer 必须先枚举 immutable revision 内每条 terminal、cancellation、timeout 与 race path，再对全部路径给出判断；finding summary 必须以受影响路径开头。每个 acceptance 的执行结果已由 deterministic QA 在 review 前验证并内嵌于 manifest 的 `outcomes` 字段（acceptance_id -> {status, summary}）；Reviewer 不得重跑 descriptor，也不得把本地没有测试运行当作 finding——Review 只审 revision provenance、代码正确性、回归、安全与缺失测试。除该 reviewer 外，同一触发点最多两个相互独立的 advisory/discovery children；它们只能并行读，不能写 workflow state、关闭 QA 或产生 authority。
7. Foreground assurance never sleeps, polls, or schedules a completion callback. One Tool call owns QA; one Parent turn obtains and submits the reviewer verdict. User authorization is reserved for unresolved decisions, explicit stop, and breaking Intent revisions; no risk tier adds a generic final confirmation.
8. `submit_review` validates the verdict contract, task identity, immutable snapshot digest, and fresh record/Intent/workspace/diff revisions before applying Review authority. Malformed verdicts are retryable without rebuilding evidence. Stale verdicts leave the TaskRecord unchanged and release the stale reservation. Local execution trusts the Parent to relay the reviewer verdict and does not require Agent lifecycle receipts.
9. The assurance Tool checks the immutable snapshot before each phase and returns a terminal structured state directly: `cancelled`, `rework`, `review_ready`, `awaiting_user`, `blocked`, or `settlement_unknown`. The commit boundary is non-cancellable. No silent task, status timer, completion notification, or result retrieval path is permitted.

## Result Synthesis

Parent workflow role 必须：

1. 每次消费一个 child 的 direct result 后再决定是否启动下一个候选。
2. 合并并去重 findings。
3. 保留 source lens 和 candidate attribution。
4. 把 partial/error 标记为 `degraded`。
5. 保留自身 baseline review，不把最终判断权交给 child。

普通 advisory/discovery 的每次启动都消耗一个 candidate budget slot；失败、取消、timeout 或 result_untrusted 均丢弃该输出且不得自动重试。Parent 仅在剩余候选仍独立有用且 evidence budget 仍需要时继续，否则转 solo/fail-closed fallback，并记录 `dispatch_failed` 或 `child_timeout`。该规则不改变 Kernel authority Review 的显式恢复协议。Child 永远不获得实现、Plan write、workflow mutation 或 QA closure authority。

If Kernel Review dispatch fails, the Parent does not call `submit_review`; the existing Review reservation and immutable evidence remain available for a later foreground retry. A malformed verdict may be corrected and resubmitted. A stale snapshot, explicit release, successful settlement, or session shutdown removes the reservation and evidence. There is no retry counter, dispatch receipt state machine, or provider-specific recovery path.

This protocol is provider- and host-adapter-agnostic for local execution.
