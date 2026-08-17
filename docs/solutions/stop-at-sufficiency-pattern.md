# Pattern: Stop-at-Sufficiency — Stop-Check Loop + Retrieval Budget

**领域**: Agent execution / subagent dispatch / prompt quality
**描述**: 在执行链路（executor / worker skill）的 Workflow Rules 中加入 Stop-Check 自评估规则，在每次执行轮次后主动判断"当前步骤是否已有足够证据闭合"；同时在有 subagent 研究 dispatch 的 Research Dispatch 节加入 Retrieval Budget 规则，明确"有足够证据时停止 dispatch"。两个模式共享同一个核心问题：已有的东西够了吗？

**reusability**: high
**next_reuse_scenarios**: [`新增 executor/worker skill 时直接在 Workflow Rules 加 Stop-Check 条目`, `任何带 subagent research dispatch 的 brainstorm/planner 类 skill 加 Retrieval Budget`, `迁移到更强 reasoning 模型时从过度迭代保护中受益`, `多步 agent 自动运行（autowork 风格）防止步骤超出边界`]

## 场景

- Executor skill 执行多轮工具调用，但没有显式的"够了就停"判断，容易过度实现或者在目标已达成后继续迭代。
- Research Dispatch 有触发条件（如 `multi_domain >= 2`），但没有停止规则——dispatch 继续，直到预设并发上限，即使核心问题已经被前几个 agent 的结果回答了。
- 两个问题都导致不必要的 token 消耗和执行时间，且增加超出步骤边界的风险。

## 方案模板

### 1. Stop-Check Loop（嵌入 Workflow Rules）

在 executor 或 worker skill 的 Workflow Rules 节加一条规则：

```markdown
- **Stop-Check**: After each set of edits [or: after each execution round], evaluate:
  "Does the active step now have sufficient verifiable evidence to close?"
  If yes, stop and hand off to `imm-qa` [or the review gate].
  Do not implement beyond what is required to close the current step result.
```

关键要素：
- 触发时机：每次编辑集合或工具轮次之后（不是每个工具调用内部）
- 评估问题：明确写出来，让 agent 作为 self-check 问句
- 停止行为：若充足，停止并移交；不是"尽量少做"而是"足够了就停"

### 2. Preamble Convention（配合 Stop-Check 使用）

多步或工具密集任务在进入执行前先发一条可见更新：

```markdown
- **Preamble**: For multi-step or tool-heavy tasks, emit a short visible user update
  acknowledging the request and naming the first step before starting execution.
  Keep it to one or two sentences.
```

### 3. Retrieval Budget（嵌入 Research Dispatch 节）

在 brainstorm/planner 类 skill 的 Research Dispatch 节加一段：

```markdown
**Retrieval budget:** Stop dispatching as soon as existing evidence is sufficient to
[answer the core framing question / decompose steps with concrete verification paths].
Do not dispatch additional agents to improve phrasing, add examples, or fill in
non-essential details. Dispatch again only when a required [constraint / interface
contract / file dependency] is still missing and would block [framing / step decomposition].
```

关键要素：
- 停止条件：已有证据足以完成核心任务（不是最优，是"足够"）
- 明确排除：不为了润色、加例子、填非关键细节而继续 dispatch
- 再 dispatch 条件：仍有必要信息缺失且会 block 下一步时才继续

### 4. Contract Test 锁住

```python
def test_work_and_executor_have_stop_check_and_preamble(self) -> None:
    for content, name in [(work, "imm-work"), (executor, "imm-executor")]:
        self.assertIn("Stop-Check", content)
        self.assertIn("sufficient verifiable evidence", content)
        self.assertIn("Preamble", content)
        self.assertIn("visible user update", content)

def test_brainstorm_and_planner_research_dispatch_have_retrieval_budget(self) -> None:
    for content, name in [(brainstorm, "brainstorm"), (planner, "planner")]:
        self.assertIn("Retrieval budget", content)
        self.assertIn("sufficient to", content)
```

## 可复用前提

- Skill 体系有明确的执行边界（一步一个结果，有 QA 关口）。
- Research Dispatch 有触发条件但尚无 budget ceiling。
- 目标 agent runtime 支持多轮工具调用（有"继续"的能力，因此需要"停止"的规则）。

## 验证依据

- `skills/imm-work/SKILL.md` 和 `skills/imm-executor/SKILL.md` 的 Workflow Rules 各包含 Stop-Check 和 Preamble 两条规则，文本明确包含 "sufficient verifiable evidence" 和 "visible user update"。
- `skills/imm-brainstorm/SKILL.md` 和 `skills/imm-planner/SKILL.md` 的 Research Dispatch 节各包含 Retrieval budget 段，文本明确包含 "sufficient to" 停止判断。
- `tests/test_skill_contracts.py` 的 `test_work_and_executor_have_stop_check_and_preamble` 和 `test_brainstorm_and_planner_research_dispatch_have_retrieval_budget` 两个 contract test 锁住内容。
- 来源：GPT-5.5 Prompting Guide 的 "Outcome-first prompts and stopping conditions" 和 "Grounding, citations, and retrieval budgets" 两节。

## 约束与建议

- Stop-Check 在工具轮次边界判断，不是在每个单独工具调用内部判断，避免过早停止。
- Retrieval Budget 是触发后的停止判断，不是替代触发条件；触发条件（`multi_domain >= 2`）仍然决定是否开始 dispatch。
- 两个规则都强调"足够"而不是"最优"——agent 不应该因为"可以做得更好"而继续，只有"缺少必要信息"才继续。
- Preamble 独立于 Stop-Check，但两者配合使用效果最好：Preamble 明确告诉用户"我要做什么"，Stop-Check 确保"做到够了就停"。

---
*沉淀日期: 2026-05-11 | 来源: GPT-5.5 prompt guidance alignment plan 063 U2-U3 验收*
