# Pattern: Progressive disclosure review lens via thin index

**领域**: Agent workflow / Skill governance / Review extensibility  
**描述**: 为 `imm-code-review` 增加新的审查维度时，不新建独立 skill 或 authority role，而是在 `docs/reference/` 写**薄索引**（摘要 + submodule 全文链接），再由 review skill 的 Progressive checklists 一行引用挂载。

## 场景

- 团队想把上游的 code simplification / performance / accessibility 等专题能力引入 review 流程，但不想为每个专题新建带 authority 闭环的独立 skill。
- 新维度的深度内容已在 `upstreams/` submodule 中存在，本仓库只需摘要 + 触发条件 + 路由声明。
- IMMUNE §3 写入边界要求：只读审查角色不得扩展成新的 authority path。

## 方案模板

1. **薄索引**：在 `docs/reference/` 新建 `<topic>-checklist.md`；内容按固定结构：索引定位声明 → 操作摘要（范围解析 / 检查维度 / 何时不做）→ 深度参考表（submodule 相对路径）→ Immune-Brain 边界声明。
2. **触发挂载**：在 `imm-code-review` 的 Progressive checklists bullet 追加一句，格式为 "For **<topic>** ... load [`docs/reference/<topic>-checklist.md`](...)"，含触发条件（如 branch diff / PR 前审查）。
3. **路由不变**：简化 findings 仍走 `direct_fix` / `new_slice`，不引入新 decision path。
4. **测试**：现有 `test_skill_contracts.py` 覆盖 `imm-code-review` 章节标题，新增索引不需要新断言。

## 可复用前提

reusability: medium

next_reuse_scenarios: 为 review 增加 deprecation lens、migration safety lens、或其他来自 upstream 的专题审查维度时，复用同一薄索引 + 单行挂载模式。

## 验证依据

- 053 计划 2 步全部 QA pass：`docs/reference/code-simplification-checklist.md` 满足 spec §2.1 全部 6 项；`imm-code-review` Progressive checklists 含触发条件与路径；56 项契约测试通过；Boundary section 未变。

## 约束与建议

- 薄索引**不是 SKILL.md**：它没有 frontmatter、没有 authority boundary、不参与 `imm-work` 路由。
- 触发条件应具体（如 "branch diff where functional correctness is verified"），避免变成默认每次 review 都加载。
- 先例：`agent-quality-checklists.md` 是同模式的第一个实例（security / testing / performance / accessibility 四链接）。

---
*沉淀日期: 2026-05-10 | 来源: 053 code simplification lens plan 闭环*
