> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Tested Skill Contracts

**领域**: Agent workflow / Skill contracts  
**描述**: 当 workflow skill 的关键约束只写在文档里时，把这些约束提升成可运行测试，确保 contract fields、角色边界和 workflow guards 能被机械验证，而不是靠人工记忆。

## 场景

- skill 已经有清晰的职责分工，但不同 skill 的输出字段不一致，后续阶段消费时容易漏掉关键 contract。
- 系统已经开始依赖 `Next Action`、`Allowed`、`Blocked`、`Workflow guard` 这类显式字段，但没有统一测试会让新 skill 或后续修改悄悄掉字段。
- 仅靠“这个 skill 应该是只读 / 应该拦截没有 plan 的实现”这类自然语言提醒，无法稳定防止回归。
- 想先做一个高杠杆的 harness 起点，但又不想一开始就扩成完整 runtime workflow harness。

## 方案模板

1. **先定义稳定 contract 字段**: 把用户可见 workflow skill 需要暴露的最小字段写清楚，例如 `Next Action`、`Allowed`、`Blocked`、`Workflow guard`。
2. **把检查拆成三类**:
   - contract fields coverage
   - role boundary coverage
   - workflow guard coverage
3. **优先复用现有测试入口**: 如果仓库已经有 skill contract 测试文件，优先在原入口扩展，而不是再造一套平行 validator。
4. **文本检查只做小而明确的规则**: 不把 prompt 风格、美学偏好或泛语义分类塞进首版 lint。
5. **让 spec 明确验证入口**: 在 spec 里写死首选测试入口和补充路径，避免后续实现者再猜“该怎么证明闭合”。

## 可复用前提

- skill contract 本身属于跨项目或跨阶段工作流约束，而不是某个局部实现细节。
- 这些约束主要存在于 skill 文本中，可以通过静态文本检查稳定判断。
- 仓库已经有本地测试入口，或者至少能容纳一个 focused 的 contract test 文件。
- 当前目标是让 workflow 对 agent 更可读、更可检，而不是一次性补齐完整 runtime state harness。

## 验证依据

- `tests/test_skill_contracts.py` 现在把检查拆成三类：contract fields、role boundaries、workflow guards。
- [skill-contract-lint.spec.md](docs/specs/skill-contract-lint.spec.md) 现在明确 `tests/test_skill_contracts.py` 是首选验证入口，`focused fixtures` 只作为补充。
- [imm-code-review](skills/imm-code-review/SKILL.md), [imm-compounder](skills/imm-compounder/SKILL.md), [imm-party](skills/imm-party/SKILL.md), [imm-pr-fix](skills/imm-pr-fix/SKILL.md), [imm-ui-review](skills/imm-ui-review/SKILL.md) 已补齐缺失的 `Next Action` / `Allowed` / `Blocked` / `Workflow guard` 字段。
- `python3 -m unittest tests.test_skill_contracts` 通过，说明当前 contract 字段、边界和 guard 至少已经形成一个可运行的闭环。

## 约束与建议

- 这类测试适合做“文本 contract 是否存在、是否对齐”的检查，不适合冒充完整 runtime harness。
- 不要在首版就把所有 workflow 语义塞进正则或关键词规则；一旦需要更强状态验证，应单独规划 workflow harness。
- 不要把 role boundary 和 workflow guard 混成一个大而空的“skill quality”测试；拆开后才能看出是哪一层 contract 在回归。
- 新增 `imm-*` skill 时，优先先补 contract 字段和对应测试，再考虑更复杂的执行逻辑。

---
*沉淀日期: 2026-05-07 | 来源: skill-contract lint 首轮实现与验收；参考 OpenAI Harness engineering 文章启发*
