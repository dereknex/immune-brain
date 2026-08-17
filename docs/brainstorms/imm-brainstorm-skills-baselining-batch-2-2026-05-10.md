---
date: 2026-05-10
topic: skills-baselining-batch-2
scope: agent-skills-efficiency
---

# Imm-brainstorm: Skills Baselining Batch 2

## Conclusion

Batch 1 已成功完成 7 个核心技能的基线化，效果显著（减重约 60%）。Batch 2 应覆盖剩余的 15 个技能，重点攻克高 token 占用的 `imm-ui-review`, `imm-code-review`, `imm-pr-fix` 和 `imm-autowork`，并对 Reviewer 系列进行标准化。

## In Scope

- 基线化 4 个大型 Orchestrators: `imm-ui-review`, `imm-code-review`, `imm-pr-fix`, `imm-autowork`。
- 基elining 10 个 Reviewers/Specialized skills: `prompt-contract-reviewer`, `ai-eval-planner`, `docs-verifier`, `debug-investigator`, `release-readiness-checker`, `reliability-reviewer`, `data-integrity-reviewer`, `security-reviewer`, `api-contract-reviewer`, `imm-compounder`, `imm-init`。
- 确保所有技能引用 `skills/BASELINE.md`。
- 更新 contract tests 以覆盖这些技能的新基线断言。

## Out of Scope

- 修改 `skills/BASELINE.md` 的核心逻辑（除非在 refactor 过程中发现重大缺失）。
- 引入新的技能或改变技能的功能边界。

## Key Conclusions

- **大型技能减重潜力巨大**：`imm-ui-review` (11KB) 包含大量的 UI/UX 检查 checklist，适合移入基线或独立的 `UI_CHECKLIST.md`，但在本轮中先尝试合并入通用基线引用。
- **Reviewers 的模式化**：所有 Reviewer 技能（`*-reviewer`）基本遵循相同的“输入分析 -> 风险识别 -> 下一步建议”模式，可以进一步收敛。

## Recommended Next Skill

- Recommended next skill: `imm-planner`
- Reason: 任务目标明确，可直接进入分解步骤。

## Workflow Guard

任何后续涉及 `SKILL.md` 修改、基线文件引用或 contract 变更的动作，必须经过 `imm-planner` 产出 validated plan。
