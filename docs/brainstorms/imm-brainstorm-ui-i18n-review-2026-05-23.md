---
title: UI 审查技能多语言审查能力（i18n Review）评估与脑暴笔记
date: 2026-05-23
scope: imm-ui-review
---

# imm-brainstorm: UI 审查技能（imm-ui-review）多语言审查能力评估

这是针对在 UI/UX 可用性审查器（`imm-ui-review`）中集成多语言与国际化（i18n/L10n）审查能力的脑暴与可行性评估笔记。

## 1. 结论 (Conclusion)
强烈建议在现有 `imm-ui-review` 技能中集成多语言审查（i18n Review）能力。应秉持系统极简设计哲学，通过创建轻量级的 **Progressive Disclosure Lens（渐进式披露透镜）**——`docs/reference/i18n-review-checklist.md`，将其动态挂载到 `imm-ui-review` 中。当变更表面包含多语言特征时自动激活，避免创建全新独立技能导致的系统过度设计和仪式感（ceremony）冗余。

## 2. 范围 (Scope)

### In-Scope (允许且需要实现的目标)
*   **硬编码文本检测 (Hardcoded String Detection)**：对面向用户的界面文件，自动审查是否直接嵌入了硬编码的语言文本（如中英文硬编码），而未采用国际化 key（如 `t('key')`）。
*   **布局换行与字符溢出 (Layout wrapping & overflow)**：审查多语言环境下，因不同语言文本长度差异（例如德文过长，中文过短）导致的界面排版错位、文字截断、换行崩塌。
*   **明暗主题多语言可用性 (L/D Theme & i18n Usability)**：审查在深色（Dark Mode）与浅色（Light Mode）主题切换时，不同语系（如中英文、复杂字符等）文本的对比度（Contrast）合规性，以及包含本地化字符的插图、Banner 资源在不同主题下的可见性与透明度适配。
*   **RTL 镜像布局与对齐 (RTL Alignment & Mirrors)**：对于特定语系（如阿拉伯语、希伯来语）的 RTL 渲染，审查 Flex/Grid 容器是否提供正确的弹性翻转或镜像对齐策略。
*   **基础本地化格式化 (L10n Formatting)**：审查日期、数字、货币等在不同语境下的格式化调用（如 `Intl.NumberFormat`、`Intl.DateTimeFormat`）是否标准。
*   **占位符与动态硬拼接 (Concatenation vs Interpolation)**：拦截在代码中直接拼接翻译段落的违规做法（例如 `"已选择 " + count + " 项"`），必须使用多语言占位符插值。

### Out-of-Scope (本次不考虑/非目标)
*   **深度翻译质量审计 (Deep Semantic Translation Review)**：大段翻译文字的表达专业性与“信达雅”审核不属于 UI/UX 物理排版和翻译合规审查，应交由外部翻译专业子智能体或人工校对。
*   **大型数据库内容多语言清洗 (Database Content L10n)**：非静态资源或非界面代码层的库表多语言数据校验。

## 3. 关键判断 (Critical Decisions)

*   **BR-DEC-001**: **坚决避免技能增殖（No Skill Proliferation）**。不创建如 `imm-i18n-review` 这样的独立技能，而是作为现有的 `imm-ui-review` 技能的**第二透镜（Secondary Lens）**切入，以保持硬边界清晰。
*   **BR-DEC-002**: **变更表面定制触发（Change Surface Tailoring）**。如果修改的代码或配置文件中存在 `locales/`、`i18n` 依赖配置，或代码含有多字节语言硬编码、翻译 key 调用特征，则在 preflight 检查中自动激活 i18n 检查透镜。
*   **BR-DEC-003**: **i18n Specialist 顾问委派（Specialist Dispatch）**。对于含有复杂语系（如阿拉伯语 RTL 交互）的变更，支持通过 `ui_review` 的子智能体机制动态派生只读的 `i18n_specialist` 进行专项排版深度审计。

## 4. 假设与风险 (Assumptions & Risks)

*   **技术常量误判风险**：LLM 在静态代码扫描硬编码文字时，极易将 `console.log`、技术内部 key、API 请求字段、埋点参数误判定为“未翻译的硬编码界面文本”。
    *   *规避策略*：在 `i18n-review-checklist.md` 中内置明确的排除条件规约（如正则忽略特定技术字面量、日志与内部变量名）。
*   **环境受限风险**：在非多语言开发框架的项目中，i18n 审查可能会产生无谓的 preflight 计算消耗。
    *   *规避策略*：建立严密的变更特征检测过滤器，无多语言配置的项目自动降级跳过该透镜。

## 5. Brainstorm Manifest

| 标识 ID | 类型 | 目标项 | 简要描述 / 验证标准 |
| :--- | :--- | :--- | :--- |
| **BR-REQ-001** | Requirement | UI 多语言能力扩展 | 在 `imm-ui-review` 中集成 i18n/L10n 的排版和代码工程合规审查能力。 |
| **BR-REQ-002** | Requirement | 指南索引文件 | 建立 `docs/reference/i18n-review-checklist.md` 作为渐进式披露的规则主源。 |
| **BR-REQ-003** | Requirement | 核心检测规则 | 制定硬编码文本拦截、翻译硬拼接拦截、布局溢出评估、RTL 镜像适配等专项 Heuristics 指标。 |
| **BR-REQ-004** | Requirement | 明暗主题协同校验 | 制定明暗主题切换时多字符集对比度合规性、本地化配图/图标的主题透明度与完整性检查规则。 |
| **BR-DEC-001** | Decision | 渐进式透镜挂载 | 不增设新技能，将多语言审查挂载至现有的 `imm-ui-review` 作为动态 Lens。 |
| **BR-DEC-002** | Decision | 定制触发阈值 | 基于变更表面（如 i18n 配置、多语言资源、特有 API 关键字）智能动态触发。 |
| **BR-OUT-001** | Out-of-Scope | 翻译语义校对 | 大模型大段翻译的纯文本翻译准确性与润色不在本次范围内。 |
| **BR-DEFER-001**| Deferred | 像素级多语言 UI 对比 | 全自动像素级别在不同语言下的视觉渲染回归测试推迟至未来迭代。 |

## 6. 下一步行动 (Next Action)

*   **推荐技能 (Next Skill)**：`imm-planner`
*   **推荐原因**：脑暴分析结论清晰、技术路径（采用与 UX 相同的 Progressive Disclosure Lens 模式）已经过此前成功实践（如 `ux-heuristic-checklist.md` 升级）验证，且无未决的阻断性问题（零 `BR-Q-*`），可直接进入 Spec 定义与 Plan 制定阶段。
*   **用户确认**：否（建议用户回复“同意”后立即由 `imm-planner` 制定具体的两步快速实现计划）。
