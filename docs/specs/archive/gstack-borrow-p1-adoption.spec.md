# Spec: gstack borrow P1 adoption

**任务 ID**: IMM-GSTACK-P1-ADOPT-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把 `docs/solutions/gstack-skills-borrow-insights.md` 中已经判定为 P1 的借鉴项，收敛成一组可执行的文档与契约改进：

- 为未来可能出现的 generated Skill artifacts 定义轻量防漂移契约。
- 在 README / reference 层补齐 preferred Skill routing hints，让常见请求能更快落到最小正确 Skill。
- 用 focused contract guard 防止这些 P1 结论回漂成 shared registry、新 memory store、browser daemon 或 untrusted-output runtime 实现。

本 Spec 只承接 P1 docs / contract 增量；P2/P3 的 Accessibility Ref、browser daemon、Canary Token、ONNX classifier 均不进入本轮实现。

## 2. 背景

`docs/solutions/gstack-skills-borrow-insights.md` 已完成对 gstack Skill 体系的分析，并给出明确结论：

- P1: 文档防漂移、证据索引、轻量 Skill routing。
- P2/P3: browser daemon、Accessibility Ref、Canary Token、ONNX classifier 等需要单独 runtime / security 规划。
- Rejected: shared registry、重复 memory plane、根目录 host-specific `CLAUDE.md`。

当前缺口是：P1 结论还停留在 Learning 中，尚未变成用户和后续 agent 能稳定复用的 reference guidance 与 contract guard。

## 3. 功能需求

### R1. Generated Skill artifact contract

- 新增或更新 reference 文档，定义 `GeneratedSkillContract` 的最小字段：
  - `source_template`
  - `generated_output`
  - `baseline_ref`
  - `allowed_tools`
  - `verification`
- 文档必须明确：若未来引入 generated `SKILL.md`，冲突先在 source template 层解决，再 regenerate output。
- 文档必须明确：本轮不新增 template compiler、Bun build、managed copy runtime 或 broad `allowed-tools` 复制策略。

### R2. Preferred Skill routing hints

- 在 README 或 reference 文档中提供一张简明 routing hints 表。
- 表格至少覆盖：
  - 需求不清 -> `imm-brainstorm`
  - 范围清晰且需要 Plan -> `imm-planner`
  - 已有 validated Plan 后继续执行 -> `imm-work`
  - 技术审查 / PR 风险 -> `imm-code-review`
  - UI / UX / 可访问性风险 -> `imm-ui-review`
  - 文档一致性风险 -> `docs-verifier`
  - prompt / Skill contract 风险 -> `prompt-contract-reviewer`
- routing wording 必须保持 host-bound、trigger-only，不引入 shared registry、generic dispatcher 或 LLM-only classifier。

### R3. Learning trace and rejected-boundary guard

- 新 guidance 必须链接回 `docs/solutions/gstack-skills-borrow-insights.md`。
- 新 guidance 必须显式保留以下边界：
  - 不新增 `learnings.jsonl`、SQLite / FTS memory plane。
  - 不新增 shared registry 或 generic dispatcher。
  - 不新增 browser daemon。
  - 不新增 Canary Token 或 ONNX runtime。
- focused verification 必须能检测这些边界没有从 guidance / contract tests 中消失。

## 4. 验收标准

- [ ] 存在一份 P1 adoption guidance，包含 generated Skill artifact 防漂移契约。
- [ ] README / reference 层存在 preferred Skill routing hints，且使用 Immune-Brain 现有 Skill 名称与边界。
- [ ] guidance 明确链接回 gstack borrow Learning，并保留 P2/P3/rejected 非目标。
- [ ] focused contract verification 能证明 P1 guidance、routing hints 和 rejected boundaries 没有漂移。
- [ ] `imm-plan` 对本轮 Plan 的 JSON 校验通过。

## 5. 非目标

- 不实现 template compiler、Bun build、daemon、browser CLI、Canary Token、ONNX classifier、sandbox 或 untrusted-output runtime。
- 不新增 shared registry、generic dispatcher、LLM-only router 或新的 memory authority。
- 不新增根目录 host-specific `CLAUDE.md`。
- 不修改 `Activation Plan` 的 runtime trigger semantics。
- 不把 P2/P3 候选伪装成本轮已交付成果。

## 6. 依赖项

- `docs/solutions/gstack-skills-borrow-insights.md`
- `CONTEXT.md`
- `README.md`
- `docs/reference/immune-brain-skills-guide.md`
- `docs/reference/workflow-and-subagents.md`
- `docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md`
- `docs/solutions/rejected-shared-registry-generic-dispatcher.md`
- `tests/test_skill_contracts.py`
