# Rework 根因分析与最小改进方案

## 结论

近期返工的主要可观察模式是：实现和测试围绕当前触发点收口，未一次覆盖同一不变量的真实入口、共享调用方及证据消费链。测试通过后，Review 继续发现相邻边界；部分修复还改变同步/异步契约，引出新的调用方回归。

优先改进首次 Assurance 前的证据核对和返工修复范围。现有 Loop 已要求第二次相同 acceptance/anchor 返工时覆盖已知触发类；再增加通用口号的收益有限。将这条要求落实为简短、可核对的交付表，保留独立 QA/Review。此报告不实施运行时代码变更，不恢复任何任务。

## 范围与证据可信度

- 分析 Git HEAD：`80dc66fcf3038415c785646d21806578be26ed3e`。工作区已有大量 staged 实现/test 改动，因此当前代码核对描述的是工作区，不声称全部已提交或发布。
- 证据仅为本项目 `.imm/audit/**/{task-record,terminal-proof}.json`。不访问外部 session、运行中 authority 数据库或其他项目。
- Inventory：192 个 record，v4 113、v3 9、v2 70；均有 terminal timestamp；按 task_id + terminal_event_id 核对没有镜像重复。
- 基线：按 proof.terminalized_at UTC 倒序、路径倒序稳定打破同时间并列，选最新 10 个终态 run。窗口为 2026-10-06T01:46:47.155Z 至 2026-10-08T04:00:43.604Z；这十个恰好均 done。
- 为纳入停止案例，另取最近一个 stopped run；为分析近期长尾，另取最近 35 个终态 run 中除基线外 Review rework ≥4 的三个 run。补充样本单独计数，不混入基线比例。
- 14 个选定 run 均为 v4，核验 canonical JSON（两空格、原 Unicode、末尾换行）的 SHA-256、task identity、terminal lifecycle、最后事件 ID/type/state transition/time 与 proof 一致。哈希一致只证明记录相互一致，不证明独立真实性。
- 其余 178 个 run 没有做逐条内容分析；未终态或未导出任务不可见，存在 terminal-sample bias。token 成本、用户等待时间、交付后逃逸缺陷未知。
- 成功 attestation、request_rework event 与 finding 条目分别计数。Review 轮次按 review rework events + review pass attestations 计算，是持久化 verdict 轮次，不是 Agent 调用次数。样本 findings 未记载 missing-agent/empty-verdict 原因，不能因此证明没有未入库的基础设施抖动。

## 三个根因与解决方案

### 1. 首修与返工没有沿完整调用链覆盖同一规则（最高优先级）

**事实：** `single-enrollment-entry` 五轮 Review 返工依次涉及：

1. `review-53b3befb36e4-1-review-1` / AC1：新公开入口先 rehearsal，挡住已提交请求的 durable replay。
2. `review-527c27becea5-1-review-1` / AC2：测试未通过真实 AbortSignal 验证提交开始后的取消。
3. `review-5afc5547de1e-1-review-1` / AC2：optional checkpoint 的 overload 声明与实际返回不一致。
4. `review-4a07dd34dc81-1-review-1` / AC2：同步链没有让出执行，排队 microtask 的取消无法在 commit 前到达。
5. `review-41ce1c393262-1-review-1` / AC3：修为 async 后，Claude 的 try/catch 内 return 未 await，丢失初始化提交的失败诊断。

这不是五次相同缺陷；AC2 重复三轮，分别暴露测试、类型和实际时序边界。最后一项明确是前次修复改变调用契约后的后续遗漏。

`batch-plan-reconfirmation` 的 `review-89823db1036d-1-review-1`、`review-fc8f40ce327a-1-review-1`、`review-c4589b9ad8d9-1-review-1` 则从 proof 来源校验逐步追到 fresh confirmation 分支、commit adoption 和 reviewed source identity。helper 拒绝不等于公开入口也拒绝。

**解释：** 最有依据的是影响分析停在局部 helper/某一入口；返工按 finding 的位置修改，没有把被违反的规则写成相关入口共同遵守的条件。仅由轮数不能推出任务太大或模型太弱。

**反证/现状：** 最新十个任务有七个没有 Review rework；`deepen-authority-seams.spec.md` 已采用 characterization-first、列出 agreed seams 和 controls，说明规划并非完全缺失。当前 enrollment.ts 已有 replay 优先、准确 overload 和取消让出点，Claude 已使用 return await；历史 finding 标为 resolved，不作为当前缺陷。

**方案：** 首次 Assurance 前列出“acceptance → 真实入口/调用方 → 关键时序或写读链 → 测试证据”；共享接口改成 async、变更返回类型或异常传播时，逐个核对实际调用方。返工时先给出规则及其已知触发类，再修共同边界；相同 AC 第二次返工后必须完成这一步，再进入下一轮 Assurance。沿用现有 scope 扩展机制，不偷偷修改范围外文件。

### 2. 测试证明的是构造出的 fixture，未证明实际验收条件（高优先级）

**事实：** `pi-batch-acceptance-s0-completion-verifier` 有八次 Review rework：

- `review-42b97049cc84-1-review-1`、`review-36495b293954-2-review-2`、`review-4a8c2c9287c7-3-review-3` 连续指出 author 与真实 runner 不符。相应 run ID 也连续三轮被指出固定为 task-derived ID，而生产是 UUID。
- `review-42e87786a16d-3-review-3`：symlink 负例没有初始化 Git repository，只断言 exit 2，实际因 repository-root 检查失败；移除 symlink 防护仍会通过。
- `review-f320ba9f91b0-2-review-2`、`review-8c45c6f19fe1-3-review-3`：Git status/tree OID 不等于原始 index/state/authority 字节未变；空 authority fixture 不能证明已有 authority 内容被保护。
- `workflow-decision-closure-s7` 的 `review-bfc0354582bd-1-review-1` 与 `review-d3f23f6edd95-1-review-1`：criteria_met 数值一致仍不能证明每条 checklist 有对应观察证据。
- 基线 `single-delivery-identity` 的 `review-60ef45c07310-1-review-1`：双宿主验收只调用 Claude/shared selector，漏掉 Pi；第二条 finding 把 batch base_head 与 child git_base_head 的区别指出来。

**解释：** 把“检查成功”当成“检查已经证明所声称条件”。手工 fixture 与生产约定偏离，或者负例的失败原因没有定位到目标条件，都会让 QA 通过、Review 继续返工。

**反证/现状：** 当前 completion verifier 已使用 raw Buffer、严格 UTF-8 decode、40/64 位 OID、terminal event 检查；其测试已调用 commitBatchChild 并比较实际 index bytes。这里不建议重复修复这些历史实现。QA 历史失败仅留 exit/timeout/byte counts，具体原因未知，不能全部归到同一类。

**方案：** 在现有 agreed seam 建立真实正例，优先使用实际 producer；负例从这个成功状态只改变目标条件，断言明确拒绝原因及要求的副作用。零写入要求比较相关原始文件/index/refs；语义质量要求逐条对应 checklist 的具体观察，不能只核对总数。测试设计以“删掉目标保护后，此测试还会不会通过”为自查。

### 3. 本地诊断与正式 delivery/snapshot 条件不一致，增加额外返工（中优先级）

**事实：** 基线有八个 QA request_rework execution events、九条 execution findings；其中同一个 single-enrollment-entry 的 AC3 连续失败三次，shared-batch-child-kernel-port 的 AC1 连续失败两次。审计只记录 exit/timeout/byte counts，不能据此断定依赖、打包或源码是哪一种根因。

最近 stopped 案例 `review-host-handback-block-order` 的 `review-c4d4949bb35c-1-review-1` 明确指出 immutable review tree 等于 base tree，changed_paths 为空。stop event 原因记录为实现先于 Enrollment staged，导致没有进入本次 review identity；第二条 finding 指出该空 revision 仍含原始 handback 顺序缺陷。这是交付证据偏离的直接案例，不是普通内容返工。

`pi-batch-acceptance-s0-completion-verifier` 的 `review-131962e025b9-2-review-2` 还发现新脚本类型错误：focused test pass 没证明项目 typecheck。

**反证/现状：** 当前 Loop 已说明 QA 在 disposable delivery materialization 运行，并要求 submit_review 先于编辑；项目已有 dirty-scope 和 snapshot 保护。停止案例发生于历史版本，不能宣称当前仍能复现相同缺陷，也不把所有 QA 失败归因于环境。不同 evidence bindings 的 QA 重跑不能当作无意义重复。

**方案：** 在 Enrollment 前遵守现有 dirty-scope 前置条件；正式 Assurance 前核对任务改动全部在 scope/index 中，生成 bundle 同步，并运行适用的 typecheck。对再次出现的 QA 失败，取得安全的即时诊断后复现实际 delivery 条件再修，不能只重复工作区命令。需要改变 runtime 防护时，先复现当前公开入口，避免对历史缺陷重复建设。

## 推荐下一步：只做一个有限试点

**首选：把现有规则落实为 Executor 交付表，覆盖接下来五个共享接口或持久化任务。** 不引入新角色、状态字段或额外审批。

| 列 | 必须回答的问题 |
|---|---|
| Acceptance / 规则 | 本次必须始终成立的具体条件是什么？ |
| 真实入口与 consumer | Pi、Claude、batch 哪些受影响？写入、解析、reload、恢复分支是否走过？ |
| Positive / negative / bound | 正例能成功？负例只改变目标条件？类型、取消、错误和重放边界如何证明？ |
| 命令和输入身份 | 哪个 focused check，检查的是工作区还是实际 delivery 条件？ |
| 已知 finding 修复范围 | 同一规则的所有已知触发类是否关闭？未覆盖项是否超出已接受契约？ |

执行默认：先读此任务已有 Spec controls/agreed seam，不另造第二份规划；在 handoff 附一张简表，失败留在当前 Executor 自主修复。若要修改提示文档，最可能涉及 `runtime/prompts/executor.md`、其生成镜像及现有 prompt/Loop 契约测试；先追踪实际装配关系，仅补当前 Executor prompt 缺失的动作，不重复 `dist/imm-loop.md:92–98` 的现有第二次返工规则。报告本身不授权这些改动。

验证：以 enrollment 的真实取消/重放/async 错误传播、completion verifier 的真实 producer 正例与因果负例、双宿主 identity 三类历史反例检查交付表能否导出正确动作；实施时运行相应已有 focused suites，涉及 TS 接口时运行 `bun run typecheck`，运行时镜像变化时重建并验证 Claude bundle。

后续五任务分别记录首次 Review 通过、Review 内容返工轮数、QA execution failures、重复 AC/规则、基础设施 jitter 与 bindings；目标是减少同类遗漏和二次以上内容返工。该目标不是硬预算或放行标准；不能为了指标减少测试、弱化 Review，或把重复 AC 当成同一 bug。

## 审计表与复算

以下表格由同一次只读提取生成。QA fail 指 request_rework 的 qa authority，Review rework 指 review authority；breaking 是 approve_breaking_intent_revision。bindings 为任务内 `(intent_content_hash, diff_hash)` 去重数，不跨任务解释成本。逐轮表保留全部 finding IDs，重复 acceptance 用“重复”标示；最后 pass 轮无 finding。

### 最新十个终态 run

| Task / record | 终态 | QA pass | QA fail | Review rework | Review pass | Breaking | bindings |
|---|---|---:|---:|---:|---:|---:|---:|
| [shared-batch-child-kernel-port](../../.imm/audit/shared-batch-child-kernel-port/run-29a76f5f-efdb-439f-a089-7342ae9662f1/task-record.json) | done | 1 | 2 | 0 | 1 | 0 | 1 |
| [host-neutral-verdict-authority](../../.imm/audit/host-neutral-verdict-authority/run-7c7e94cc-c9a3-42f2-a2f0-7dfe3a3f99c8/task-record.json) | done | 2 | 0 | 1 | 1 | 0 | 2 |
| [single-enrollment-entry](../../.imm/audit/single-enrollment-entry/run-54345788-c029-43de-9d1a-8600b66478ea/task-record.json) | done | 7 | 3 | 5 | 1 | 0 | 7 |
| [single-delivery-identity](../../.imm/audit/single-delivery-identity/run-a79b8655-6649-4023-9c26-3bc1622e52f2/task-record.json) | done | 2 | 1 | 1 | 1 | 1 | 2 |
| [retire-pi-runtime-stub](../../.imm/audit/retire-pi-runtime-stub/run-87ddd558-8d05-438d-8383-b3f3c10133b6/task-record.json) | done | 1 | 1 | 0 | 1 | 1 | 1 |
| [planner-provenance-and-agreed-seams](../../.imm/audit/planner-provenance-and-agreed-seams/run-514e13b1-8478-4f01-af2b-d94c2878160e/task-record.json) | done | 1 | 0 | 0 | 1 | 1 | 1 |
| [claude-readonly-role-agents](../../.imm/audit/claude-readonly-role-agents/run-3f2aea52-e149-45ae-b55d-55af6b41e7b9/task-record.json) | done | 1 | 0 | 0 | 1 | 1 | 1 |
| [reviewer-prompt-single-source](../../.imm/audit/reviewer-prompt-single-source/run-dce7873d-7bd3-404a-a122-d47cd3b3f9a0/task-record.json) | done | 1 | 0 | 0 | 1 | 0 | 1 |
| [review-pass-path-coverage](../../.imm/audit/review-pass-path-coverage/run-3cb37e61-93d8-40b3-8676-4c88f4ec1cdc/task-record.json) | done | 1 | 1 | 0 | 1 | 1 | 1 |
| [review-prompt-exact-binding](../../.imm/audit/review-prompt-exact-binding/run-e88521d6-4d51-43fe-a888-88bb3cdd6f3f/task-record.json) | done | 1 | 0 | 0 | 1 | 0 | 1 |

### 四个补充 run

| Task / record | 终态 | QA pass | QA fail | Review rework | Review pass | Breaking | bindings |
|---|---|---:|---:|---:|---:|---:|---:|
| [review-host-handback-block-order](../../.imm/audit/review-host-handback-block-order/run-d09cd7cb-e2f2-495a-bad0-06dd8a7603a5/task-record.json) | stopped | 1 | 0 | 1 | 0 | 0 | 1 |
| [workflow-decision-closure-s7](../../.imm/audit/workflow-decision-closure-s7/run-f66bb0cd-8442-47b7-90f0-b33050f876c9/task-record.json) | done | 5 | 0 | 4 | 1 | 1 | 5 |
| [batch-plan-reconfirmation](../../.imm/audit/batch-plan-reconfirmation/run-c6fa9f18-ab74-4084-bd2b-d6a81d86f82d/task-record.json) | done | 5 | 2 | 4 | 1 | 1 | 5 |
| [pi-batch-acceptance-s0-completion-verifier](../../.imm/audit/pi-batch-acceptance-s0-completion-verifier/run-e6cdcb56-a792-485d-a9a1-d3523ca9b797/task-record.json) | done | 7 | 1 | 8 | 1 | 3 | 7 |

基线合计：10 done；18 QA pass、8 QA fail、7 Review rework、10 Review pass、5 breaking；普通 revise_intent / authorize_rework / stop 均为 0。Finding 条目为 execution/resolved 9、review/resolved 8。3/10 任务经历 Review rework，其中 enrollment 占 5/7 次。

补充合计：3 done、1 stopped；18 QA pass、3 QA fail、17 Review rework、3 Review pass、5 breaking、2 revise_intent、0 authorize_rework、1 stop。Finding 条目为 review/resolved 38、review/open 2、execution/resolved 3、kernel/resolved 3。补充样本按高返工选择，不能与基线合并估计返工率。

### 高轮数任务的每轮 acceptance 与 finding IDs

**single-enrollment-entry**：6 个持久化 Review verdict（5 rework + 1 pass）。

| 轮 | Acceptance | 重复 | Finding IDs |
|---|---|---|---|
| 1 | AC1 | 首现 | `review-53b3befb36e4-1-review-1` |
| 2 | AC2 | 首现 | `review-527c27becea5-1-review-1` |
| 3 | AC2 | AC2 | `review-5afc5547de1e-1-review-1` |
| 4 | AC2 | AC2 | `review-4a07dd34dc81-1-review-1` |
| 5 | AC3 | 首现 | `review-41ce1c393262-1-review-1` |
| 6 | pass | — | 无 blocking findings |

**workflow-decision-closure-s7**：5 个持久化 Review verdict（4 rework + 1 pass）。

| 轮 | Acceptance | 重复 | Finding IDs |
|---|---|---|---|
| 1 | WDC-S7-A1 | 首现 | `review-7be8cb54a236-1-review-1`, `review-7be8cb54a236-2-review-2`, `review-7be8cb54a236-3-review-3` |
| 2 | WDC-S7-A1 | WDC-S7-A1 | `review-1ee909ff59c6-1-review-1`, `review-1ee909ff59c6-2-review-2`, `review-1ee909ff59c6-3-review-3` |
| 3 | WDC-S7-A1 | WDC-S7-A1 | `review-bfc0354582bd-1-review-1` |
| 4 | WDC-S7-A1 | WDC-S7-A1 | `review-d3f23f6edd95-1-review-1` |
| 5 | pass | — | 无 blocking findings |

**batch-plan-reconfirmation**：5 个持久化 Review verdict（4 rework + 1 pass）。

| 轮 | Acceptance | 重复 | Finding IDs |
|---|---|---|---|
| 1 | BPR-A1 | 首现 | `review-89823db1036d-1-review-1` |
| 2 | BPR-A1 | BPR-A1 | `review-000d3f4e7b91-1-review-1`, `review-000d3f4e7b91-2-review-2` |
| 3 | BPR-A1 | BPR-A1 | `review-fc8f40ce327a-1-review-1` |
| 4 | BPR-A1 | BPR-A1 | `review-c4589b9ad8d9-1-review-1`, `review-c4589b9ad8d9-2-review-2` |
| 5 | pass | — | 无 blocking findings |

**pi-batch-acceptance-s0-completion-verifier**：9 个持久化 Review verdict（8 rework + 1 pass）。

| 轮 | Acceptance | 重复 | Finding IDs |
|---|---|---|---|
| 1 | PBA-S0-A1 | 首现 | `review-42b97049cc84-1-review-1`, `review-42b97049cc84-2-review-2`, `review-42b97049cc84-3-review-3`, `review-42b97049cc84-4-review-4` |
| 2 | PBA-S0-A1 | PBA-S0-A1 | `review-36495b293954-1-review-1`, `review-36495b293954-2-review-2`, `review-36495b293954-3-review-3`, `review-36495b293954-4-review-4` |
| 3 | PBA-S0-A1 | PBA-S0-A1 | `review-4a8c2c9287c7-1-review-1`, `review-4a8c2c9287c7-2-review-2`, `review-4a8c2c9287c7-3-review-3`, `review-4a8c2c9287c7-4-review-4`, `review-4a8c2c9287c7-5-review-5` |
| 4 | PBA-S0-A1 | PBA-S0-A1 | `review-f320ba9f91b0-1-review-1`, `review-f320ba9f91b0-2-review-2` |
| 5 | PBA-S0-A1 | PBA-S0-A1 | `review-42e87786a16d-1-review-1`, `review-42e87786a16d-2-review-2`, `review-42e87786a16d-3-review-3` |
| 6 | PBA-S0-A1 | PBA-S0-A1 | `review-131962e025b9-1-review-1`, `review-131962e025b9-2-review-2` |
| 7 | PBA-S0-A1 | PBA-S0-A1 | `review-8c45c6f19fe1-1-review-1`, `review-8c45c6f19fe1-2-review-2`, `review-8c45c6f19fe1-3-review-3` |
| 8 | PBA-S0-A1 | PBA-S0-A1 | `review-ea736f75dc1e-1-review-1` |
| 9 | pass | — | 无 blocking findings |

completion verifier 的前三轮 author/run-ID/parent/稳定性问题重复出现；记录不能独立证明每次是 Parent 未修改、修改未 staged、还是快照未包含修复。它支持“下一轮仍未交付该修复”，不支持猜测操作者意图。

所有 run 的 task identity 均以本工作区 + task_id 聚合；选定 task 均只有一个选定 run。额外 Agent 重试和被丢弃 verdict 未计入上述轮数。

### 可复算的只读命令

```sh
python3 - <<'PY'
import pathlib, json, hashlib, collections
rows = []
for p in pathlib.Path(".imm/audit").rglob("task-record.json"):
    r = json.loads(p.read_text())
    q = json.loads(p.with_name("terminal-proof.json").read_text())
    rows.append((q["terminalized_at"], str(p), r, q))
ordered = sorted(rows, key=lambda x: (x[0], x[1]), reverse=True)
base = ordered[:10]
reworks = lambda r, role: sum(e["type"] == "request_rework" and
    e.get("authority", {}).get("authority_kind") == role for e in r["history"])
extra = [x for x in ordered if x[2].get("lifecycle") == "stopped"][:1]
extra += [x for x in ordered[:35] if x not in base and reworks(x[2], "review") >= 4]
print("inventory", len(rows), collections.Counter(x[2]["contract"] for x in rows))
print("duplicates", len(rows) - len({(x[2]["task_id"], x[3]["terminal_event_id"]) for x in rows}))
for group, selected in [("baseline", base), ("supplement", extra)]:
    totals = collections.Counter()
    for at, path, r, q in selected:
        raw = (json.dumps(r, ensure_ascii=False, indent=2) + chr(10)).encode()
        assert "sha256:" + hashlib.sha256(raw).hexdigest() == q["final_record_hash"]
        end = r["history"][-1]
        assert r["task_id"] == q["task_id"]
        assert r["lifecycle"] == q["terminal_lifecycle"]
        assert end["id"] == q["terminal_event_id"] and end["at"] == at
        assert end["type"] == ("complete" if r["lifecycle"] == "done" else "stop")
        assert end["from_state"] == "active:frozen" if r["lifecycle"] == "done" else end["from_state"].startswith("active:")
        assert end["to_state"] == r["lifecycle"] + ":frozen"
        counts = collections.Counter(x["kind"] + "_pass" for x in r["attestations"])
        counts.update(qa_fail=reworks(r, "qa"), review_rework=reworks(r, "review"))
        counts.update(e["type"] for e in r["history"] if e["type"] in
            ["revise_intent", "approve_breaking_intent_revision", "authorize_rework", "stop"])
        totals.update(counts)
        bindings = {(a["intent_content_hash"], a["diff_hash"]) for a in r["attestations"]}
        print(group, at, path, r["lifecycle"], dict(counts), "bindings", len(bindings))
        if counts["review_rework"] + counts["review_pass"] >= 3:
            for f in r["findings"]:
                if f["source"] == "review":
                    print("round", f["review_round"], f["acceptance_id"], f["id"], f["summary"])
    print(group, "total", dict(totals))
    print("findings", collections.Counter((f["source"], f["status"])
        for _, _, r, _ in selected for f in r["findings"]))
PY
```

本次检查：已复算计数并核验全部 14 个 terminal proof；核对现有 Executor/Reviewer/Loop 要求以及命名的当前实现路径；检查本报告本地链接。未运行历史代码或全仓测试，未复现所有 resolved findings；当前实现的正确性不由本次历史分析保证。

## 经用户授权后的落地进展

已在本地完成 Executor Delivery Evidence 要求、其 packaged mirror 和 Loop 的引用，扩展现有 routing test 验证实际注入的提示内容；添加 patch changeset。实施没有改动 Kernel 运行时或 authority 契约。六个相关文件共 42 tests 通过，`bun run typecheck`、dist sync check 和 Claude bundle check 通过；未提交或发布。

后续五任务效果验证已单独创建 [GitHub Issue #164](https://github.com/dereknex/immune-brain/issues/164)，并回读确认其状态为 OPEN、内容一致。观察从已安装本次改动的版本开始；按顺序采样，保留 stopped/blocked，分别统计内容返工、QA failures 和 infrastructure jitter。效果尚未验证，不能以提示契约测试通过代替真实任务结果。

