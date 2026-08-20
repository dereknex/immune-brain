# Pattern: Layered Subagent Governance Contract

**领域**: Agent workflow / multi-agent governance
**描述**: 当系统要引入 system-level subagents 时，先把 authority role、辅助 roster 和运行时非目标拆开，再用同一套 docs-first manifest contract 约束核心层、条件风险层和项目专用层。不要一开始复制上游的大型 agent roster，也不要让 advisory 结论静默升级成 scope、plan、execution 或 QA authority。

**reusability**: high
**next_reuse_scenarios**: [`Immune-Brain` 这类已有 planner/executor/QA 闭环的系统准备接入 subagents, 需要从上游 agent roster 借鉴模式但不想复制整套角色, 想先做 docs-first subagent governance 而不是 runtime dispatcher]

## 场景

- 系统已经有明确的 `brainstorm -> preplan -> plan -> work -> review -> compound` 闭环。
- 上游项目提供了大量 reviewer / worker / party / verifier 角色，但本地系统不希望被大 roster 和新运行时层拖垮。
- 团队想引入 subagents 来补强研究、review 或 step-scoped execution，却又不想破坏现有 authority boundary。
- 需求更像“先定义治理契约”，而不是立刻实现自动调度平台、agent-to-agent 通信或长期 subagent state。

## 方案模板

1. **先分开三类东西**: 明确 `imm-party` 这类只读会诊层、system subagents 辅助层、以及真正拥有决策权的 `imm-*` authority roles 不是一回事。
2. **先定 authority class，再定 roster**: 首版先限制为 `advisory`、`planning-artifact-writer`、`active-step-bounded-executor`、`review-evidence-producer` 四类，避免角色语义漂移。
3. **用同一套 manifest contract 约束三层**: 至少写清 `trigger`、`invocation_stage`、`authority_class`、`tools_allowed`、`write_boundary`、`input_schema`、`output_schema` 和 `failure_mode`。
4. **核心层完整列出 contract**: 默认闭环层的每个 subagent 都要逐个写出 purpose、trigger、stage、authority、write boundary 和 output contract。
5. **条件风险层只保留跨项目高复用 reviewer**: 像 security、data-integrity、API-contract、reliability 这类由 diff 风险面触发的 reviewer 才留在这一层。
6. **项目专用层只保留最小首版集合**: 像 release readiness、prompt contract、AI eval、docs verification、debug investigation 这类更依赖项目类型或交付方式的 agent，应单列为 project-specific，并写清 fallback。
7. **把 runtime 明确列为 non-goals**: docs-first 首版应显式排除自动调度平台、runtime registry、agent-to-agent 通信和长期 subagent memory。

## 可复用前提

- 系统已有明确的 authority role，不需要再发明一条平行执行链。
- 团队当前目标是治理清晰和文档可解释性，而不是马上把 subagent runtime 跑起来。
- 上游模式可作为借鉴对象，但不应自动成为本地默认 roster。
- 条件风险层和项目专用层的启用成本需要被控制，否则流程会被默认专家阵容拖慢。

## 验证依据

- [README.md](README.md) 现已区分 `imm-party`、system subagents 和 `imm-*` authority roles，并把首版 authority class 限定为四类。
- [README.md](README.md) 现已为核心 subagents 给出 manifest-style contract，并声明同一套 contract 适用于条件风险层和项目专用层。
- [README.md](README.md) 现已把条件风险层与项目专用层拆开，给出 project-specific triggers 与 fallback。
- [.imm/specs/system-subagents-design.spec.md](docs/specs/archive/system-subagents-design.spec.md) 现已补齐 borrowed-versus-rejected upstream rationale、manifest minimum fields、layer boundaries 和 non-goals。
- [docs/plans/2026-05-07-009-feat-system-subagents-design-plan.md](docs/plans/2026-05-07-009-feat-system-subagents-design-plan.md) 的 U1-U4 已全部 pass，分别闭环 authority/routing、manifest contract、layer boundary 和 README/spec/validator 对齐。
- `imm-plan docs/plans/2026-05-07-009-feat-system-subagents-design-plan.md --json` 已通过，证明这套治理收敛可以被当前 planning contract 接受。

## 约束与建议

- 不要先列一堆 agent 名字再回头补权限边界；顺序反了会把 roster 变成事实 authority。
- 不要把 project-specific agent 塞回条件风险层，只因为它们“也像 reviewer”；关键区别在于触发来源是项目类型/交付方式，还是 diff 风险面。
- 不要为了 manifest 字段提前实现 runtime registry；首版文档契约只要稳定可解析即可。
- 不要让 advisory 输出直接变成 plan rewrite、code edit 或 QA `pass`；任何 authority 升级都必须回到对应 `imm-*` role。
- 如果需要更多角色，先证明触发条件、fallback 和 evidence path，而不是先扩大默认 roster。

---
*沉淀日期: 2026-05-09 | 来源: system subagents governance contract plan U1-U4 全步骤验收*
