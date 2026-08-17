# Spec: track 051 durable artifacts after code review

**任务 ID**: IMM-051-HYGIENE-001  
**负责人**: Planner  
**状态**: Draft

## 1. 目标

- 消除 **`imm-code-review`** 指出的 **051 Epic 未跟踪文件**，使 spec、迭代计划、`docs/reference/` 对照与索引在版本库中可追溯。
- 保持范围在 **PR 卫生 / 入库**，不重做 051 功能实现。

## 2. 功能需求

### 2.1 必须纳入版本控制的文件

- `.imm/specs/addy-agent-skills-upstream-and-skill-anatomy.spec.md`
- `docs/plans/2026-05-10-051-feat-addy-upstream-skill-anatomy-plan.md`
- `docs/reference/addy-agent-skills-contrast.md`
- `docs/reference/agent-quality-checklists.md`

### 2.2 条件纳入

- `docs/solutions/iteration-plan-result-markers-and-repo-hygiene.md`：若内容与 049/050/051 卫生或 imm-plan Result 标记相关且作者意图一并交付，则与本步一并 `git add`；否则留在工作区由后续切片处理。

### 2.3 Spec 一致性

- `.imm/specs/addy-agent-skills-upstream-and-skill-anatomy.spec.md` 中 §3 验收 checklist 与仓库现状一致（已满足的条目标为 `[x]`）。

## 3. 验收标准

- [ ] `git status` 不再对上述路径显示 `??`。
- [ ] `python3 -m unittest tests.test_skill_contracts` 通过。
- [ ] `python3 .imm/imm-plan.py docs/plans/2026-05-10-052-fix-051-tracked-artifacts-plan.md --json` 通过。

## 4. 非目标

- 不拆分或重写已完成的 049/050/051 实现逻辑。
- 不强制提交 `.imm/memory/` 的运行态噪声；若需提交由执行者与「当前迭代闭合」叙事一致后单独判断（本 spec 不列为硬性验收）。

## 5. 依赖

- **Origin review**: `imm-code-review` direct_fix（051 `??` 文件）。
- 前置：051 逻辑改动已在工作区存在。
