# Pattern: Opt-in Bounded Autorun Entry

**领域**: Agent workflow / step orchestration  
**描述**: 当系统已经有 current-step driver，但用户又明确想按 validated plan 自动推进多个 step 时，应新增一个显式 opt-in 的 bounded autowork entry，而不是把默认协调入口悄悄扩展成 full-plan autowork。

## 场景

- `imm-work` 已经能把一次“继续”推进到当前 step 的下一个安全边界。
- 用户希望减少多 step 场景下的重复手动切换，但仍要保留 executor / QA 权限边界。
- 现有 contract 已经明确声明默认行为不是 full-plan autowork。
- 需要给后续 runtime 实现一个更窄、更安全的入口定义，而不是先把执行范围放宽。

## 方案模板

1. **新增独立入口**: 用单独 skill 承接 autowork 语义，例如 `imm-autowork`，不要直接改写 `imm-work` 的默认定位。
2. **保持显式 opt-in**: 只有用户明确要求“按计划自动推进”时，才进入 autowork；普通继续仍默认走 `imm-work`。
3. **先限定运行模式**: 首版默认 `run until blocked`；可选加小预算模式，但不要先做复杂策略系统。
4. **复用既有权限链**: 自动推进必须继续经过 `imm-work -> imm-executor -> imm-qa`，不能绕过 evidence 或 QA。
5. **把 stop condition 写死**: 至少覆盖 no plan、no executable step、missing evidence、`rework`、`replan`、dependency gap、budget reached、plan complete。
6. **先写验证矩阵**: 在 runtime 实现前先明确首版必须证明哪些路径，例如 no-plan routing、bounded advance、QA stop behavior、completion / budget reporting。

## 可复用前提

- 系统已经有 validated plan、active step、completed steps 等可读状态。
- 默认单步入口已经稳定，且其非目标里明确排除了 full-plan autowork。
- 需求的核心是“减少切换成本”，不是“取消权限边界”。
- 团队接受 autowork 是显式能力，而不是所有 continue 的默认行为。

## 验证依据

- `.imm/specs/bounded-autowork-skill.spec.md` 已把独立 autowork 入口、stop conditions、非目标和首版验证路径写清楚。
- `skills/imm-autowork/SKILL.md` 已定义触发条件、bounded workflow、authority boundary 和 first-implementation validation。
- `README.md` 已把 `imm-autowork` 暴露为显式 validated-plan 入口，并说明它不是 `imm-work` 的默认 full-plan autowork 扩展。
- `zsh scripts/install-local.sh --list` 已能列出 `imm-autowork`，说明它已进入可安装 skill 集合。
- `docs/plans/2026-05-07-010-feat-bounded-autowork-skill-plan.md` 的 `U1-U3` 均已通过 workflow evidence 与 QA closure。

## 约束与建议

- 不要在没有 runtime 证明前，把文档层 contract 当成已经完成的执行能力。
- 如果后续实现需要新增状态字段、CLI 或 loop 控制，应另起实现计划；不要把它偷偷塞回文档规划阶段。
- 不要把 `budget reached` 写成 blocker；它是有意停止，不是失败。
- 一旦发现 autowork 需要双 active step、后台常驻任务或隐式 scope 扩张，应回到 planner 重拆，而不是继续往当前入口上堆功能。

---
*沉淀日期: 2026-05-07 | 来源: bounded autowork skill 规划、契约落地与验证路径闭环*
