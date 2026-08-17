# Spec: Framing Stage Terse Output Contract

**任务 ID**: IMM-WORKFLOW-UX-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标
进一步压缩 `imm-brainstorm` 与 `imm-preplan-review` 的默认回复密度，让 framing 阶段优先交付结论，而不是默认解释推理过程或重复播报工作流边界。

## 2. 需求

### R1. 默认输出再压缩一档
- `imm-brainstorm` 与 `imm-preplan-review` 的默认成功输出应以结论优先。
- 默认不展开长段解释、内部过程说明、重复边界提醒。
- 默认仅保留完成当前 handoff 所需的最短信息。

### R2. 按需展开而不是默认展开
- `Allowed`、`Blocked`、`Workflow guard` 等结构字段仍保留在 contract 中。
- 这些字段在用户可直接继续、且无边界风险时，不应被要求每次都完整外显。
- 只有在阻塞、失败、scope 风险变化、或用户明确要求时，才展开较完整说明。

### R3. 入口阶段口径一致
- `imm-brainstorm` 与 `imm-preplan-review` 应共享相近的 terse 默认风格。
- 简版模板、repo-facing 文档、以及最少必要测试应反映该风格，避免后续回漂到 verbose 默认输出。

## 3. 验收标准
- [ ] `imm-brainstorm` 默认 handoff 可在短格式内完成，不强制附带长解释。
- [ ] `imm-preplan-review` 默认 handoff 可在短格式内完成，不强制附带重复的过程说明。
- [ ] skill contract 仍保留边界字段，但文档明确这些字段不是每轮都要完整外显。
- [ ] 相关模板、README 或测试中至少有一层能守住“默认简短，按需展开”的约束。

## 4. 依赖项
- 依赖 [IMMUNE.md](IMMUNE.md) 的角色边界和 planning gate。
- 依赖 [docs/solutions/default-debug-workflow-output-split.md](docs/solutions/default-debug-workflow-output-split.md) 已沉淀的默认/按需分流模式。
- 依赖现有 `imm-brainstorm`、`imm-preplan-review`、`README.md` 与 `tests/test_skill_contracts.py` 的契约结构。

## 5. 非目标
- 不在本轮统一重写所有 `imm-*` skill 的输出风格。
- 不删除失败、阻塞、debug 场景下的必要解释。
- 不顺带扩大到实现逻辑、运行态、或新的工作流能力设计。
