---
date: 2026-05-10
topic: skills-subagents-cost-analysis
scope: agent-skills-efficiency
---

# Skills & Subagents Cost Analysis

## Conclusion

目前 skills 的实现存在显著的 context overhead（全量 skills 总计约 146KB），主要由于各 `SKILL.md` 包含大量重复的 SOP（标准作业程序）描述、边界说明和输出话术。Subagents 虽然通过 `invoke_agent` 实现了上下文压缩，但在 delegation packet 的标准化和 context sharding 上仍有提升空间。

推荐方案：全面推行 `Runtime Payload vs Outer Contract Split` 模式，将共享的 `Workflow guard`、`Authority boundary` 和 `Output Style` 抽离到基线文件，使 `SKILL.md` 演变为“增量角色描述（Role Delta）”。

## In Scope

- 分析现有 skills 的 token/context 开销。
- 比较 `imm-*` 核心 skills 的冗余模式。
- 基于 `impeccable` / `BMAD` 原理提出改进意见。
- 建议 `skills` 结构的扁平化与基线化。
- 完善 `subagents` 的 delegation packet 契约。

## Out of Scope

- 具体的代码实现或重构执行。
- 修改底层 `invoke_agent` 工具逻辑。
- 引入新的 RAG 或向量检索机制（保持简单基线引用）。

## Key Conclusions

- **Skill 冗余度极高**：`imm-work` (14KB), `imm-planner` (10KB) 等核心 skill 重复解释了大量的 Workflow 状态机逻辑。
- **基线化不足**：虽然已有 `Runtime Payload vs Outer Contract Split` 模式，但目前仅在 `imm-party` 试点，未推广至核心技能。
- **Vocabulary 缺失**：核心概念（如 `surgical changes`, `outcome-based steps`）在各处重复定义，而非引用统一的“词汇表层”。
- **Delegation 颗粒度**：Subagent 激活时若携带过多不相关的技能描述，会造成双倍 Context 浪费。

## Recommended Improvements

1.  **建立 `skills/BASELINE.md` (或强化 `README.md`)**：
    - 将 `Allowed / Blocked / Workflow guard` 的通用部分收口。
    - 各 `SKILL.md` 仅包含 `Role Specific Rules` 和 `Delta Boundary`。
2.  **推行“增量式 Skill 激活”**：
    - 技能激活后，仅向系统 prompt 注入 Role Delta。
3.  **标准化 Delegation Packet**：
    - 强制使用 `shared_context_summary + focus_delta` 结构进行 subagent 调用，禁止直接透传全量 history。
4.  **Vocabulary Layer**：
    - 在系统宪法 (`IMMUNE.md`) 中固化核心工程术语，消除技能内的冗余解释。

## Assumptions / Risks

- 假设减少技能描述的详尽程度不会导致 agent 在执行时丧失对复杂边界的控制（需配合 `BASELINE.md` 引用）。
- `invoke_agent` 的实现细节可能限制了我们对 delegation packet 的控制程度。

## Next Action

- Recommended next skill: `imm-preplan-review`
- Reason: 该分析已闭环，需要进入 Preplan 阶段锁定“Skills 基线化与重构”的执行边界。
- User confirmation needed: No.

## Workflow guard

后续任何涉及 `SKILL.md` 修改、基线文件创建或 delegation 契约变更的动作，必须经过 `imm-planner` 产出 validated plan。
