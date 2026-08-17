# addyosmani/agent-skills ↔ Immune-Brain 对照清单

本地 submodule：`upstreams/addy-agent-skills`（[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)）。本文供团队内部对齐语义与权威来源，避免三套文档重复维护。

## Submodule 维护策略（与 U1/README 一致）

- 首次检出：`git submodule update --init upstreams/addy-agent-skills`
- 跟进上游默认分支：`git submodule update --remote upstreams/addy-agent-skills`（需在 superproject 中提交指针变更若要保持团队一致）
- 确定性摘要：`python3 .imm/imm-upstream-sync.py`（基于本地 git/submodule 状态；无远程调用）
- 原则：`upstreams/` 内不做长期本地魔改；借鉴以链接相对路径为主

## Skill 清单映射（生命周期维度）

| addy 分区 | addy skill（示例） | Immune-Brain 就近映射 | 备注 |
|-----------|-------------------|----------------------|------|
| Meta | `using-agent-skills` | `imm-work` 路由 + `skills/BASELINE.md` | 不设独立 meta skill；路由表在 README |
| Define | `idea-refine` | `imm-brainstorm` | IB 只 framing，不默认写 spec |
| Define | `spec-driven-development` | `imm-planner` + `.imm/specs/` | 规格在仓库内由 planner 产物承载 |
| Plan | `planning-and-task-breakdown` | `imm-planner` | outcome step 粒度见 planner skill |
| Build | `incremental-implementation` | `imm-executor` + `imm-work` | active step 锁 |
| Build | `test-driven-development` | CE `test-driven-development` / `imm-executor` 步内 | 测试策略权威多在 CE 与本仓库 reviewer |
| Build | `context-engineering` | `BASELINE` delegation packet + rules | 结构可借鉴，不单拆 skill |
| Build | `source-driven-development` | user rules + `documentation-lookup` / ctx7 | IB 通过工具链而非专用 skill |
| Build | `doubt-driven-development` | `imm-brainstorm`（`roundtable`/`adversarial` modes）+ CE adversarial reviewers | 高 stakes 走会诊或专门 reviewer |
| Build | `frontend-ui-engineering` | `frontend-design` / `imm-ui-review` | 宿主在不同 skill 目录 |
| Build | `api-and-interface-design` | `api-design-principles` / `api-contract-reviewer` | CE 侧 slice |
| Verify | `browser-testing-with-devtools` | CE web-perf / browser MCP | 能力在工具与 CE |
| Verify | `debugging-and-error-recovery` | `imm-advisory-reviewer`（`debug_hypothesis` lens） | CE standalone |
| Review | `code-review-and-quality` | `imm-code-review` | IB 编排 + CE personas |
| Review | `code-simplification` | `ce-simplify-code` | CE |
| Review | `security-and-hardening` | `security-reviewer` | CE conditional |
| Review | `performance-optimization` | `ce-optimize` / `performance-oracle` | CE |
| Ship | `git-workflow-and-versioning` | `ce-commit` / `imm-pr-fix` | 部分在 CE |
| Ship | `ci-cd-and-automation` | `github-actions-templates` | CE |
| Ship | `deprecation-and-migration` | （无单一 imm-*） | 需要时 planner 专项 |
| Ship | `documentation-and-adrs` | `imm-advisory-reviewer` (`docs` lens) / `imm-compounder` | 分流文档 vs 沉淀 |
| Ship | `shipping-and-launch` | `imm-advisory-reviewer` (`release_readiness` lens) | CE |

## 重叠矩阵（主题 × 权威来源）

| 主题 | 主权威（优先阅读） | addy 角色 | 说明 |
|------|-------------------|-----------|------|
| 单仓库 plan/work/QA 闭环 | `IMMUNE.md` + `imm-work` / `imm-qa` | 无等价 orchestration | addy 为通用 skill 包，无 `.imm` |
| Outcome step 规划 | `skills/imm-planner/SKILL.md` | `planning-and-task-breakdown` | 对齐「少步可验收」时用 IB |
| TDD / 测试金字塔 | `upstreams/compound-engineering` skills | `test-driven-development` | 重复时引用 CE 或 addy 其一，勿双写全文 |
| Code review 五轴 / 变更体量 | CE `ce-code-review` personas | `code-review-and-quality` | IB 用 `imm-code-review` 收口 |
| API 契约 / Hyrum | CE `api-contract-reviewer` | `api-and-interface-design` | 高风险 API 走 CE reviewer |
| 安全 OWASP | CE `security-reviewer` | `security-and-hardening` | checklist 可链到 `upstreams/addy-agent-skills/references/security-checklist.md` |
| CI/CD 闸门 | CE `github-actions-templates` 等 | `ci-cd-and-automation` | 工程化以 CE 与本仓库 CI 为准 |
| SKILL 解剖（反借口 / 红旗 / 验证） | `skills/BASELINE.md`（本计划增强后） | addy README「How Skills Work」 | IB 吸收**结构**，不复制 22 篇全文 |

## 借鉴分类

| 类别 | 做什么 | 示例 |
|------|--------|------|
| **只借鉴结构** | Rationalizations / Red Flags / Verification 三节；references 渐进披露 | hub `imm-*` 与 `BASELINE` |
| **摘录或链接** | checklist、Google SWE 概念单次引用 | `docs/reference/agent-quality-checklists.md` 链到 submodule `references/*.md` |
| **不引入** | 整套 `/spec` `/plan` slash 命令树；替换 `imm-*` 编排 | 与 Immune-Brain 职责冲突 |
| **可选专题** | `context-engineering`、`deprecation-and-migration` | 若团队痛点出现再 planner 单独立项 |

## 参考路径（ submodule 内）

- Skill 索引：`upstreams/addy-agent-skills/README.md`
- 参考 checklist：`upstreams/addy-agent-skills/references/`
- 技能解剖说明：同上 README「How Skills Work」

## Related upstream contrasts

- [mattpocock/skills ↔ Immune-Brain](mattpocock-skills-contrast.md)（[mattpocock/skills](https://github.com/mattpocock/skills) submodule：`upstreams/mattpocock-skills`）
