# 🎭 Immune-Brain Skill Details

此目录预留为 **Immune-Brain** 各技能深度实施细则与专项参考资料存放区。

## 📖 核心文档导航

如需完整浏览当前系统内置的 **24个核心技能** 的详细职责、实现原理、工作流协作决策和边界红线，请直接阅读我们在同级目录下整理的独立说明文档：

👉 **[Immune-Brain Skills 架构与全景使用指南 (docs/reference/immune-brain-skills-guide.md)](../immune-brain-skills-guide.md)**

## 当前专项入口

- `imm-planner`（`page_design` mode）: 页面生成或重排前产出 `page_design`，先收敛页面结构、操作区和响应式；有设计来源或用户明确要求时才定义视觉字段，缺少来源时标记为 `unknown` / `not_applicable`。

---
*注：未来如果有特定技能（例如 `imm-advisory-reviewer` 的 lens 新增细则或自定义 `ui-review` check sheet）需要编写独立的子说明文件，应统一放置于本目录下。*
