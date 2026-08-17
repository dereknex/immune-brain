> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: All-skills Natural Output Contract

**领域**: Agent workflow / repo-wide user-facing output contract
**描述**: 当一个仓库内存在多个 `imm-*` 角色 skill 时，默认用户输出应共享“先给当前结论，再给最短必要证据或边界，最后给下一步”的低密度基线，但保留不同角色的输出顺序差异与调试展开路径。

**reusability**: high
**next_reuse_scenarios**: [`imm-*` roster 扩大后需要统一默认输出体验, 多角色 workflow 想减少表单感与过程播报, 仍需保留 Codex-facing contract 与按需 debug 展开]

## 场景

- 仓库里有多种 `imm-*` role：framing、planning、workflow、execution、review、repair、bootstrap。
- 每个 skill 都保留 `Output artifact`、`Next Action`、`Allowed`、`Blocked`、`Workflow guard` 等 contract。
- 如果这些 contract 默认都直接映射成用户回复，整体体验会变得像在读协议或 checklist。
- 但如果只追求“自然语言”，又会失去后续 role 需要消费的边界信息与调试入口。

## 方案模板

1. **统一默认密度，不统一句式**: 全体 skill 共享“默认少说、按需展开”的规则，但不同角色保留最适合自己的顺序。
2. **按角色分默认输出顺序**:
   - framing / planning: `Conclusion -> Scope -> Next Action`
   - workflow / execution: `Conclusion -> Evidence -> Next step`
   - review / QA: `Decision or findings -> Why it matters -> Next step`
   - bootstrap / repair: `Outcome -> What changed or what blocked -> Next step`
3. **结构字段内外分层**: `Next Action` 默认保留；`Allowed`、`Blocked`、`Workflow guard`、packet schema、history、raw state 只在阻塞、失败、边界风险、路由变化或用户要求 debug 时展开。
4. **artifact 留给 traceability，不强制变成用户模板**: `Output artifact` 是内部稳定契约，不等于每次用户回复都逐项回显。
5. **把规则写进 repo-facing 文档**: 不能只散落在个别 skill 里；至少需要一份共享 pattern 和一处 README 说明。
6. **用 focused regression 锁住一致性**: 契约测试应检查 repo-wide 的输出密度规则存在，并允许 role-specific 例外。

## 可复用前提

- 仓库存在多个长期协作的 role skill，而不是单一用途 prompt。
- 技术上需要继续保留 machine-readable contract，但默认协作目标是让用户先拿到当前结论。
- 不同 role 的输出重点天然不同，因此需要“共享基线 + 角色例外”而不是统一模板。

## 验证依据

- [all-skills-natural-output.spec.md](docs/specs/all-skills-natural-output.spec.md) 把 repo-wide contract 定义为：默认自然输出、按需展开结构字段、保留 role-specific 顺序差异。
- [README.md](README.md) 将该规则提升为 repo-facing 执行说明，明确默认成功路径不应把 schema 字段直接展开给用户。
- [default-debug-workflow-output-split.md](docs/solutions/default-debug-workflow-output-split.md) 提供 workflow / QA 类 role 的 default/debug 分流基线。
- [framing-stage-terse-handoff.md](docs/solutions/framing-stage-terse-handoff.md) 提供只读 framing role 的结论优先 handoff 基线。
- [imm-preplan-review](skills/imm-preplan-review/SKILL.md), [imm-planner](skills/imm-planner/SKILL.md), [imm-party](skills/imm-party/SKILL.md) 现在都显式定义了 framing / planning 类的短 handoff 规则，而不是默认展开 artifact schema。
- [imm-executor](skills/imm-executor/SKILL.md), `imm-autowork`, [imm-compounder](skills/imm-compounder/SKILL.md) 明确把 execution packet、run snapshot、learning capture 视为 traceability artifact，而不是默认用户回复模板。
- [imm-code-review](skills/imm-code-review/SKILL.md), [imm-ui-review](skills/imm-ui-review/SKILL.md), [imm-pr-fix](skills/imm-pr-fix/SKILL.md) 现在都定义了 findings-first / status-first / repair-outcome-first 的简短默认输出。
- `tests/test_skill_contracts.py` 现在覆盖全体本地 `imm-*` skills 的 `Output style` 存在性，并检查代表性的 role-specific output shape。
- `python3 -m unittest tests/test_skill_contracts.py` 通过，说明这条 repo-wide contract 已经有 focused regression 守卫，而不是只停留在文档描述。

## 约束与建议

- 不要把“自然输出”误解成“可以删掉 contract 字段”；真正要变的是默认外显密度。
- 不要把所有 role 压成同一种句式模板；统一的是节制和展开条件，不是语言表面完全一致。
- 如果某个 skill 默认仍需要大段过程说明，优先检查它是否职责过宽，或是否缺少 debug-only 分流。
- 这类规则最好先写共享 pattern，再分组落到 skill contract；否则很容易每个 skill 各写各的，最后再次漂移。
- 新增 `imm-*` skill 时，应同时补齐 `Output style`、repo-wide contract 对应分组、以及 `tests/test_skill_contracts.py` 的覆盖；否则默认输出体验会再次分叉。

---
*沉淀日期: 2026-05-08 | 来源: all-skills natural output 计划闭环*
