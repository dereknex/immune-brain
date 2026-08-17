# Spec: PR hygiene after 049 + code review follow-up

**任务 ID**: IMM-PR-HYGIENE-049  
**负责人**: Planner  
**状态**: Draft

## 1. 目标

闭合 `imm-code-review` 对 049 交付提出的 **库存与格式** 问题：规划产物入库、`current_iteration.json` 文本文件结尾规范，且不扩大 scope 到 runtime 策略重设计。

## 2. 范围

- **In**：  
  - 将此前未跟踪的 `049` **spec** 与 **iteration plan** 纳入版本控制（路径以仓库当时为准）。  
  - `.imm/memory/current_iteration.json` **末尾换行**（POSIX text file）。  
- **Out**：  
  - 不改动 `imm-plan` / `imm-work` 语义。  
  - 不要求重置或删减 `current_iteration.json` 业务字段（除非后续单独决策）。

## 3. 验收标准

- [ ] `git status` 中不再出现针对上述 spec 与 plan 路径的 `??`。  
- [ ] `current_iteration.json` 以 newline 结束。  
- [ ] `python3 -m unittest tests.test_skill_contracts` 仍通过。

## 4. 依赖

- `origin_review`：`recommended_route: direct_fix`，scope 见审查摘要。
