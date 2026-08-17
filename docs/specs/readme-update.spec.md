# Spec: README.md 全面更新

**任务 ID**: IMM-TASK-001  
**负责人**: Planner  
**状态**: Approved  

## 1. 目标
更新根目录的 `README.md`，使其成为 **Immune-Brain** 系统的正式官方文档，清晰地向用户和 Agent 介绍系统的价值、结构和用法。

## 2. 核心内容
- **项目介绍**：Immune-Brain 的定义与核心哲学。
- **快速开始**：如何进行第一次“脱水”和“重构”。
- **系统架构**：说明 `.imm/` 文件夹的作用。
- **角色说明**：介绍 Brainstorm, Planner, QA, Compounder 的协作流程。
- **工具链文档**：
    - `imm-dehydrate` / `imm-rehydrate`
    - `imm-heal`
    - `imm-finish`
- **上游参考**：记录 compound-engineering, gstack, GSD, BMAD。

## 3. 验收标准 (QA Points)
- [ ] 文档包含清晰的目录结构说明。
- [ ] 所有的命令行示例均能正常运行。
- [ ] 链接（如指向 `.imm/` 的路径）正确无误。

## 4. 依赖项
- 依赖于已完成的设计文档 `docs/brainstorms/immune-brain-requirements.md`。
