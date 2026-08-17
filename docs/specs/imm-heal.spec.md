# Spec: 基础自愈扫描器 (imm-heal)

**任务 ID**: IMM-MOD-B  
**负责人**: Planner  
**状态**: Approved  

## 1. 目标
创建一个名为 `imm-heal` 的工具，用于自动检测当前工作空间是否符合 **Immune-Brain** 系统宪法 (`IMMUNE.md`) 的基本物理约束。

## 2. 功能需求
- **核心检查项 (Core Checks)**：
    - **目录完整性**：验证 `.imm/memory/`, `skills/`, `.imm/specs/`, `docs/solutions/` 是否存在。
    - **核心文件检查**：验证 `IMMUNE.md` 和 `.imm/memory/MEMORY.md` 是否存在。
    - **Skill 完备性**：检查 `skills/` 下是否包含已发布的 `imm-*` skill。
- **输出报告**：
    - 使用直观的符号（✅/❌）显示检查结果。
    - 对于缺失项，提供明确的修复建议（如：`mkdir -p ...`）。
- **命令行接口**：支持通过 `python3 .imm/imm-heal.py` 调用。

## 3. 验收标准 (QA Points)
- [ ] 运行脚本后，能准确识别缺失的目录或文件。
- [ ] 报告应包含一个“系统健康分数”或简单的状态总结。
- [ ] 当所有约束都满足时，应显示“系统运行良好，符合宪法约束”。

## 4. 依赖项
- 依赖于 `IMMUNE.md` 中定义的目录结构规范。
