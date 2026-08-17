# Spec: plan/work/review 中段重写

**任务 ID**: IMM-WORKFLOW-001  
**负责人**: Planner  
**状态**: Approved  

## 1. 目标
在保留 `brainstorm -> plan -> work -> review -> compound` 主链路的前提下，重写中段 `plan -> work -> review` 的语义，使每一轮执行都围绕一个单一、可验证的小步展开。

## 2. 功能需求
- **Plan 约束**：
  - 任务必须按可独立闭合结果组织小步，step 数量由结果自然决定。
  - 每个小步只能承诺一个清晰结果。
  - 无法独立验证的小步必须继续拆分，动作型小步必须合并回对应结果。
- **Work 约束**：
  - 执行时一次只允许消费当前小步。
  - 如果发现当前小步过大、边界含混或依赖缺失，必须停止并回退重拆。
- **Review 约束**：
  - QA 必须先判断当前小步是否闭合，再进入细节审查。
  - Review 结果必须区分“返工当前小步”和“回退重拆”。
- **本地实现边界**：
  - 第一版不改 `brainstorm`。
  - 第一版不改 `compound`。
  - 第一版不直接修改上游 `compound-engineering` 安装目录。

## 3. 验收标准 (QA Points)
- [ ] 治理文档、角色 Skill 与本 Spec 对 `plan -> work -> review` 的定义一致。
- [ ] 系统明确要求小步执行，而不是宽泛阶段性推进。
- [ ] QA 流程明确支持“通过 / 返工当前小步 / 回退重拆”三种结论。
- [ ] 第一版边界中明确排除了 `brainstorm`、`compound` 和上游安装目录改写。

## 4. 依赖项
- 依赖于 `docs/brainstorms/immune-brain-requirements.md` 中确认的范围与成功标准。
