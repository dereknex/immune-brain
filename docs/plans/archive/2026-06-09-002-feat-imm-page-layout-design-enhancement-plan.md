---
title: "feat(design-review): enhance page layout design and ui review contract sync"
type: feat
status: proposed
date: 2026-06-09
origin: imm-brainstorm framing - user agreed on sync page-layout and ui-review contracts
---

# Iteration Plan

## Task

- Summary: 强化 `imm-page-layout-design` 与 `imm-ui-review` 契约，引入按钮分级折叠、表单宽度防御和图标混排等前置设计与后置审查双向约束。
- Spec: docs/specs/imm-page-layout-design-enhancement.spec.md
- Origin: 截图 `bad-ui-layout.png` 暴露出的按钮平铺无主次、输入框无限横向拉伸、无图标等平庸 AI UI 痛点。需要从前置设计（imm-page-layout-design）和后置审查（imm-ui-review）同步强化，达成闭环约束。
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-REQ-004; BR-REQ-005; BR-DEC-001; BR-DEC-002; BR-DEC-003
- Research: `plugins/immune-brain/dist/imm-page-layout-design.md` 当前对信息和操作分离的设计说明偏笼统，缺少高低频动作折叠、最大宽度硬性控制的指导。`plugins/immune-brain/dist/imm-ui-review.md` 是后置审查关卡，没有明确指出将前置 `layout_design` 作为核对标准，也没有明确指出平铺冗余按钮、表单过度拉伸为 UI 缺陷。`docs/reference/ux-heuristic-checklist.md` 缺少渐进呈现按钮和输入框高溢出防御的详细检查条目。`tests/test_skill_contracts.py` 包含 `test_imm_page_layout_design_defines_pre_implementation_layout_contract`，可通过添加针对折叠、宽度及图标等关键字断言来进行回归测试。
- Decisions: D1 在 `imm-page-layout-design` 中强制 `layout_design` 的 `operation_regions` 定义 `visible_actions`（最多2个）和 `hidden_actions`（折叠）。D2 在 `imm-ui-review` 中要求将 `layout_design` 作为审查标准，将不合理的按钮平铺、输入框无脑拉伸列为 P1 缺陷打回。D3 扩展 Heuristics checklist，对折叠及宽度设定数值参考（如 max-w-md / 448px 限制）。D4 不修改实际 UI 界面代码，只修改规范文档和测试断言，确保读写边界清晰。
- Assumptions: 新契约可在测试和规范文档中完全对齐，暂无 runtime 格式破坏。
- Scope Mode: Hold Scope
- Planner research dispatch: solo

## Output Language

- Human-readable prose: Chinese
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | Step U1 中在 UI Review 和 Heuristic 中加入对冗余平铺操作按钮（如 MiniMax 示例）的审查和优化设计规范。 |
| BR-REQ-002 | covered_by_step | U1 | Step U1 明确图标语义锚点（icon_semantic_anchors）契约，增加图标指示作用。 |
| BR-REQ-003 | covered_by_step | U1 | Step U1 增加表单拉伸限制与分栏/Bento Layout 设计策略（form_stretching_limits）。 |
| BR-REQ-004 | covered_by_step | U1 | Step U1 强化 `imm-page-layout-design.md`，在 `layout_design` 中增加可见与折叠操作、输入框宽度限制等规范。 |
| BR-REQ-005 | covered_by_step | U1 | Step U1 升级 `imm-ui-review.md` 规范，使其强制核对 `layout_design`，将过度平铺和拉伸列为 P1 错误。 |
| BR-DEC-001 | covered_by_step | U1 | Step U1 更新 `ux-heuristic-checklist.md` 的 Heuristic 条目。 |
| BR-DEC-002 | covered_by_step | U1 | Step U1 提议在 Layout 设计端与 Work 执行端隐式引入 `high-end-visual-design` 里的双 Bezel 与过渡缓动规范。 |
| BR-DEC-003 | covered_by_step | U1 | Step U1 确立“设计契约前置约束 > 后置 UI 审计”的闭环策略。 |

## Devil's Advocate Audit

1. **Rollback Resilience**: 本 Plan 只修改 markdown 规范文件与 `test_skill_contracts.py`。若强化后的契约在实操中引起开发代理过度报错，只需回退这几个技能规范的 md 文档与测试文件，即可完全恢复为原有行为。
2. **Verification Vanity**: 验证不会仅检查单词是否存在。单元测试中将精确断言 `imm-page-layout-design` 规范中必须含有 `visible_actions`、`hidden_actions`、`collapsed: true`、`form_stretching_limits`、`icon_semantic_anchors` 词汇，并且确保全量合同测试完全绿屏。
3. **Spec Dilution Detection**: 确保没有漏掉任何 brainstorm items。Brainstorm manifest 中所有的设计和审查强化规则均在此 Plan 的唯一 Step U1 中获得覆盖。

## Steps

### Step 1

- Step ID: U1
- Result: Tightened UI design review contract
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_imm_page_layout_design_defines_pre_implementation_layout_contract && python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-06-09-002-feat-imm-page-layout-design-enhancement-plan.md --json`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers BR-REQ-004 by asserting that layout design contract demands visible_actions and hidden_actions with collapsed: true; Covers BR-REQ-005 by asserting that ui review contract enforces layout_design constraints; Covers BR-DEC-001 by asserting new action-collapsing and form stretch limits are mentioned in checklists.
- Discovery cache: plugins/immune-brain/dist/imm-page-layout-design.md (pre-implementation contract); plugins/immune-brain/dist/imm-ui-review.md (post-implementation review contract); docs/reference/ux-heuristic-checklist.md (usability checklists); tests/test_skill_contracts.py (focused test file)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: 若修改后导致其他技能的 contract test 发生漂移或报错，必须在 U1 范围内修复测试断言或补充其他技能的 contract 同步，不得退回无约束版本。
- security_considerations: 无特殊安全敏感逻辑。修改仅限于 markdown 说明文件和测试文件。

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-09-002-feat-imm-page-layout-design-enhancement-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-09-002-feat-imm-page-layout-design-enhancement-plan.md --sync`
