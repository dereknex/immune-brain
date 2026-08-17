# Pattern: Executable Subagent Dispatch Protocol via Shared Reference

**领域**: Agent workflow / subagent runtime / cross-host delegation
**描述**: 当 subagent 治理契约（authority class、trigger surface、delegation packet、fallback reason）已经完备但所有 delegation 仍停留在原则描述时，通过一份共享 dispatch protocol reference 文档统一 6 阶段生命周期（环境检测 → 触发判断 → prompt 构建 → 平台调用 → 结果合并 → 异常处理），并让各 host skill 只内联自己的 role-specific delta，而不是重复完整逻辑。

**reusability**: high
**next_reuse_scenarios**: [`新增 host skill 需要 dispatch 能力时引用同一份 protocol`, `第二波 reviewer 进入 runtime 时只需在 host 的 dispatch section 添加 child trigger`, `迁移到新 runtime (Codex/其他) 时只改 protocol Phase 4 的 platform dispatch 段`, `跨项目复用 Immune-Brain 时 protocol 可直接搬运`]

## 场景

- 仓库已有完整的 subagent 三层模型、manifest contract、layered delegation packet 和标准化 fallback reason。
- 9 个 reviewer 全部有独立 SKILL.md 和 Required inputs 契约。
- 但没有任何 host skill 包含可执行的 dispatch 指令——agent 拿到 skill 后不知道用什么工具调用、怎么构建 prompt、怎么收结果、怎么处理失败。
- 需要让 dispatch 从"应该怎么做"的原则层进入"agent 直接执行"的 runtime 层。

## 方案模板

1. **共享 protocol reference 而非内联重复**: 创建 `docs/reference/subagent-dispatch-protocol.md` 作为所有 host 的 single source of truth，每个 host 只写自己的 role-specific dispatch section 并引用 protocol。
2. **6 阶段生命周期**: Environment Detection → Trigger Matching → Delegation Prompt Construction → Platform Dispatch Invocation → Result Collection & Synthesis → Exception Handling。每个阶段有明确的输入、输出和决策路径。
3. **Provider-agnostic 设计**: 同一份 protocol 覆盖 Cursor（Task tool）和 Codex（spawn_agent），通过 Phase 4 的平台分支区分具体调用方式。
4. **Host 内联 role delta**: 各 host 的 Dispatch Protocol section 只写自己的 children list、trigger surfaces、maximum concurrency、synthesis strategy 等差异，其余引用共享 protocol。
5. **统一异常处理**: retry 1x → solo fallback → standard reason code（`unavailable_environment` / `trigger_not_hit` / `unclear_boundary` / `cost_scope_mismatch` / `dispatch_failed` / `child_timeout`）。冲突仲裁 `security > performance > compatibility > readability`。
6. **Contract test 锁住 dispatch wording**: 每个 host 和 protocol doc 的关键 wording 被 focused regression 守住，防止 dispatch 指令在后续 skill refactor 中漂移。

## 可复用前提

- 仓库已有 subagent governance（authority class、manifest、trigger surface）和 delegation packet（shared_context_summary + focus_delta）模式。
- Child reviewer 已定义 Required inputs 和标准 Output artifact 格式。
- 目标 runtime 支持至少一种 subagent dispatch 原语（Cursor Task tool / Codex spawn_agent / 等价物）。
- Host skill 已有 advisory-only boundary 和 fallback reason 枚举。

## 验证依据

- `docs/reference/subagent-dispatch-protocol.md` 包含完整 6 阶段 protocol。
- `skills/imm-code-review/SKILL.md`、`skills/imm-party/SKILL.md`、`skills/imm-ui-review/SKILL.md` 各有 `## Dispatch Protocol` 段引用共享 protocol。
- `tests/test_skill_contracts.py::DispatchProtocolTests`（5 条断言）锁住 protocol doc 存在性、6 阶段覆盖、三个 host 的 dispatch section、以及共享异常标准引用。
- 真实 runtime dispatch：Cursor Task tool 成功 dispatch `security-reviewer` 作为 `generalPurpose` subagent（`readonly: true`），child 返回标准 `security_review` 格式输出（result: pass, 6 findings），parent 成功收集并解析结果。

## 约束与建议

- 不要把 protocol 升级成代码库或 runtime registry；它是 agent 可读的 reference doc，不是程序化 dispatch engine。
- 新增 host 时引用同一份 protocol 并只添加 role delta，不要 fork 出独立版本。
- 新增 child reviewer 时只在 host 的 Phase 2 trigger matching 段添加条目，protocol 本身不需要改动。
- 如果需要支持新 runtime（非 Cursor、非 Codex），只改 protocol Phase 4 的 platform dispatch 段，其余阶段保持不变。
- `readonly: true` 是 child 安全性的主要 enforcement；prompt-level boundary 是 defense-in-depth，不是唯一保障。

---
*沉淀日期: 2026-05-11 | 来源: first-wave-subagent-runtime-dispatch U1-U3 全步骤验收 + real Cursor dispatch evidence*
