# mattpocock/skills ↔ Immune-Brain 对照清单

本地 submodule：`upstreams/mattpocock-skills`（[mattpocock/skills](https://github.com/mattpocock/skills)）。本文供团队内部对齐语义与权威来源，避免三套文档重复维护。

## Submodule 维护策略（与其他 upstreams 一致）

- 首次检出：`git submodule update --init upstreams/mattpocock-skills`
- 跟进上游默认分支：`git submodule update --remote upstreams/mattpocock-skills`（需在 superproject 中提交指针变更若要保持团队一致）
- 确定性摘要：`python3 .imm/imm-upstream-sync.py`（基于本地 git/submodule 状态；无远程调用）
- 原则：`upstreams/` 内不做长期本地魔改；借鉴以链接相对路径为主

## Related upstream contrasts

- [addyosmani/agent-skills ↔ Immune-Brain](addy-agent-skills-contrast.md)（[addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) submodule：`upstreams/addy-agent-skills`）

## 设计哲学对比

| 维度 | mattpocock/skills | Immune-Brain |
|------|-------------------|--------------|
| 架构模型 | 松耦合、小而可组合的独立 skill | 权限分离的多角色闭环 workflow |
| 权限边界 | 无显式 authority separation | 严格 allowed/blocked boundary per role |
| 状态管理 | 无持久运行态，skill 间无共享状态 | `.imm/memory/` 持久运行态 + 跨 skill 状态同步 |
| 共享语言 | `CONTEXT.md` 定义项目词汇 | 已借鉴：repo 根 `CONTEXT.md` |
| 输出模式 | 面向人类的自然语言为主 | 结构化 artifact + 自然语言 output style |
| 验证 | `diagnose` 强调 feedback-loop-first | `imm-qa` evidence-based closure + verification type 标注 |

## Skill 清单映射

| pocock bucket | pocock skill | Immune-Brain 就近映射 | 备注 |
|---------------|-------------|----------------------|------|
| engineering | `diagnose` | `imm-qa` verification + `imm-advisory-reviewer`（`debug_hypothesis` lens） | IB 拆验证与调试为不同角色 |
| engineering | `grill-with-docs` | `imm-brainstorm` + `CONTEXT.md` | IB 不设独立 grill skill；brainstorm 阶段吸收 |
| engineering | `tdd` | `imm-executor` TDD Execution Discipline | execution posture 由 planner 标注 |
| engineering | `prototype` | `imm-planner` Prototype Step + `imm-executor` | 已借鉴：throwaway artifact + decision capture |
| engineering | `improve-codebase-architecture` | `imm-code-review` + `ce-architecture-strategist` | 架构改进走 review 或独立规划 |
| engineering | `to-issues` | 不映射 | IB 不做 issue tracker 集成 |
| engineering | `to-prd` | `imm-planner` spec 产出 | spec 在 `.imm/specs/` 而非独立 PRD |
| engineering | `triage` | 不映射 | IB 不做 triage 状态机 |
| engineering | `zoom-out` | `imm-brainstorm` framing | framing 阶段 zoom-out 视角 |
| engineering | `setup-matt-pocock-skills` | 不映射 | IB 用 `install-local.sh` |
| productivity | `caveman` | `imm-work` Preamble | 已借鉴：进度可见的 user-facing update |
| productivity | `grill-me` | `imm-brainstorm`（含 `adversarial` mode） | IB 拆为 framing 和高压 gate |
| productivity | `handoff` | `imm-work` HANDOFF.md | 已借鉴：cross-session handoff document |
| productivity | `write-a-skill` | `create-skill` (Cursor skill) | 不在 IB 本体 |

## 已借鉴模式清单

以下模式已在 `064`/`065`/`066` 迭代中完成集成：

1. **CONTEXT.md 共享词汇** → repo 根 `CONTEXT.md` + brainstorm/planner awareness
2. **Feedback-loop-first (diagnose)** → `Verification type` advisory annotation + QA technical debt flagging
3. **Prototype step (prototype)** → planner `Prototype: true` + executor skip-TDD + decision capture
4. **Fast-track 仪式压缩** → `imm-work` fast-track for ≤2 step plans
5. **Handoff document (handoff)** → `HANDOFF.md` auto-update after QA pass
6. **Rejected decisions (grill-me)** → compounder `rejected: true` tag + brainstorm re-litigation guard
7. **Lightweight ADR** → compounder ADR suggestion with three-criteria gate
8. **Codebase-first questioning (grill-me)** → `imm-brainstorm` Inline Narrowing Challenge now resolves probes via file inspection / `docs/solutions/` / `CONTEXT.md` before surfacing to the user
9. **Serial single-question + recommended answer (grill-me)** → `imm-brainstorm` `adversarial` mode now asks one question at a time with a recommended answer, walking decision-tree dependencies one-by-one

## 明确拒绝的模式

| pocock pattern | 拒绝原因 | Immune-Brain 替代 |
|----------------|---------|-------------------|
| Issue tracker 集成 (to-issues / triage) | 项目管理不是 IMM 的域 | 用户自行管理 issue tracker |
| 内容创作 skills (fragments/beats/shape) | 面向写作场景，不匹配 engineering workflow | 无替代 |
| 松耦合无状态模型 | 无法保证权限分离和跨 step 证据链 | 权限分离 + `.imm/memory/` 持久态 |
