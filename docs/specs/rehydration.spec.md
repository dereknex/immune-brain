# Spec: Rehydration (上下文重构)

**任务 ID**: IMM-MOD-A  
**负责人**: Planner  
**状态**: Approved  

## 1. 目标
实现从 `.imm/memory/state.json` 中自动读取并呈现先前会话状态的功能，使 Agent 能够快速“找回”工作记忆。

## 2. 功能需求
- **读取能力**：脚本必须能够解析 `.imm/memory/state.json`。
- **输出格式**：输出应包含以下核心字段：
    - `最后更新时间`
    - `任务摘要`
    - `待办事项列表`
- **容错处理**：如果状态文件不存在或损坏，应输出明确的警告而非程序崩溃。
- **命令行接口**：支持通过 `imm-rehydrate` (或 `imm-dehydrate.py --rehydrate`) 调用。

## 3. 验收标准 (QA Points)
- [ ] 执行重构指令后，输出内容必须与 `state.json` 中的数据一致。
- [ ] 输出格式应采用易于 Markdown 渲染的结构，方便 Agent 直接作为 Context 引用。
- [ ] 验证在 `state.json` 缺失的情况下，脚本能提示“未发现历史状态，建议开始新任务”。

## 4. 依赖项
- 依赖于现有的 `.imm/memory/state.json` 格式。
