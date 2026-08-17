# Pattern: Upstream skill pack as submodule + hub anatomy hardening

**领域**: Agent workflow / Skill governance / Upstream integration  
**描述**: 将第三方「全生命周期」skill 仓库（例如 addyosmani/agent-skills）挂成 **`upstreams/` submodule**，用 **对照文档** 锁定权威来源，只在 **枢纽 `imm-*`** 上吸收 **Rationalizations / Red Flags / Verification** 结构，避免整包替换 Immune-Brain 编排。

## 场景

- 团队希望对标流行的 agent-skills 包，但不放弃 `.imm`、validated plan 与 `imm-work` 权限链。
- Reviewer 需要 security/testing/a11y 深度清单，又不想把长 checklist 贴进每个 `SKILL.md`。
- 交付已完成但 **spec/plan/reference** 仍为 `git status` 的 `??`，审查与运行时错位。

## 方案模板

1. **Submodule**：`git submodule add <url> upstreams/<short-name>`；README 枚举路径并写明 `submodule update` 与 **`python3 .imm/imm-upstream-sync.py`** 的用途（若仓库已有该脚本）。
2. **对照清单**：在 `docs/reference/` 写 **映射表 + 重叠矩阵**（标明主权威：本仓库 `imm-*` vs `upstreams/compound-engineering` vs 新 submodule），并做 **借鉴三分类**（结构 / 摘录链接 / 不引入）。
3. **枢纽解剖**：在 `skills/BASELINE.md` 声明 **`imm-work`、`imm-executor`、`imm-planner`、`imm-qa`** 必须带三节；Verification 必须引用 **本仓库** CLI 与 `.imm` 路径，禁止只写上游命令。
4. **渐进披露**：新增薄索引页（如 `docs/reference/agent-quality-checklists.md`）链接到 submodule 内 `references/*.md`；`imm-code-review` / `imm-ui-review` 各一行引用索引。
5. **契约锁**：`tests/test_skill_contracts.py` 中断言 BASELINE 与四枢纽的章节标题或固定短语；合并前 **`git add` spec + plan + reference**，必要时走窄 **hygiene** 计划（参见 `post-051-tracked-artifacts` 类 spec）。

## 可复用前提

reusability: high  

next_reuse_scenarios: 接入第二个方法论打包仓库；对比 CE 插件与独立 skill 包的取舍；为 reviewer 增加新的「仅索引、全文在 upstream」类附件。

## 验证依据

- **051** 计划与 `.imm/specs/addy-agent-skills-upstream-and-skill-anatomy.spec.md` 验收项已在仓库内闭合；`python3 -m unittest tests.test_skill_contracts` 扩展后通过。
- **052** 消除 051 相关 `??` 路径并完成 spec §3 `[x]` 对齐（merge hygiene 切片）。

## 约束与建议

- Submodule **只作参考源**：避免在 `upstreams/` 内长期打补丁；需要改动应 fork 或在本仓库 `skills/` 显式 port。
- **路由表**放在 README 一类高流量入口即可，不与 `imm-work` Decision Tree 或 **IMMUNE** 权限条文冲突。
- **运行时Plan切换**：执行 `python3 .imm/imm-plan.py <path>` 会 **sync** `current_iteration.json`；换 Ephemeral 计划时务必对 **当前** plan 重跑，避免 autowork 读到旧 `plan_path`。

---
*沉淀日期: 2026-05-10 | 来源: 051 addy upstream + skill anatomy Epic 与 052 PR hygiene 闭环*
