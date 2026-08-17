# Pattern: Iteration plan Result markers and planner artifact hygiene

**领域**: Agent workflow / Plan authoring / Repo hygiene  
**描述**: `imm-plan` 校验器把若干标点当作「一个 step 承诺多个结果」的信号；另外 planner 产出的 spec/plan 若未入库会与已改 SKILL 审查不对齐。

## 场景

- Planner 写的 `Result` 含英文 ` and `、逗号、分号或中文顿号等，校验报错 *appears to promise multiple results*，反复改措辞才能通过。
- Code review 发现 `.imm/specs/*.spec.md` 或 `docs/plans/*.md` 仍为 `git status` 的 `??`，与已合并的契约变更无法对照。
- `.imm/memory/current_iteration.json` 末尾缺少换行，diff 工具或 POSIX text-file 检查报错。

## 方案模板

1. **Result 单行单 outcome**：用名词短语或「X versus Y」这类不含禁用分隔符的句式；需要并列时用 **plus** 或拆成两句放进 `Verification`。
2. **对照源码**：`.imm/imm-plan.py` 中 `MULTI_RESULT_MARKERS` 为当前禁用列表真源。
3. **PR 完整性**：在同一 PR 内 `git add` 本轮 **spec + iteration plan**，再提交 SKILL/README 变更，避免审查断层。
4. **Runtime JSON**：对跟踪的 `current_iteration.json` 保持 **末尾 `\n`**；语义字段是否提交由团队策略决定，但文本文件结尾应一致。

## 可复用前提

reusability: high  

next_reuse_scenarios: 新建 `docs/plans/*` 校验失败排错；imm-planner 产出后的 git 清理；CI 或 editor 启用 newline-at-EOF 规则时对齐 runtime 文件。

## 验证依据

- `049` / `050` 计划中通过改写 `Result` 去掉 ` and `、`,` 等后 `python3 .imm/imm-plan.py <plan> --json` 成功。
- `050` hygiene：`git add` 消除 `??`；`tail -c1 .imm/memory/current_iteration.json | od` 显示 `0a`。
- `052` hygiene：051 相关 spec/plan/`docs/reference/` 由 **`git add`** 入库；spec §3 checklist 与交付现状对齐。

## 约束与建议

- 禁用标记过滤的是 **字面 substring**，不是 NLP；不要用「语义上只有一个结果」说服校验器。
- `record-execution` 仍要求至少一个 `--changed-files`；纯验证 step 需要诚实列出被验证或顺带 staged 的路径。
- 已完成的历史计划若要跟 PR，优先 **new_slice** 跟进 hygiene，而不是假设仍可 `append_to_plan`。

---
*沉淀日期: 2026-05-10 | 来源: 049 规划粒度交付 + 050 PR hygiene + imm-plan 校验实践*
