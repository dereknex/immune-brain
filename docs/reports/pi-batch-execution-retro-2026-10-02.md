# 近期 Pi 批量运行复盘：实现完成不等于批次完成

## 结论

三个可定位的真实批次最终都没有由 Batch Runner 收尾到 `completed`，但不能据此说所有实现都没有完成：

- `immune-cutover`：报告记录两个 child 已提交、一个停泊；最后一个 child 后来通过单任务 Assurance 完成。
- Welltold `product-design-layer-restructure`：报告记录首个 child 停泊、其余六个因依赖跳过；七个原始 child 后来全部通过单任务流程完成。
- Welltold `home-card-visual-alignment`：报告记录 S0 停泊、S1 pending；次日 S0、S1 均完成，S1 使用单任务 Enrollment，而不是 Batch Runner 接续。

**失败的是批量执行闭环：旧 runner 把 Enrollment 接到 Assurance，却缺少实现交接；把技术返工转换成需要用户确认；随后又因授权续期缺陷及 Parent 转为单任务执行，失去批次接续和最终收尾。**

这不是只靠延长超时、放宽 QA 或换模型就能解决的问题。另一方面，部分任务确实存在实现和验收缺口，Review 的拦截不能全部归类为流程噪声。

## 1. 范围、版本与证据边界

- 分析代码 revision：`2a2d97aef75bccf07606855457adc1522a3ece58`，包版本 `4.4.1`。
- 真实批次发生于 2026-09-17、2026-09-21、2026-10-01；接续 session 包含 2026-10-02。下文 session 时间及审计时间均使用原始 UTC。
- 当前仓库与 Pi 安装副本 `/Users/derek/.pi/agent/git/github.com/dereknex/immune-brain` 的版本均为 `4.4.1`，`batch_runner.ts`、`batch_preflight.ts`、`imm-unattended-batch.ts` 文件摘要一致。磁盘版本一致不能证明已运行的 Pi 进程重新加载了它们。
- Oct 1 Welltold 的实际 status 输出为 `plugin_version: 4.4.0`；Sept 17 session 可见 `3.6.9`。不能拿历史故障直接证明 4.4.1 仍有同一缺陷。
- 只读检查三个 batch 的持久状态、四个明确关联的 project-specific Pi session，以及当前项目最新十份终态审计。不扫描其他项目 session，不恢复任何任务，不修改 authority 或证据。
- 审计 inventory 共 157 份 TaskRecord：78 份 v4、9 份 v3、70 份 v2。十份终态样本按 `terminal-proof.json.terminalized_at` 倒序、路径作为稳定 tie-breaker 选择，均为 v4，含停止任务。未使用文件 mtime。
- 十份样本全部通过 canonical record hash、task identity、terminal lifecycle、terminal event identity 的一致性核验。该核验证明文件相互一致，不证明独立真实性。
- 终态样本存在 survivor bias：不含仍在运行或尚未导出的任务；Welltold 的现场 session 和 batch 状态作为单独案例，不混进当前仓库的终态统计。
- 未测量 token 成本、有效工作时长、用户实际等待时长或交付后缺陷；事件间隔不能替代这些指标。

## 2. 三个批次的真实结果

| Batch | 原始 children | 持久 batch 结果 | 后续任务结果 | 判断 |
|---|---:|---|---|---|
| `immune-cutover` | 3 | `needs_human`，2 committed、1 needs_human | 三个 child 均可见 completed；最后一个未被 batch 收尾 | 部分 batch 提交成功，后续单任务完成，批次状态未闭环 |
| `product-design-layer-restructure` | 7 | `needs_human`，首个 needs_human、其余 6 skipped_blocked，0 batch commits | 七个 child 在同一 session 后续全部 completed | 批次退化成逐任务 Enrollment |
| `home-card-visual-alignment` | 2 | `needs_human`，S0 needs_human、S1 pending，0 batch commits | Oct 2 S0 completed；S1 单独 Enrollment 后 completed | 首日批次失败，次日单任务接管成功 |

批次证据路径：

- [immune-cutover state](../../.imm/state/batches/batch-immune-cutover-1789653354985.json)
- `/Users/derek/workspaces/Welltold/.imm/state/batches/batch-product-design-layer-restructure-e8a7a408-7215-4dd3-9d4e-70d5d80a55ed.json`
- `/Users/derek/workspaces/Welltold/.imm/state/batches/batch-home-card-visual-alignment-5c7f75ae-1299-451c-b3b9-19ab82e8ed8f.json`

### 2.1 immune-cutover

Session：`/Users/derek/.pi/agent/sessions/--Users-derek-workspaces-immune-brain--/2026-09-17T14-01-48-917Z_01a0afac-7075-7764-ad2a-6297e8102b88.jsonl`。

- line 195：首次恢复遇到 retired file-store authority，拒绝变更。这是存储前置条件，不是实现失败。
- line 215、279：已有 Review reservation；runner 保持 `running` 并返回 foreground Review dispatch。这是正常交接，不应当作 batch 失败。
- line 294：第二个 child 被 `Kernel requires resolve_findings` 停泊。
- line 399、404：恢复 Review 后第二个 child 完成。
- line 408：第三个 child 再因 `resolve_findings` 停泊；此时 `consecutive_qa_failures=1`，低于 limit 2。
- line 410：Kernel 的 `open_user_decision_count=0`，但 batch 文案要求 human decision。
- line 618：第三个 child 单任务完成；持久 batch 仍保存 line 408 的状态。

该案例还发生真实 scope 修订：最后一个 child 的审计有三次 breaking revision，session line 577 明确拒绝 scope 外的 `tests/dual-host-assurance-conformance.test.ts`。这些权限边界不能为了无人值守而绕过。

### 2.2 product-design-layer-restructure

Session：`/Users/derek/.pi/agent/sessions/--Users-derek-workspaces-Welltold--/2026-09-21T07-50-36-436Z_01a0c2f2-0693-7072-857d-a06b8e92ab11.jsonl`。

- line 130：首个 child 因 `resolve_findings` 停泊，其余六个被依赖规则标为 `skipped_blocked`。
- line 602：首个 child completed。
- line 606：重新 batch entry 遇到 native confirmation timeout。
- lines 646、744、816、980、1037、1079：Parent 改为对子任务分别调用 `imm_canary_enrollment`。
- lines 727、801、965、1027、1071、1194：其余六个 child 分别 completed。

六个依赖任务被跳过本身符合依赖约束；流程问题是对首个 child 的技术返工没有保持 batch 执行权和修复交接，之后也没有完成 batch 状态对账。

### 2.3 home-card-visual-alignment

首次 session：`/Users/derek/.pi/agent/sessions/--Users-derek-workspaces-Welltold--/2026-10-01T13-28-24-530Z_01a0f7a6-e2d2-71c3-91e9-948e2aa2d204.jsonl`。

- line 44：首次调用 batch；此前工具调用为检索和读取，没有 `edit`、`write` 或 `apply_patch` 实现步骤。
- line 45：直接得到 `capturing_snapshot: QA prepare failed (nonzero_exit)`，影响 HCV-A1–A4；S0 停泊，S1 pending。
- line 47：Kernel 已处于 `artifact_state=frozen`、`next_obligation=run_qa`，说明 Enrollment 后直接进入了 Assurance。
- lines 317、322：native confirmation timeout。
- line 326：改为 `Kernel requires resolve_findings`，`consecutive_qa_failures=1`、limit=2。
- line 329：Kernel 仍然 `open_user_decision_count=0`，blocking findings 是 HCV-A3、HCV-A4 的 QA finding，而非用户决策。
- line 630：再次 confirmation timeout。
- lines 634、726：`batch authorization must have a future expiry`。这是续期逻辑失败，不是用户拒绝，也不是普通测试失败。

接续 session：`/Users/derek/.pi/agent/sessions/--Users-derek-workspaces-Welltold--/2026-10-02T04-21-43-995Z_01a0fad8-bfbb-766d-a3fc-de6ec6804f5c.jsonl`。

- line 261：S0 completed。
- line 295：S1 单任务 Enrollment；line 519：S1 completed。
- 后续新增 S2 也通过单任务完成，但 S2 不属于原始两-child batch，不计入原批次结果。

**不能继续声称 S1 目前未实现：只能说首次批次没有启动它。**

## 3. 根因与反证

### P0：runner 缺少 Enrollment → Executor → Assurance 的交接

历史 revision `d358f83c7c2481f06b40a3bebfe541e64a1e9abc` 的 `runtime/unattended/batch_runner.ts` 在 line 793、1174 直接调用 `kernel.advanceTask`。Pi adapter 把它连接到 `advancePiTask`，没有先把待实现 child 返回 Parent。

实际链路是：

```text
native batch authorization → Enrollment → advanceTask → freeze/QA
```

预期链路则是：

```text
native batch authorization → Enrollment → foreground Executor
→ implementation + focused checks + task-owned staging
→ Kernel QA → foreground Review（需要时）→ settlement → scoped commit
→ next child → batch completed
```

因此预先已经实现的 child 可以继续 Review/提交，新的 child 却会拿未完成的代码直接跑 QA。immutable review tree 与 delivery tree 不负责替模型实现需求。

**反证边界：** immune-cutover 的前两个 child 成功走过 Review 和提交，证明“batch 完全没有任何有效能力”不成立；缺口具体在新实现与返工交接。

当前代码已有 Executor handoff：`batch_runner.ts`、`imm-unattended-batch.ts`，以及 `tests/unattended-batch-run.test.ts` 的 `foreground Executor handoff` 覆盖。历史根因不应再次当成未修复需求实现。

### P0：把技术返工压成 human decision，并切断批次恢复

三个报告最终停泊原因都是 `Kernel requires resolve_findings`；immune-cutover 与首页案例都有 `open_user_decision_count=0` 的直接反证，QA failure counter 也只有 1，尚未到预算上限。

`resolve_findings` 表示需要修复、验证并处理 finding，不等于需要用户选择。旧分类把它变成 `needs_human`，于是重复 native gate；timeout 又让 Parent 转入单任务模式，子任务做完后 batch 的 children/commits/report 不再推进。

更深一层的同类缺口见最新修复任务 finding：

- `review-a67ed9e79913-1-review-1` / BER-S2-A1：`review_preparation_failed` 在 coordinator、Claude adapter、runner 之间丢失分类，技术修复被误报成用户决策。
- `review-a0081df14803-1-review-1` / BER-R-A1：coordinator 修复后，Pi 注册 Tool 的外层 `enrichAssuranceResult` 仍然多读一次失败 authority projection。
- `review-2097cc713579-1-review-1` / BER-R-A1：已有 Review reservation 的入口仍遗漏 `recovery_error`，导致 recovery decoration 再次读取。

这些都是跨层闭环问题，不是多加一句“自主继续”就能修复。

授权续期是同一恢复链的另一断点：历史 `batch_preflight.ts:341` 直接复用 `existingBatch.budget`；超过旧 deadline 后再确认仍拿过期窗口发 capability，产生 `future expiry` 错误。当前代码复制预算并候选延长 deadline，再通过 native gate 授权；不能静默延长用户原授权。

**反证边界：** native timeout、scope 变化和真实用户决策仍必须停。未观察到的问题不能推断为全部不必要确认；日志只能给出已记录 gate failure 的下界。

### P1：验证器与实际交付边界不一致，导致反复内容返工

设计层案例合法 Review verdict 按 task 聚合如下。每轮的 acceptance IDs 在下一节列出。

| Task | 合法 verdict | rework | pass |
|---|---:|---:|---:|
| design-layer-s1-baseline-matrix | 9 | 8 | 1 |
| design-layer-s2-home-surface | 2 | 1 | 1 |
| design-layer-s3-categories-surface | 1 | 0 | 1 |
| design-layer-s4-history-surface | 5 | 4 | 1 |
| design-layer-s5-evidence-surface | 1 | 0 | 1 |
| design-layer-s6-settings-surface | 1 | 0 | 1 |
| design-layer-s7-change-proposals | 3 | 2 | 1 |
| **合计** | **22** | **15** | **7** |

S1 的反复问题包括矩阵结构、状态集合和 immutable 写入范围；S4 同时有词扫描漏检与真实语义遗漏；S7 则有 22 个 Brainstorm ID 未完整覆盖。不能把这 15 次全部归咎于 batch，也不能由轮数直接推出任务过大。

另一条当前仓库证据是 `close-taskrecord-v3-drain-window` 的 `review-f2d76cd720a6-1-review-1` / AC3 与 `review-f2d76cd720a6-2-review-2` / AC4：工作区中的 legacy reader 没进入 pinned review tree，导致 Review 所见实现与本地验证声明不一致。这说明 scope、delivery tree、验证器输入必须一起检查。

**反证边界：** S3、S5、S6 一轮通过；Review 记录反映审查者判定和后续处置，不是每一条 finding 都经过本次独立复现。现有源代码与验收已多次修订，本报告不把 resolved finding 宣告为当前漏洞。

## 4. 高轮数任务逐轮核对

仅统计 task identity 明确、提交到 Kernel 的结构化 verdict；不是所有 Agent dispatch 数。`review-1` 等短 ID 每轮重复使用，不能跨轮当成唯一 bug ID。

| Task | 轮次 / session line | verdict 与 finding acceptance IDs | 重复情况 |
|---|---|---|---|
| S1 baseline | 1 / 382 | rework: S1-A1, S1-A3 | 首现 |
| S1 baseline | 2 / 401 | rework: S1-A1, S1-A4 | A1 重复 |
| S1 baseline | 3 / 436 | rework: S1-A1 | A1 重复 |
| S1 baseline | 4 / 453 | rework: S1-A4 | A4 重复 |
| S1 baseline | 5 / 474 | rework: S1-A4 | A4 重复 |
| S1 baseline | 6 / 495 | rework: S1-A4 | A4 重复 |
| S1 baseline | 7 / 554 | rework: S1-A4 | A4 重复 |
| S1 baseline | 8 / 576 | rework: S1-A1, S1-A4 | 两者重复 |
| S1 baseline | 9 / 601 | pass | 无 findings |
| S4 history | 1 / 854 | rework: S4-A2 | 首现 |
| S4 history | 2 / 900 | rework: S4-A3 | 首现 |
| S4 history | 3 / 921 | rework: S4-A3 | A3 重复，不同语义缺口 |
| S4 history | 4 / 944 | rework: S4-A2 | A2 重复 |
| S4 history | 5 / 964 | pass | 无 findings |
| S7 proposals | 1 / 1112 | rework: S7-A2, S7-A3 | 首现 |
| S7 proposals | 2 / 1149 | rework: S7-A2, S7-A4 | A2 重复 |
| S7 proposals | 3 / 1193 | pass | 无 findings |

line 1109 的 S7 payload 缺 task identity，随后 line 1112 更正；不算独立内容 Review 轮次。没有把该格式纠正当成 missing-agent/empty-verdict infrastructure jitter。后续 `card-navigation-delivery` 是另一个单任务，不属于七-child batch，故其多轮返工不并入上表。

## 5. 最新十份终态审计基线

选择窗口：2026-09-17T14:39:53.661Z 至 2026-10-02T13:16:30.129Z。所有路径均指向各自 task-record；同目录 `terminal-proof.json` 为核验依据。

“QA fail”只计 `request_rework` 且 `authority_kind=qa` 的 execution failure；prepare 失败不一定形成这种事件。“绑定数”为 attestations 的 `(intent_content_hash, diff_hash)` distinct count，不把同一任务的不同交付绑定当成浪费。

| Task / 审计路径 | 终态 | QA pass | QA fail | Review rework | Review pass | Breaking | 绑定数 |
|---|---|---:|---:|---:|---:|---:|---:|
| [release-repair](../../.imm/audit/batch-execution-recovery-release-repair/run-03193559-07b4-4802-ab48-d22cbe03d639/task-record.json) | done | 3 | 0 | 2 | 1 | 1 | 3 |
| [s2-failure-recovery](../../.imm/audit/batch-execution-recovery-s2-failure-recovery/run-bb87774a-a851-48ac-a0d7-6f65b2f14262/task-record.json) | done | 2 | 0 | 1 | 1 | 0 | 2 |
| [s1-executor-handoff](../../.imm/audit/batch-execution-recovery-s1-executor-handoff/run-8ab584a8-19a7-4f43-bec3-a7a57664e80f/task-record.json) | done | 1 | 1 | 0 | 1 | 1 | 1 |
| [s0-renewal](../../.imm/audit/batch-execution-recovery-s0-renewal/run-d045c852-3c79-4d6e-92be-d15faa4e70b4/task-record.json) | done | 1 | 1 | 0 | 1 | 0 | 1 |
| [assurance-blocker-repair](../../.imm/audit/assurance-blocker-repair/run-aa987ea1-0a6a-4f8f-898e-528a56a3e6d6/task-record.json) | done | 2 | 1 | 1 | 1 | 0 | 2 |
| [codify-rework-root-cause-lessons](../../.imm/audit/codify-rework-root-cause-lessons/run-ec30439a-89f3-46c6-8e91-707854d8f4ff/task-record.json) | done | 1 | 0 | 0 | 0 | 0 | 1 |
| [add-migrate-to-vnext-command](../../.imm/audit/add-migrate-to-vnext-command/run-1a07e02e-3706-4168-bafc-852ce9da0be4/task-record.json) | stopped | 0 | 0 | 0 | 0 | 0 | 0 |
| [close-taskrecord-v3-drain-window](../../.imm/audit/close-taskrecord-v3-drain-window/task-record.json) | done | 4 | 0 | 1 | 1 | 5 | 4 |
| [retire-drained-v4-cli-surface](../../.imm/audit/retire-drained-v4-cli-surface/run-10083246-1083-4aa9-b187-ed72ad4ea65d/task-record.json) | done | 1 | 1 | 0 | 1 | 3 | 1 |
| [extract-review-reservation-comparison](../../.imm/audit/extract-review-reservation-comparison/run-24e75d36-32f6-489c-ac45-5ce1efaf2ebe/task-record.json) | done | 1 | 1 | 0 | 1 | 0 | 1 |
| **合计** | **9 done / 1 stopped** | **16** | **5** | **5** | **8** | **10** | 不跨任务相加解释 |

Finding entries：execution/resolved 5、review/resolved 6；六个 Review finding entries 不等于六轮或六个唯一缺陷。兼容 revision 与 user-authorized rework 事件为 0；stop 事件 1。用户 authority 事件不等于用户实际收到的提示数。

停止的 `add-migrate-to-vnext-command` 是 critical 独立任务，不是 batch 可自动执行 child；终态停止不是当前三个 batch 不闭环的证据。

复算核心统计与核验的只读命令（仓库根目录）：

```sh
python3 - <<'PY'
import collections, hashlib, json, pathlib
rows = []
for p in pathlib.Path('.imm/audit').rglob('task-record.json'):
    r = json.loads(p.read_text())
    q = json.loads(p.with_name('terminal-proof.json').read_text())
    rows.append((q['terminalized_at'], str(p), r, q))
sample = sorted(rows, key=lambda x: (x[0], x[1]), reverse=True)[:10]
for at, path, r, q in sample:
    canonical = (json.dumps(r, ensure_ascii=False, indent=2) + '\n').encode()
    assert 'sha256:' + hashlib.sha256(canonical).hexdigest() == q['final_record_hash']
    assert r['task_id'] == q['task_id']
    assert r['lifecycle'] == q['terminal_lifecycle']
    assert r['history'][-1]['id'] == q['terminal_event_id']
    a, h = r['attestations'], r['history']
    count = lambda kind: sum(x['kind'] == kind for x in a)
    rework = lambda role: sum(x['type'] == 'request_rework' and
        x.get('authority', {}).get('authority_kind') == role for x in h)
    bindings = {(x.get('intent_content_hash'), x.get('diff_hash')) for x in a}
    print(at, path, r['lifecycle'], count('qa'), rework('qa'),
          rework('review'), count('review'),
          sum(x['type'] == 'approve_breaking_intent_revision' for x in h), len(bindings))
print('findings', collections.Counter((f['source'], f['status'])
    for _, _, r, _ in sample for f in r['findings']))
PY
```

## 6. 现状与唯一推荐下一步

相关改动已交付：

- `0f2825f`：Enrollment 后返回 foreground Executor handoff，不直接对未实现 child 跑 Assurance。
- `1e797a4`：恢复精确 Assurance obligation，保留技术修复分类与安全诊断。
- `310fbdb`：补足 recovery read budget 和失败 metadata。
- `2a2d97a`：发布版本更新到 `4.4.1`；当前 `batch_preflight.ts` 含过期预算续期候选与 native 授权绑定。

本次重新运行：

```sh
bun test tests/unattended-batch-run.test.ts tests/pi-batch-authority.test.ts
```

结果：155 pass、0 fail，约 21 秒。测试覆盖本地 runner/adapter 行为；不是当前 Pi 模型与 native gate 连续驱动真实业务 batch 的完成证明。未跑全仓回归，也未在 Welltold 执行 Xcode/UI 验收。

**推荐：不再重复设计同一修复；先用已加载 4.4.1 的真实 Pi session 做一个两-child 的受控批次验收。**

目标验收条件：

1. 两个 child 都需要真实实现，首个 Enrollment 后必须出现 Executor handoff，QA 不得先于实现。
2. 至少覆盖一次技术返工：没有新用户决策且未越预算时，保持同一 batch，修复后继续；不要重新逐任务 Enrollment。
3. QA/Review 绑定真实交付树；settlement 后由 runner 写入 scope-bound commit，第二个 child 自动接续。
4. 最终同时满足 Kernel children done、batch children committed、batch state completed、report completed，而不是仅最终聊天消息说完成。
5. 续期作为独立受控场景：native gate 展示新窗口，接受后保留已有进度；拒绝或取消不得修改旧证据。

下一轮只采样该两-child 批次与一个续期场景，避免扩展到新的调度框架或降低现有权限/验证约束。若失败，从实际交接断点和返回分类定向复现再修；不是先增大任务预算。

本次只新增本报告；证据、实现、任务状态和 Git 历史均未改写，也未恢复已停泊任务。
