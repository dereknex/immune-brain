# Spec: 自动化复盘钩子 (imm-finish)

**任务 ID**: IMM-MOD-C  
**负责人**: Planner  
**状态**: Approved  

## 1. 目标
创建一个统一的指令 `imm-finish`，用于标志任务的正式结束，并自动触发质量审计、知识复盘和上下文脱水。

## 2. 功能需求
- **编排逻辑**：
    1. **触发 QA 提示**：提示用户或 Agent 运行验证。
    2. **触发 Compounder 逻辑**：
        - 自动执行 `git diff` 获取变更。
        - 提示或自动分析变更点，寻找可沉淀的 Pattern。
    3. **更新知识库**：辅助更新 `docs/solutions/` 和 `summary.md`。
    4. **强制脱水**：最后调用 `imm-dehydrate` 固化所有智力产出。
- **交互方式**：支持通过 `python3 .imm/imm-finish.py` 调用。

## 3. 验收标准 (QA Points)
- [ ] 运行 `imm-finish` 后，系统应引导完成知识提取流程。
- [ ] 最终必须生成（或提示生成）至少一个 Pattern 文档（或确认无新模式）。
- [ ] `summary.md` 的任务摘要与知识索引入口应得到更新。
- [ ] 状态快照 `state.json` 必须在最后被更新。

## 4. 依赖项
- 依赖于现有的 `imm-dehydrate.py`。
- 依赖于 Git 环境（用于获取变更差异）。
