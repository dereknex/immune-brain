> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: System-wide Skill Baselining with Role Delta Pattern

**领域**: Agent workflow / Prompt Engineering / Context Efficiency
**描述**: 通过建立共享基线（`BASELINE.md`）并推行“角色增量（Role Delta）”模式，显著降低多技能 Agent 系统的初始 Context 开销（↓60%+），同时保持强一致性的工作流守卫。

## 场景

- 当 Agent 拥有大量技能（20+），每个技能文件都包含重复的工作流 SOP、输出话术和边界说明时。
- 当全量加载技能导致 Context Window 预热过慢或 Token 浪费严重时。
- 当需要在一个中心点更新全局工作流原则（如“先思后行”）而不希望逐一修改技能文件时。

## 方案核心

1.  **共享基线 (`skills/BASELINE.md`)**:
    - **Shared Guards**: 收口“四大原则”（Think before coding, Simplicity first, Surgical changes, Goal-driven execution）。
    - **Output Style**: 定义标准的 `Conclusion -> Evidence -> Next Action` 话术。
    - **Boundary Baseline**: 固化权限分离、Active Step 锁定等硬契约。
2.  **角色增量 (Role Delta Pattern)**:
    - 每个 `SKILL.md` 仅包含：角色名称、特定责任、该角色独有的写入边界、以及特定的输出产物 schema。
    - 在文件顶部显式声明 `This skill adheres to the `BASELINE.md`.`。
    - 使用精简指令，通过引用而非复述来触发 Agent 对基线知识的调用。

## 收益

- **大幅减重**: 核心技能如 `imm-work` 从 14KB 降至 3.2KB，总包大小从 146KB 降至 50KB。
- **高维护性**: 修改全局话术或原则只需更新基线文件。
- **一致性**: 强制所有角色遵循相同的输出结构和边界守卫。

## 约束与建议

- 必须配合 Contract Tests（如 `tests/test_skill_contracts.py`）确保精简后的指令依然能触发关键行为断言。
- 如果某个技能需要绕过基线原则，必须在 Role Delta 中显式声明例外原因。

---
*沉淀日期: 2026-05-10 | 来源: Batch 1 & 2 skills baselining 闭环验收*
