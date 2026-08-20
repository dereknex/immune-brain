---
title: "feat(design-review): expand page layout design to page design skill"
type: feat
status: proposed
date: 2026-06-15
origin: imm-brainstorm framing - user agreed to expand page-layout-design to page-design
---

# Iteration Plan

## Task

- Summary: 将 `imm-page-layout-design` 升级扩展为 `imm-page-design`，包含有设计来源或用户明确要求时才定义视觉字段的页面设计契约、条件化动效/媒体规范，并重构测试套件与审计逻辑。
- Spec: docs/specs/archive/imm-page-design-expansion.spec.md
- Origin: 头脑风暴中用户提出将布局设计技能扩展为整体页面设计，摆脱 AI 生成界面时在配色、动效、质感层面的混乱。
- Brainstorm manifest: BR-REQ-001; BR-REQ-002; BR-REQ-003; BR-REQ-004; BR-REQ-005; BR-DEC-001; BR-DEC-002; BR-DEC-003; BR-DEC-004; BR-OUT-001; BR-OUT-002; BR-DEFER-001
- Research: `plugins/immune-brain/dist/imm-page-layout-design.md` 仅包含结构与表单拉伸限制。测试套件 `tests/test_skill_contracts.py` 对重命名和新字段缺失会报错。后置审计 `imm-ui-review.md` 缺少对视觉与动效参数的对照审计。需要更新的文档包括：`README.md`、`docs/user_manual.md`、`docs/solutions/contracts.md`、`docs/reference/immune-brain-skill-details/README.md`、`docs/reference/immune-brain-skills-guide.md`。
- Decisions: D1 重命名原 layout 技能文件、路径、元数据注册及文档引用为 `imm-page-design`。D2 前置设计技能中引入 `visual_direction_source`，有设计来源或用户明确要求时才定义视觉字段；缺少来源时标记为 `unknown` / `not_applicable`。D3 提供 Standard 和 Rich 两档复杂度预设，Standard 覆盖结构/操作/响应式和继承主题 token，Rich 仅在来源支持或用户明确要求时加入动效、媒体策略与流派标签。D4 后置 UI 审计基于"声明式契约对照"校验参数而非主观美感，采用 Clean Break 策略直接替换 `layout_design` 为 `page_design`，并按严重性分级而非一律 P1。D5 项目根目录存在 `DESIGN.md` 时作为最高优先级继承源。D6 保持 Code-free 属性，仅改动 markdown 说明文件与测试文件。D7 历史 spec/plan 文件（4个）为只读归档，禁止修改。
- Assumptions: 技能重命名后，对原有业务项目中的 layout design 契约不保留向后兼容（Clean Break），旧项目重新运行即可生成新契约。
- Scope Mode: Hold Scope
- Planner research dispatch: solo

## Output Language

- Human-readable prose: Chinese
- Preserved literals: file paths, commands, schema fields, enum values, API names, code identifiers, and `CONTEXT.md` canonical terms

## Brainstorm Trace

| Item | Status | Target | Reason |
|------|--------|--------|--------|
| BR-REQ-001 | covered_by_step | U1 | Step U1 在 `imm-page-design` 中引入 `visual_palette` 与 `theme`，但要求有设计来源或用户明确要求时才定义视觉字段；缺少来源时标记为 `unknown` / `not_applicable`。 |
| BR-REQ-002 | covered_by_step | U1 | Step U1 在契约中增加 `image_strategy` 字段定义图像风格质感要求，但只描述媒体角色、来源和约束，不绑定具体渲染或生成工具。 |
| BR-REQ-003 | covered_by_step | U1 | Step U1 在契约中引入 `motion_contract` 规范动效节奏、持续时间及缓动曲线；缺少来源或页面需求时标记为 `not_applicable`。 |
| BR-REQ-004 | covered_by_step | U1 | Step U1 在契约中引入 `aesthetic_genre`，但只作为来源支持的视觉方向标签，不把内部 skill 名称或主观偏好当默认流派。 |
| BR-REQ-005 | covered_by_step | U1 | Step U1 承诺无任何业务 UI 代码、React组件或 CSS 代码改动，纯规范及测试修改。 |
| BR-DEC-001 | covered_by_step | U1 | Step U1 完成技能目录、说明文档（含 README、user_manual、contracts、skill-details）、元数据注册和测试套件中所有 `layout-design` 向 `page-design` 的重命名重构。 |
| BR-DEC-002 | covered_by_step | U1 | Step U1 强制要求存在 `DESIGN.md` 时，页面契约通过 `design_contract_source` 标明对已有设计的继承。 |
| BR-DEC-003 | covered_by_step | U1 | Step U1 更新 `imm-ui-review` 逻辑，采用 Clean Break 策略和"声明式对照审计"，校验参数是否按契约实现，不审计主观美感。 |
| BR-DEC-004 | covered_by_step | U1 | Step U1 在契约中支持 `Standard` (结构/操作/响应式和继承主题 token) 和 `Rich` (有来源支持时的动效、媒体策略与流派标签) 的复杂度预设分级，并在 heuristic checklist 中定义等级差异化校验规则。 |
| BR-OUT-001 | out_of_scope | U1 | 仅在页面契约层面引用全局 `DESIGN.md`，不参与生成或修改项目全局 `DESIGN.md`。 |
| BR-OUT-002 | out_of_scope | U1 | 本次重构与后续前置页面契约产出阶段皆不生成任何 CSS 代码。 |
| BR-DEFER-001 | deferred | U1 | 深度无障碍审查（a11y）规则细节推迟到 UI Review 审计环节，前置设计阶段只做色彩对比度等基础指导。 |

## Devil's Advocate Audit

1. **Rollback Resilience**: 本 Plan 只修改 markdown 规范文件、元数据注册与 `test_skill_contracts.py`。若重构后的契约在实操中引起代理报错，只需撤销这些技能规范的 md 文档与测试文件变动，即可瞬间无害回退。历史 spec/plan 文件（4个）明确标记为只读归档不被修改，不会影响回滚。
2. **Verification Vanity**: 校验不只是看文本存在。测试中将断言技能目录重命名、新的 `page_design` 契约参数（含 `visual_direction_source`、`image_strategy`）缺失校验，同时断言 Spec、Plan 和用户文档都表达有设计来源或用户明确要求时才定义视觉字段、缺少来源时标记为 `unknown` / `not_applicable`，且必须通过 `unittest` 执行所有 contract tests。UI review 测试将验证 Clean Break 后 `page_design` 替代 `layout_design`，并采用按严重性分级的对照审计规则。
3. **Spec Dilution Detection**: 确保没有漏掉任何 brainstorm items。Brainstorm manifest 中的 12 项需求与决策在 Step U1 中完全映射，并通过 trace 表逐一说明。BR-REQ-002 的 `image_strategy` 字段已补充至输出 schema。

## Steps

### Step 1

- Step ID: U1
- Result: Upgraded page design contract
- Verification: `python3 -m unittest tests.test_skill_contracts.SkillContractTests.test_imm_page_design_defines_pre_implementation_design_contract && python3 -m unittest tests.test_skill_contracts && python3 .imm/imm-plan.py docs/plans/2026-06-15-001-feat-imm-page-design-expansion-plan.md --json`
- Verification type: automated
- Execution note: test-first
- Test scenarios: Covers BR-REQ-001, BR-REQ-002, BR-REQ-003, BR-REQ-004 by asserting target fields including `visual_direction_source` and `image_strategy` are defined in dist/imm-page-design.md with source-backed guardrails; Covers BR-DEC-001 by verifying directory rename, registry update, and all 5 doc file updates; Covers BR-DEC-003 by asserting ui review contract requires declarative page_design parameter verification with Clean Break from layout_design and severity mapping.
- Discovery cache: plugins/immune-brain/dist/imm-page-design.md (page design contract); plugins/immune-brain/dist/imm-ui-review.md (review contract); docs/reference/ux-heuristic-checklist.md (checklists); tests/test_skill_contracts.py (contract tests); plugins/immune-brain/skills/registry.yaml (skills registry); plugins/immune-brain/dist/registry.yaml (dist registry); README.md (project readme); docs/user_manual.md (user manual); docs/solutions/contracts.md (artifact ownership); docs/reference/immune-brain-skill-details/README.md (skill details); docs/reference/immune-brain-skills-guide.md (skills guide)
- Agent Hint: imm-executor
- Depends on: none
- failure_behavior: 若重命名和测试修改导致其他技能契约或构建机制测试报错，必须立即在 U1 范围内调整相关测试用例或技能声明以保持通过。禁止修改历史 spec/plan 文件（docs/specs/imm-page-layout-design-*.spec.md 和 docs/plans/2026-06-08-003-*、docs/plans/2026-06-09-002-*）。
- security_considerations: 无安全风险，纯只读规则文档和测试重构。

## Validation

- Plan validator: `python3 .imm/imm-plan.py docs/plans/2026-06-15-001-feat-imm-page-design-expansion-plan.md --json`
- Runtime sync: `python3 .imm/imm-plan.py docs/plans/2026-06-15-001-feat-imm-page-design-expansion-plan.md --sync`
