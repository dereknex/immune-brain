# 工作流证据基线与下一步建议

## 结论

保留现有 QA 与 Review。先试点“真实入口到持久化再读取”的交付前检查，以减少跨入口遗漏和无效测试导致的多轮返工；暂不修改 Kernel、风险分级或授权规则。

这是历史过程分析，不是当前缺陷审计。`resolved` 仅表示记录已处置；本次没有重新复现全部历史缺陷。尚不能量化生产逃逸率、净节省时间或相对 Host-native 的效率。

## 样本与可信度

- 仓库基准：`d5841732ba6acc00fec58fb732f3b9f030789ed1`。
- 仅递归读取本项目 `.imm/audit/**/task-record.json` 及对应 `terminal-proof.json`，不访问外部会话目录或运行中的数据库。
- 共发现 144 份记录：v4 65、v3 9、v2 70。143 份具有 `complete` 或 `stop` 历史事件；一份旧 v2 记录缺少该事件，未进入时间排序。这不等于它未完成。
- 按最后一个终结事件的 UTC 时间倒序，路径作为同时间的稳定排序键，选择最近 10 份。所选均为 v4，按任务/运行身份检查无重复；其余 133 份可排序记录未做内容分析。
- 样本终结时间：2026-09-15T02:07:39.937Z 至 2026-09-16T15:41:30.436Z。时间取自审计数据，不用文件 mtime 或任务名称判断新旧。
- 10/10 的原始文件 SHA-256 与终态证明 `final_record_hash` 一致，task_id、终态事件、状态和时间均一致。这是文件一致性验证，不是抗篡改认证。
- 样本集中于 `mws-*` 改造和 `wcr-*` 维护，属于便利样本，不能推广为所有任务的成功率。未终结且未导出审计的任务不可见，存在终态样本偏差。

## 十个任务

QA 列为成功 QA attestation 条数；Review 返工列按 `request_rework.authority.authority_kind == review` 统计，不能用最终 pass attestation 条数代替。问题列为 Review blocking 条目数，未去重为独立缺陷。授权列只统计 `authorize_rework`。

| 任务（证据链接） | 终态 | 风险 | QA | Review 返工 | Review 问题：已解决/未解决 | 再授权 |
|---|---|---|---:|---:|---:|---:|
| [mws-migration-release](../../.imm/audit/mws-migration-release/task-record.json) | done | critical | 16 | 2 | 6/0 | 1 |
| [mws-assurance-review](../../.imm/audit/mws-assurance-review/task-record.json) | done | material | 6 | 5 | 7/0 | 4 |
| [mws-delivery-scope](../../.imm/audit/mws-delivery-scope/task-record.json) | stopped | material | 5 | 5 | 19/4 | 3 |
| [mws-minimal-intent](../../.imm/audit/mws-minimal-intent/task-record.json) | done | material | 5 | 4 | 8/0 | 3 |
| [mws-sqlite-authority](../../.imm/audit/mws-sqlite-authority/task-record.json) | done | critical | 16 | 11 | 23/0 | 10 |
| [wcr-lazy-terminal-tracker-status](../../.imm/audit/wcr-lazy-terminal-tracker-status/task-record.json) | done | material | 1 | 0 | 0/0 | 0 |
| [wcr-dedupe-pi-batch-strings](../../.imm/audit/wcr-dedupe-pi-batch-strings/task-record.json) | done | material | 1 | 0 | 0/0 | 0 |
| [wcr-remove-orphaned-imports](../../.imm/audit/wcr-remove-orphaned-imports/task-record.json) | done | material | 1 | 0 | 0/0 | 0 |
| [wcr-frozen-runner-loss-adr](../../.imm/audit/wcr-frozen-runner-loss-adr/task-record.json) | done | routine | 1 | 0 | 0/0 | 0 |
| [wcr-finalize-adr-0006-0007](../../.imm/audit/wcr-finalize-adr-0006-0007/task-record.json) | done | routine | 1 | 0 | 0/0 | 0 |

合计：9 done、1 stopped；53 条 QA 通过记录、7 条 Review 通过记录；31 次 request_rework，其中 27 次来自 Review、4 次来自 QA；67 条 Review blocking（63 resolved、4 open），5 条 execution blocking（全部 resolved）。22 条 replan_required 中 21 resolved、1 open。

记录包含 21 次 authorize_rework、3 次 breaking revision 授权和 1 次用户 stop，共 25 条 literal-user authority 事件。这不包括可能未保存在这些历史数组中的初始 Enrollment，也不等于 25 次多余弹窗。普通 revise_intent 有 10 次，不能把它们算成用户批准。

53 条 QA 的 `(task_revision, intent_content_hash, diff_hash)` 在各任务内均不重复。证据支持“不同身份经历了多次 QA”，不支持“同一快照反复无意义重跑”。5 个 wcr 任务没有记录返工，但其执行前失败尝试和完整开发耗时仍未知。

## 前三个改进机会

### 1. 高优先级：跨入口和读写链路没有一次闭合

证据是相同变更主题在后续 Review 中继续暴露下游遗漏：

- `mws-migration-release`：`review-2bbbbc9d4513-1-review-1` 指出 importer 不存在；随后 `review-191529666252-1-review-1` 指出已补的迁移被外层 probe 和 CLI 路由挡住。内部能力存在不等于公开入口可达。
- `mws-assurance-review`：`review-03f8db20e12e-2-review-2` 指出 advisory 与 approval 分事务；随后 `review-305b261dc841-1-review-1`、`review-4ffd4f9f0f6b-1-review-1` 指出解析器和 v3/v4 分支仍无法保存该字段。
- `mws-sqlite-authority`：`review-35a63b7ba77a-2-review-2`、`review-8ae45ce29def-1-review-1` 指出 terminal/enrollment 重放无法从真实入口到达；`review-84a16f09be84-2-review-2` 又指出运行推进后重放会混入可变 claim。

这些 finding 均标记 resolved；它们证明历史检查遗漏，不证明当前仍缺实现。共同改进点是沿生产入口、状态所有者、序列化和下游读取方检查完整行为，不能只验证新 helper。

### 2. 高优先级：测试可能因错误原因通过

`mws-minimal-intent` 的 A2 在三轮 Review 中持续被指出证明不足：

- `review-a03830c914f6-2-review-2`：测试没有执行 rework，也没有证明旧 Spec 证据不能复用。
- `review-59da7a0f779e-2-review-2`：仅比较文件哈希，固定 diffProvider，没有创建并尝试复用 assurance。
- `review-23fad4734f54-2-review-2`：缺少 Review 本身即可导致拒绝，因而测试不能证明 Spec 内容变化造成证据过期。

改进方法：先证明原状态满足成功前置条件，再只改变要验证的条件，最后断言预期拒绝原因及副作用。这比增加更多同形测试更有价值。

边界：该结论来自记录里的具体反例，未重新执行这些历史版本；不宣称当前测试仍有同样问题。

### 3. 中优先级：返工集中，反复升级到用户处置

所有 31 次 request_rework 和 21 次 authorize_rework 都集中于 5 个 mws 任务。`mws-sqlite-authority` 单独出现 14 次返工、10 次再授权，最终完成；`mws-delivery-scope` 在 6 次返工后由用户明确停止，仍有 4 条 open blocking 和 1 条 open replan_required。

这表明多轮修复的认知与交互成本值得优先降低，但不能证明 gate 错误。历史 replan 摘要多次使用“同一 acceptance 两次返工”规则；当前 reducer 已有 rework budget 分支，不能把历史规则直接当作当前实现。

建议先减少前两类重复遗漏，再观察再授权事件是否下降；不直接放宽 gate、不把 stopped 当作完成或系统故障、不从事件间隔推断用户被迫等待的时长。

## 首选下一步：一个边界完整性试点

本轮只交付分析与复用方法。以下是下一项可评审的实施建议，尚未执行，也不授权恢复任何已停止任务。

目标：对下一项涉及共享契约、持久化或宿主入口的变更，在首次 Assurance 前找出与上述两类相同的遗漏。

最小改动候选：在 [Executor 现有交付前检查](../../plugins/immune-brain/runtime/prompts/executor.md) 中加入简短要求，并同步其生成镜像及现有相关契约测试；实际范围需先按生成与引用关系确认。不增加新角色、状态字段或用户 gate。现有 Code Quality Guard 已检查无 caller 的生产路径，新增内容只补足真实入口到持久化读取及测试因果性，避免重述既有规则。

建议内容：

> 对本次改变的共享行为，沿真实入口检查状态写入、序列化与读取方；用相关最小行为检查验证完整调用路径。拒绝类测试先证明原状态可成功，再仅改变目标条件，断言对应拒绝原因及副作用。返工时检查同一不变量的相关调用方；超出授权范围按现有规则报告。

验证方式：

1. 用上述三组具体历史反例检验新要求是否能导出正确检查动作，不运行历史有副作用的迁移。
2. 同步受影响的提示镜像和契约检查，运行对应 focused tests；不引入空泛“必须全面检查”的文本断言。
3. 接下来观察最多 5 个同类任务，仍按本报告口径区分 QA、Review、授权与不同证据身份；质量保障条件保持不变。小样本只报告趋势，不宣称因果提升。
4. 若现有指引已覆盖且没有新增收益，则不合入重复提示。若问题主要来自其他因素，调整后续优先级。

任务粒度可作为解释变量，但现有数据不足以证明“大任务导致返工”，因此暂不另建拆分规则。当前 4 条 open finding 也未验证是否随停止、后续提交而失去保护对象，不能据此自动开修复任务。

## 可复用经验与复验

复用入口：[workflow-evidence-retro Skill](../../.agents/skills/workflow-evidence-retro/SKILL.md)。本项目的 `imm-review-retro` 面向会话与模型评审负载，本 Skill 面向终态任务证据；它是项目本地分析工具，不加入插件公开 Managed 入口。

以下 Python 只读检查可在仓库根目录运行，复核固定样本及主要数字；完整样本路径直接取本文表格，因此新增审计不会改变历史基线。

```python
import collections, hashlib, json, pathlib, re
report = pathlib.Path('docs/reports/workflow-evidence-baseline.md')
paths = re.findall(r'\]\(../../(\.imm/audit/[^)]+/task-record\.json)\)', report.read_text())
assert len(paths) == len(set(paths)) == 10
counts = collections.Counter()
for path in paths:
    raw = pathlib.Path(path).read_bytes()
    record = json.loads(raw)
    proof = json.loads(pathlib.Path(path).with_name('terminal-proof.json').read_text())
    terminal = max((h for h in record['history'] if h['type'] in ('complete', 'stop')), key=lambda h: h['at'])
    assert proof['final_record_hash'] == 'sha256:' + hashlib.sha256(raw).hexdigest()
    assert proof['task_id'] == record['task_id']
    assert proof['terminal_lifecycle'] == record['lifecycle']
    assert proof['terminal_event_id'] == terminal['id']
    assert proof['terminalized_at'] == terminal['at']
    counts[record['lifecycle']] += 1
    counts.update(h['type'] for h in record['history'])
    qa = [a for a in record['attestations'] if a['kind'] == 'qa']
    counts['qa'] += len(qa)
    assert len(qa) == len({(a['task_revision'], a['intent_content_hash'], a['diff_hash']) for a in qa})
    counts['review_pass'] += sum(a['kind'] == 'review' for a in record['attestations'])
    for h in record['history']:
        if h['type'] == 'request_rework':
            counts['rework_' + h['authority']['authority_kind']] += 1
        if h.get('authority', {}).get('authority_kind') == 'user':
            counts['user_events'] += 1
    for f in record['findings']:
        counts[f"finding:{f.get('source')}:{f['kind']}:{f['status']}"] += 1
expected = {'done': 9, 'stopped': 1, 'qa': 53, 'review_pass': 7,
            'request_rework': 31, 'rework_review': 27, 'rework_qa': 4,
            'authorize_rework': 21, 'approve_breaking_intent_revision': 3,
            'revise_intent': 10, 'user_events': 25,
            'finding:review:blocking:resolved': 63, 'finding:review:blocking:open': 4,
            'finding:execution:blocking:resolved': 5,
            'finding:kernel:replan_required:resolved': 21,
            'finding:kernel:replan_required:open': 1}
for key, value in expected.items():
    assert counts[key] == value, (key, counts[key], value)
print('PASS: 10 audit pairs and baseline counts')
```

本次验证：上述只读检查通过；报告和 Skill 的相对文件链接、Skill frontmatter 与命名约束通过；Skill 方法用本样本完成一次流程演练。未改变运行时代码，未运行产品回归；Skill 对未来 Agent 行为的稳定性仍需实际使用验证。
