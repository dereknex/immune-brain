> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: skill baseline follow-up contract regressions

**任务 ID**: IMM-SKILL-037
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复最近一轮 skill baseline / slimming 改动后留下的 review follow-up contract regressions，并补上 focused regression coverage，确保：

- reviewer follow-up artifact 能继续表达 `append_to_plan`
- `imm-work` 的 reviewer 冲突仲裁顺序与 planner fallback 规则保持 shared truth
- 所有基线化 skill 的 `BASELINE.md` 引用路径可正确解析
- `tests/test_skill_contracts.py` 直接守住上述 contract，避免再次靠人工 review 才发现漂移

本轮只收敛 review 已经定位出的 contract regressions 与 focused guard coverage，不扩展到新的 workflow 设计、runtime 机制或更大范围的 README/solution 重写。

## 2. 问题背景

`imm-code-review` 对当前未提交变更做 cross-step 审查后，识别出三条会改变下一步决策的高信号问题：

- `imm-code-review` / `imm-ui-review` 的 narrative contract 已引入 `append_to_plan`，但输出 artifact 仍把 `recommended_route` 限制成 `direct_fix | new_slice | defer`
- `imm-work` 把多 reviewer 冲突仲裁顺序从 shared truth 的 `security > performance > compatibility > readability` 收窄成了不含 `security` 的版本，并丢掉“仍无法收敛时回到 planner”的约束
- 基线引用统一改成 `../skills/BASELINE.md` 后，所有 skill 内的 baseline 链接都指向了不存在的路径

现有 runtime state 不再保留任何正在进行的旧 plan，且这组问题跨越多个 skill 与 focused test，因此不能安全视作历史 completed plan 的 `append_to_plan`；需要一个新的 narrow follow-up slice。

## 3. 功能需求

### R1. Reviewer artifact route alignment

- `imm-code-review` 与 `imm-ui-review` 的 output artifact / handoff schema 必须显式允许 `append_to_plan`
- reviewer narrative、artifact schema、以及 planner consumption contract 必须表达同一套 route truth
- 首版只修复当前已暴露的 reviewer family，不扩展到新的 reviewer packet redesign

### R2. `imm-work` arbitration truth restoration

- `imm-work` 必须恢复 shared truth 中的 reviewer 冲突仲裁顺序：`security > performance > compatibility > readability`
- 当冲突仍无法收敛时，skill contract 必须继续要求回到 `imm-planner`，而不是在执行阶段静默决定
- 本轮只修 contract truth，不扩展到新的 reviewer scheduler / runtime engine

### R3. Baseline link repair

- 基线化 skill 中的 `BASELINE.md` 引用必须统一指向可解析的 repo-local路径
- 修复范围覆盖本轮批量改动中受影响的 skill 文档
- 不扩展到 README 外链、site 文档、或 docs 站点导航设计

### R4. Focused regression coverage

- `tests/test_skill_contracts.py` 必须直接断言：
  - reviewer artifact route schema 允许 `append_to_plan`
  - `imm-work` 仍包含 `security > performance > compatibility > readability`
  - `imm-work` 仍要求 unresolved reviewer conflicts 回到 planner
  - skill baseline reference 使用 repo-local 正确路径
- focused verification 继续保持 contract-test 级别，不引入更重的 runtime harness

## 4. 验收标准

- [ ] `imm-code-review` 与 `imm-ui-review` 的 artifact schema 与 narrative contract 对 `append_to_plan` 一致。
- [ ] `imm-work` 明确保留 `security > performance > compatibility > readability` 和 planner fallback。
- [ ] 受影响 skill 的 baseline 链接可直接解析到 `skills/BASELINE.md`。
- [ ] `python3 -m unittest tests.test_skill_contracts` 通过，且新增断言直接覆盖本轮回归面。

## 5. 非目标

- 不重开更大范围的 skill slimming / baseline strategy 讨论。
- 不修改 `imm-work` runtime state 逻辑、scheduler 实现或 subagent orchestration 机制。
- 不扩展到新的 solution 文档沉淀；本轮目标是先把 review follow-up 修平并补齐 focused guards。

## 6. 依赖项

- 依赖最近一次 `imm-code-review` 对当前工作树给出的三条 findings。
- 依赖 [skills/BASELINE.md](skills/BASELINE.md) 继续作为 shared baseline source of truth。
- 依赖 `tests/test_skill_contracts.py` 作为 focused contract regression suite。
