# Pattern: Outcome-First Rule Framing + Collaboration Posture Block

**领域**: Skill authoring / baseline design / agent prompt quality
**描述**: 当 skill 的 BASELINE 或 Workflow Rules 以过程导向措辞（"做什么"）描述规则时，把它们重写为成功标准形式（"什么时候算成功"）；同时在 BASELINE 增加一个简短的 Collaboration Posture 块，明确何时提问、何时凭合理假设推进、以及不确定时如何处理，从而减少不必要的停顿并与现代大模型（GPT-5.5 等）的 outcome-first prompting 指导对齐。

**reusability**: high
**next_reuse_scenarios**: [`新增 skill 时直接用成功标准形式描述规则而非过程步骤`, `任何 BASELINE 引用的 skill 体系的初始设置`, `从旧版过程导向提示迁移到结果优先提示时的参考模板`, `多人协作 skill 体系需要统一"何时停下来问"边界时`]

## 场景

- Skill 的 Shared Guards 或 Workflow Rules 用"先做 A，再做 B"的过程语言写成，等效于给模型规定路径，而不是定义终止条件。
- 模型会机械地走步骤而不是在"已经足够"时停止，或者在"不够清晰时应该问"的边界上行为不一致。
- 没有共享的 Collaboration Posture 块，每个 skill 独立处理"是否提问"的决策，导致行为不一致（有的 skill 过度提问，有的 skill 假设过多）。

## 方案模板

### 1. 规则从过程改为成功标准

**之前（过程导向）：**
```
1. Think before coding: Clarify assumptions before implementation.
2. Simplicity first: Only implement the minimum solution.
3. Surgical changes: Only modify necessary files.
4. Goal-driven execution: Every step must be verifiable.
```

**之后（成功标准形式）：**
```
A step is ready to execute only when assumptions, ambiguities, and trade-offs have been clarified. (Think before coding)
A solution is complete when it implements the minimum required for the current goal and nothing more. (Simplicity first)
A change is acceptable when every modified file and line is within the boundary of the active step. (Surgical changes)
A step is closable only when its result is verifiable via command, test, or manual check. (Goal-driven execution)
```

重写要点：每条规则以 "X is [adjective] only when Y" 或 "X is [adjective] when Y" 形式表达，让 Y 成为可检验的终止条件。

### 2. Collaboration Posture 共享块

在 BASELINE 加一个短块（3 条规则，不超过 5 行）：

```markdown
## Collaboration Posture

- **When to ask**: Raise a question only when missing information would materially change the answer or create meaningful risk. Keep any question narrow and single-focused.
- **When to proceed**: When the request is clear enough to attempt, prefer making progress on reasonable assumptions over stopping for clarification. State the assumption explicitly.
- **Uncertainty handling**: When evidence is incomplete, use the minimum sufficient evidence to proceed, record what is missing, and describe the next best check rather than halting.
```

### 3. Contract test 锁住 Collaboration Posture

```python
def test_baseline_has_collaboration_posture(self) -> None:
    baseline = (repo_root / "skills/BASELINE.md").read_text()
    self.assertIn("Collaboration Posture", baseline)
    self.assertIn("When to ask", baseline)
    self.assertIn("When to proceed", baseline)
```

## 可复用前提

- 有一个被所有 skill 引用的共享 BASELINE.md（或等效文件）。
- Skill 体系有多个 agent 角色，各自独立决策"是否提问"。
- 目标是让 agent 在"足够清楚时推进，不够清楚时问一个窄问题"，而不是"遇到任何不确定就停下"。

## 验证依据

- `skills/BASELINE.md` Shared Guards 节以成功标准形式呈现四原则，使用 "ready to execute only when" 和 "closable only when" 等可检验终止语言。
- `skills/BASELINE.md` 包含 Collaboration Posture 块，涵盖 When to ask、When to proceed、Uncertainty handling 三条规则。
- `tests/test_skill_contracts.py::test_baseline_has_success_criteria_form` 和 `test_baseline_has_collaboration_posture` 两个 contract test 锁住内容。
- 来源：GPT-5.5 Prompting Guide 的 "Outcome-first prompts" 和 "Personality and behavior" 两节的 collaboration style block 建议。

## 约束与建议

- Collaboration Posture 块应保持简短（3 条以内）；不要用它替代 skill 具体的 boundary 或 workflow rules。
- 成功标准形式保留原来的"四原则"名称作为括号注释，方便追溯；不要完全删除原有语义。
- 如果 skill 体系没有共享 BASELINE，将 Collaboration Posture 嵌入最高频使用的 entry skill（如 imm-work 等价物）。
- 不需要为每条规则都改成成功标准形式——只改那些容易被机械执行的过程性规则；判断框架、authority rules 等保持不变。

---
*沉淀日期: 2026-05-11 | 来源: GPT-5.5 prompt guidance alignment plan 063 U1 验收*
