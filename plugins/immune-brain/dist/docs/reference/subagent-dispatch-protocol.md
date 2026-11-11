# Pi Subagent Dispatch Protocol

本文档定义 Immune-Brain workflow role 在 Pi 中调度 advisory child 的唯一可执行协议。公共 `clarify`、`draw-up`、`drive` 和 runtime 内部 roles 引用本协议，不内联另一套宿主分支。Claude Host 的 read-only role 派发见 [Claude Host Read-Only Agent Dispatch](#claude-host-read-only-agent-dispatch)；Pi 的调度规则不因该节改变。

## Claude Host Read-Only Agent Dispatch

On the Claude Host a read-only internal role is dispatched through the `Agent`
tool by its plugin agent type, not by prompt text alone:

| Internal role | Claude agent type | Tool allowlist |
|---|---|---|
| `qa` | `immune-brain:immune-brain-qa` | `Read, Grep, Glob` |
| `ui-review` | `immune-brain:immune-brain-ui-review` | `Read, Grep, Glob` |
| `advisory-reviewer` | `immune-brain:immune-brain-advisory-reviewer` | `Read, Grep, Glob` |
| `arch-explorer` | the Host's `Explore` agent | whatever the Host grants |

Each shipped definition is generated from the matching `runtime/prompts/` source
by the plugin build, so its body states the same role contract a Pi child
receives. The agent definition, not prompt text, bounds the role's tools: a
write, shell or dispatch tool absent from the allowlist is unavailable to the
child whatever its prompt asks for. `arch-explorer` ships no definition because
architecture exploration uses the Host's own read-only research agent, and a
second definition would fork a boundary the Host owns.

`code-review` is not in this table. The authoritative Review is not an
in-process agent: the Parent runs the returned `review_command` in its own
shell, in the task's working directory, and that process loads the packaged
`authority-review` skill (ADR 0037). Findings verification after such a Review
is a CLI process as well (ADR 0039): the Parent runs the returned
`verification_command` the same way. It keeps the verifier's read-only boundary
on Claude Code (`Read, Grep, Glob, Bash` with only read-only Git commands
allowed, as `immune-brain:immune-brain-review-verifier` does) because it must run
read-only Git commands against the immutable revision. A verification that
follows no CLI Review keeps that Host subagent dispatch.

On Pi the agent configuration belongs to the Pi user, and the read-only boundary
remains prompt text plus the `tool_policy` the delegation packet declares; Pi's
`Agent` has no `readonly` parameter. The Pi invocation and scheduling rules below
are unchanged.

## Eligibility

Before any dispatch, state the bounded question and scope: the question being
investigated, the named paths the probe may read, the expected evidence, and the
stop condition that closes the probe. A probe without a stated stop condition is
an open-ended sweep, not a bounded one.

Read known paths directly first. Expand along proved callers, dependencies, and
state owners only when a concrete missing fact requires it, and stop once the
question is closed; do not continue reading because a path is nearby. Repository-wide
listings, unrelated directories, and other projects' session logs are out of
scope. Project-specific log or history searches stay inside the named project
paths; do not scan external session directories unless the user explicitly asks.

A scout probe carries an explicit read budget: at most 50,000 bytes per directory
and 300 lines per file, reading interface, schema, and header files in full
first, entry files next, and remaining source in alphabetical order. A probe that
exceeds its budget stops and reports what it covered, not what it skipped.

派发前依次执行：

1. 从任务摘要、changed paths 和显式请求分类为 `trivial`、`single_domain`、`multi_domain` 或 `high_risk`。
2. 优先读取 `CONTEXT.md` Architecture Map、当前任务证据和相关 `docs/solutions/`，避免每个 child 重复探索。
3. 低风险单领域任务可在一次直接验证可关闭时走 solo；多领域、高风险、显式 subagent 请求或有明确 bounded probe 时才派发。
4. 只有边界清晰、Pi 暴露 `Agent` 工具且满足 authorization 时才派发。

常用 fallback reason：`cost_scope_mismatch`、`unavailable_environment`、`host_authorization_required`、`trigger_not_hit`、`unclear_boundary`。

### Parallel Local Calls And Partial Results

Independent local calls may be issued together and their results inspected
together, `Promise.allSettled`-style, so one failure does not discard the other
results. Dependent actions stay ordered: an action that needs another's output
waits for it. Do not use a settled-all barrier for work that has a real sequence
dependency.

When output is truncated, continue in bounded pages only while the material is
still needed for the question; do not restart the read from the top or expand it
into a full-file sweep. Before retrying an operation that may have partially
succeeded, inspect what it already produced: a partial edit or partial write is
retried only for the part that is actually unfinished, never replayed wholesale.
Telemetry and tool-call counts are observational; they never justify omitting
evidence the question still requires, and they are not comparable to another
session's numbers unless the inputs and environment match.

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
authority Review instead takes its model from `review_profile`, which resolves
`lanes.review_host`, `lanes.review_model` and `lanes.review_effort` (ADR 0037).
Findings verification returns a complete foreground `Agent` envelope with empty
`name`, `model`, `thinking`, `resume`, and `schedule` fields so Pi Host resolves
the verifier's agent configuration. A compatible foreground Agent adapter must expose the reserved
dispatch and its paired result to the host's receipt observer. The Parent submits
without a verdict to apply those observed bytes; a provided verdict must match
the correlated receipt. Dispatch/result correlation is part of the local authority
contract.

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

Pi `Agent` has no `readonly` parameter; the empty tool policy, child type, and prompt contract enforce the read-only boundary. The Parent starts one foreground Agent at a time and consumes its direct result before deciding whether another child is needed. Advisory and discovery work does not poll for deferred results or depend on completion notifications or host `followUp`. Kernel findings verification uses `subagent_type: "Review"`; its structured result is submitted by the Parent and validated against the current immutable snapshot. Authority Review is not an Agent dispatch: the Parent runs its `review_command` process instead. Loop `arch-explorer` uses `subagent_type: "Explore"`; other advisory/discovery and Loop internal roles use `general-purpose`.

Authority Review runs no Agent dispatch. The Parent runs the returned
`review_command` (`sh <script>`) in the task's working directory and calls
`submit_review` after the process exits. The runtime writes
`review-packet-<operation>.md` beside `evidence.json` without changing the
manifest bytes, and the script writes the reviewer's output under a temporary
name and its exit status last, so a present exit file marks a complete output.
The packet's first line is `review_contract_hash: <hash>`; the `authority-review`
skill compares it with the hash it carries and replies exactly
`REVIEW_CONTRACT_MISMATCH <hash>` instead of reviewing when the two differ.
Reservation release removes the packet and output with the evidence directory; a
new reservation writes a new operation-named packet. A running process retains
the reservation; a non-zero exit or empty output (`review_process_failed`), a
contract mismatch (`review_contract_mismatch`), or a changed tree
(`review_tree_changed`, over HEAD, the index and tracked content) releases it
without a Review round.

## Advisory Child In A Supervised Session

Supervised Session Port (ADR 0038, #426 S2). This applies only when
`lanes.advisory_transport` resolves to `herdr` and `imm-session probe --provider
herdr` succeeds; otherwise the in-process dispatch above applies, and nothing is
detected or substituted. It applies to `advisory-reviewer` and `arch-explorer`
alone: `qa`, `ui-review`, findings verification and the authority Review keep
their own transports. Eligibility, authorization, trigger matching, the
candidate budget and result synthesis are unchanged; only where the child runs
and how its text returns differ.

1. Create the child's session, which opens a tab the user can watch:
   `imm-session create --provider herdr --cwd <repository or Lane> --label <role> --host <Parent Host> --entry "<dispatch text> <instruction>" -- <host arguments>`.
   The dispatch text is the same bounded packet an in-process child receives
   (role, objective, path shard, `boundary: advisory-only`). `<instruction>` is
   the fixed sentence `ADVISORY_RESULT_INSTRUCTION` in
   `runtime/session/marked_result.ts`: it asks for a closing block between a line
   `IMM-ADVISORY-` + `BEGIN` and a line `IMM-ADVISORY-` + `END`, spelled in parts so
   the echoed prompt is never a result. On Claude Code the host arguments are
   `--tools Read,Grep,Glob --permission-mode dontAsk`, which bound the session to
   the role's read-only allowlist; on Pi and Antigravity the boundary stays the
   prompt contract, as for their in-process children.
2. Wait in the foreground with `imm-session await <handle> --provider herdr
   --timeout-ms <the child's remaining budget>`. `blocked` is a dialog the user
   answers; the Parent sends it nothing and reports it.
3. Read the result with `imm-session read <handle> --provider herdr --source
   scrollback --lines 2000 --extract advisory`. Its `result` is the child's
   output. `result: null` (no complete marked block), a `timeout` or `exited`
   is `result_untrusted`: the output is discarded and never retried
   automatically, exactly as a failed in-process child.
4. A follow-up question to the same child, within the same budget, goes through
   `imm-session send <handle> --provider herdr --text "<question> <instruction>"`,
   then steps 2 and 3 again.
5. When the result is consumed, stop the child's session with
   `imm-session stop <handle> --provider herdr`. An advisory session is the
   Parent's own and holds no Lane; the Lane rules that keep Executor sessions
   open do not apply to it.

The screen is read only for this marked result; the child's progress, tool
calls and any other text are for people. A result read this way carries no more
authority than an in-process child's: advisory only, never a QA closure, a
Review verdict or a workflow write.

## Scheduling And Visibility

1. Planning、repository exploration、specialist advisory Review 和 work probe 必须 foreground 执行。Parent launches one child at a time，消费 direct terminal result，并在每个结果后 re-evaluates the remaining dispatch budget；不得把多个 foreground Agent 假定为并发 batch。
2. 普通 interactive advisory 不建立 acknowledgement deadline、后台 progress UI、completion push 或 late-notification recovery。活跃 Agent 使用 Pi 原生 foreground Tool row、host cancellation 和 steer。Footer 保持严格为空；No defined-value `setStatus` call is allowed。
3. Kernel Assurance runs in the foreground Tool call. `advance_assurance` awaits deterministic QA, emits bounded native updates, and returns `review_ready` with `review_command` and `review_profile`. The Parent runs that command in its own shell, then calls `submit_review`: omitting the verdict applies the reviewer process's output bytes, or the Parent may relay the reviewer's structured verdict for fingerprint comparison. Findings verification keeps its foreground `Agent` parameters. `request_authorization` is the only literal-user confirmation path. AbortSignal cancellation before authority commit and snapshot/CAS revalidation remain mandatory.
4. Kernel Assurance chat uses native Tool rendering only. It does not publish completion messages or wake a later parent turn; the direct Tool result is the continuation boundary. `awaiting_user` remains valid until the host-built authorization operation is confirmed and the immutable snapshot is revalidated.
5. Child 不得再次派发 child，nested delegation 一律禁止。Parent 保留综合与最终判断责任。
6. Kernel authority Review 对每个 immutable snapshot 恰好一个 primary reviewer，turn 预算按 workload 缩放（Quick 12 / Standard 16 / Heavy 24），并使用该 snapshot 对应的 Quick/Standard/Heavy 执行档位；不存在从 initial dispatch 起算的单一端到端总预算。Reviewer 必须先验证 immutable v5 manifest 的 `base_head`、`review_commit`、单一 parent、`review_tree` 与 `manifest_digest`，再用只读 Git 命令从 synthetic revision 获取源码；manifest 只有 metadata，不复制 source bytes，也不枚举 neighborhood files。审查只围绕 acceptance assertions 与 `changed_paths`，未变更路径只有在 acceptance、changed caller 或同一 state machine 直接需要时按需读取并注明理由；Reviewer 不探索无关 repository paths。对 settlement-class change，Reviewer 必须先枚举 immutable revision 内每条 terminal、cancellation、timeout 与 race path，再对全部路径给出判断；finding summary 必须以受影响路径开头。每个 acceptance 的执行结果已由 deterministic QA 在 review 前验证并内嵌于 manifest 的 `outcomes` 字段（acceptance_id -> {status, summary}）；Reviewer 不得重跑 descriptor，也不得把本地没有测试运行当作 finding——Review 只审 revision provenance、代码正确性、回归、安全与缺失测试。除该 reviewer 外，同一触发点最多两个相互独立的 advisory/discovery children；它们只能并行读，不能写 workflow state、关闭 QA 或产生 authority。
7. Foreground assurance never sleeps, polls, or schedules a completion callback. One Tool call owns QA; one Parent turn obtains and submits the reviewer verdict. User authorization is reserved for unresolved decisions, explicit stop, and breaking Intent revisions; no risk tier adds a generic final confirmation.
8. `submit_review` validates the verdict contract, task identity, immutable snapshot digest, and fresh record/Intent/workspace/diff revisions before applying Review authority. An omitted verdict applies the reviewer process's output bytes (ADR 0037); a relayed verdict must fingerprint-match them. Findings verification keeps the host-observed receipt edge of ADR 0017 — the Claude host observes its dispatch hook log and the Pi host its generic `Agent` tool events correlated by the reserved prompt — and a submission with no recorded observation fails closed. Malformed verdicts are retryable without rebuilding evidence. Stale verdicts leave the TaskRecord unchanged and release the stale reservation.
9. The assurance Tool checks the immutable snapshot before each phase and returns a terminal structured state directly: `cancelled`, `rework`, `review_ready`, `awaiting_user`, `blocked`, or `settlement_unknown`. The commit boundary is non-cancellable. No silent task, status timer, completion notification, or result retrieval path is permitted.

## Result Synthesis

Parent workflow role 必须：

1. 每次消费一个 child 的 direct result 后再决定是否启动下一个候选。
2. 合并并去重 findings。
3. 保留 source lens 和 candidate attribution。
4. 把 partial/error 标记为 `degraded`。
5. 保留自身 baseline review，不把最终判断权交给 child。
6. 报告 partial 结果时说明哪些部分已完成、哪些仍未完成，不把部分结果当作完整结果。

普通 advisory/discovery 的每次启动都消耗一个 candidate budget slot；失败、取消、timeout 或 result_untrusted 均丢弃该输出且不得自动重试。Parent 仅在剩余候选仍独立有用且 evidence budget 仍需要时继续，否则转 solo/fail-closed fallback，并记录 `dispatch_failed` 或 `child_timeout`。Read-only eligibility 与 Pi 的 one-foreground-child 调度限制是两回事：只读调查可同时存在多个待派发候选，但实际执行仍逐个 foreground child 串行消费，不得把多个 foreground Agent 假定为并发 batch。该规则不改变 Kernel authority Review 的显式恢复协议。Child 永远不获得实现、Plan write、workflow mutation 或 QA closure authority。

If the Kernel Review process fails, the Parent does not call `submit_review` with a substitute verdict; the existing Review reservation and immutable evidence remain available for a later retry. A malformed verdict may be corrected and resubmitted. A stale snapshot, explicit release, successful settlement, or session shutdown removes the reservation and evidence. There is no retry counter or provider-specific recovery path; the only observation record is the reviewer output bound to the reservation for receipt-bound submission.

Review isolation is a stop-rule, not a fallback: a Kernel Review runs only in a
fresh reviewer process that carries no Parent conversation. If the Host cannot
start one (the configured executable is absent), Review preparation fails closed
with `review_host_unavailable` and one recovery action — never fall back to
reviewing in the Parent's own session, and never treat the Parent's own judgment
as a Review verdict. The reservation waits for a later retry and fails closed on
shutdown.

This protocol is provider- and host-adapter-agnostic for local execution.
