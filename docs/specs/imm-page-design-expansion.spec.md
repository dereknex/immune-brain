> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: Imm Page Layout Design to Page Design Skill Expansion

**Task ID**: IMM-PAGE-DESIGN-EXPANSION-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

将 `imm-page-layout-design.md` 技能全面重构并升级为 [imm-page-design.md](plugins/immune-brain/dist/imm-page-design.md)。此升级将超越单纯的"骨架与布局网格"，把页面结构、主题继承、动效节奏、媒体资产策略以及审美方向纳入来源驱动的契约定义；视觉字段仅在有设计来源或用户明确要求时定义，并与下游的 [imm-ui-review.md](plugins/immune-brain/dist/imm-ui-review.md) 审计逻辑通过"声明式契约对照审计"无缝串联。

## 2. Context & Boundaries

- 核心修改仅涉及技能说明文档、指南文档、启发式检查表和测试断言，必须保持 **Code-free（无代码生成）** 的原则。禁止编写实际的 UI 页面、组件代码或 CSS 样式。
- 当项目根目录存在 `DESIGN.md` 时，必须硬性要求将其作为页面设计的绝对源头进行继承。
- 升级后的 `page_design` 契约需要兼容原有的 `layout_design` 核心布局能力，并支持通过 `design_tiers` 对复杂度进行分级（Standard 与 Rich）。视觉、主题、动效和媒体字段必须有设计来源或用户明确要求时才定义视觉字段；缺少来源时标记为 `unknown` / `not_applicable`，不得发明默认风格。

## 3. Requirements

### R1. 技能重命名与注册更新
- 将 `plugins/immune-brain/skills/imm-page-layout-design/` 目录重命名为 `plugins/immune-brain/skills/imm-page-design/`。
- 将重命名后的 `SKILL.md` 顶部的 `name` 修改为 `imm-page-design`，描述中去除非必要的 "layout" 限制。
- 重命名 `plugins/immune-brain/dist/imm-page-layout-design.md` 为 `plugins/immune-brain/dist/imm-page-design.md`。
- 更新 [registry.yaml](plugins/immune-brain/skills/registry.yaml) 以及 `plugins/immune-brain/dist/registry.yaml`：将所有的 `imm-page-layout-design` 修改为 `imm-page-design`，同时将其产出的工件由 `layout_design` 升级为 `page_design`。

### R2. 前置页面设计契约升级 (`imm-page-design`)
- 在 [imm-page-design.md](plugins/immune-brain/dist/imm-page-design.md) 中扩展 `Core Responsibilities` 与 `Workflow Rules`：
  - **视觉来源声明**：新增 `visual_direction_source`，来源可为根目录 `DESIGN.md`、既有页面、截图、品牌资产或用户明确方向；缺少来源时必须记录为 `missing`。
  - **视觉色彩与主题**：有来源才定义 `visual_palette` 与 `theme`；缺少来源时标记为 `unknown` / `not_applicable`，并在 `open_questions` 中列出待确认项。
  - **媒体资产策略**：有来源或用户明确要求时才定义 `image_strategy`，描述媒体角色、质感、来源和约束；不绑定具体生成工具。
  - **动效与过渡契约**：有来源、页面类型需要或用户明确要求时才使用 `motion_contract` 规范页面过渡动效与微交互动效节奏；否则标记为 `not_applicable`。
  - **审美流派对齐**：有来源才通过 `aesthetic_genre` 记录视觉方向标签；不得把内部 skill 名称或主观偏好当作默认流派。
  - **设计等级预设 (`design_tiers`)**：引入两档层级，`Standard` 适用于简单管理界面，覆盖布局、信息层级、操作区、表单宽度、响应式和继承/基础主题 token；`Rich` 适用于复杂营销 Landing Page 或交互式看板，只有在来源支持或用户明确要求时才加入动效、特定视觉流派与详细图像策略。
  - **继承已有设计**：硬性要求如果在根目录发现 `DESIGN.md`，契约中必须通过 `design_contract_source` 进行继承声明。
  - **契约工件输出模式**：将输出工件 `layout_design` 重命名为 `page_design`，输出 schema 包含：`design_contract_source`, `design_constraints`, `visual_direction_source`, `page_type`, `design_tier`, `primary_intent`, `visual_palette`, `theme`, `aesthetic_genre`, `image_strategy`, `reduction_decisions`, `section_map`, `information_regions`, `operation_regions` (包含 `visible_actions`, `hidden_actions`, `icon_semantic_anchors`), `form_stretching_limits`, `motion_contract`, `typography_spacing_rules`, `responsive_rules`, `state_coverage`, `verification_cues`。

### R3. 后置 UI 审计逻辑同步升级 (`imm-ui-review`)
- 修改 [imm-ui-review.md](plugins/immune-brain/dist/imm-ui-review.md)：
  - 强制 reviewers 加载前置的 `page_design` 契约（替代原 `layout_design`）作为审计源头。
  - **向后兼容策略（Clean Break）**：直接将所有 `layout_design` 引用替换为 `page_design`，不保留对旧名称的兼容。理由：`layout_design` 是临时中间工件，不存在持久化存储或跨项目迁移需求；旧项目重新运行 `imm-page-design` 即可生成新契约。
  - 实施"声明式对照审计"原则：不再进行主观美学裁判，而是精确核对契约中声明的参数（如 `theme`、`visual_palette` 是否在 CSS 中体现；`aesthetic_genre` 对应来源支持的方向是否满足；`motion_contract` 声明的过渡是否被实现等），并按严重性分级：影响可访问性、主路径、操作层级、表单宽度或响应式稳定性的偏离为 P1；不阻断使用的视觉、主题、图像策略或流派偏离为 P2；纯 polish 偏差为 P3。

### R4. 启发式检查表更新 (`ux-heuristic-checklist`)
- 更新 [ux-heuristic-checklist.md](docs/reference/ux-heuristic-checklist.md)：
  - 增设对"动效响应"（交互微动效不能有延迟或遮挡关键操作）和"色彩一致性与无障碍对比度"的启发式校验条目。
  - 定义设计等级差异化校验规则：
    - **`Standard` 等级**：校验布局结构一致性、配色对比度达标（WCAG AA）、表单宽度防御、操作按钮分级折叠。
    - **`Rich` 等级**：在 Standard 基础上额外校验 `motion_contract` 声明的动效是否实现、`aesthetic_genre` 流派规范是否满足、`image_strategy` 图像风格是否与契约一致。

### R5. 指南文档与测试套件重构
- 更新以下所有包含 `imm-page-layout-design` 或 `layout_design` 引用的文档：
  - [immune-brain-skills-guide.md](docs/reference/immune-brain-skills-guide.md)：将第 17 节 `imm-page-layout-design` 相关描述修改为 `imm-page-design`，并将职责扩展为来源驱动的页面设计契约，包含结构、主题、动效与媒体策略。
  - [README.md](README.md)：更新技能表格中的 `imm-page-layout-design` 行及 `layout_design` 工件名。
  - [docs/user_manual.md](docs/user_manual.md)：更新技能表格与描述文本中的旧名称。
  - [docs/solutions/contracts.md](docs/solutions/contracts.md)：更新工件所有权表中的 `layout_design` -> `page_design`。
  - [docs/reference/immune-brain-skill-details/README.md](docs/reference/immune-brain-skill-details/README.md)：更新技能条目。
- **历史文件保护**：以下历史 spec/plan 引用了旧名称 `imm-page-layout-design`，属于只读归档，**禁止修改**：
  - `docs/specs/imm-page-layout-design-contract-alignment.spec.md`
  - `docs/specs/imm-page-layout-design-enhancement.spec.md`
  - `docs/plans/2026-06-08-003-fix-imm-page-layout-design-contract-alignment-plan.md`
  - `docs/plans/2026-06-09-002-feat-imm-page-layout-design-enhancement-plan.md`
- 修改 `test_skill_contracts.py`：
  - 重命名并重写 `test_imm_page_layout_design_defines_pre_implementation_layout_contract` 为 `test_imm_page_design_defines_pre_implementation_design_contract`。
  - 检查并断言 `imm-page-design` 和 `imm-ui-review` 规范中必须含有 `page_design` 替代原 `layout_design` 的各项断言（如 `visual_palette`, `motion_contract`, `design_tier`, `aesthetic_genre`, `image_strategy` 等）。
  - 更新对技能文件名存在性的断言。
  - 更新 `test_imm_ui_review_contract_enforces_layout_design_constraints` 为对 `page_design` 契约的对照校验。

## 4. Acceptance Criteria

- 所有技能文件命名从 `imm-page-layout-design` 顺利切换为 `imm-page-design`，不留任何悬空的 layout 文件。
- 重构后的 `test_skill_contracts.py` 单元测试全部通过。
- 校验 [ux-heuristic-checklist.md](docs/reference/ux-heuristic-checklist.md) 中存在关于动效与配色的一致性检查条目，且区分 Standard/Rich 等级。
- `page_design` 输出 schema 包含 `image_strategy` 字段。
- `README.md`、`docs/user_manual.md`、`docs/solutions/contracts.md`、`docs/reference/immune-brain-skill-details/README.md` 中无 `imm-page-layout-design` 或 `layout_design` 残留。
- 历史 spec/plan 文件（4 个）保持原样不被修改。
