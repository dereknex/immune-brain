# IMMUNE.md - 系统宪法

这是 **Immune-Brain** 系统的核心规约文件。所有在此工作空间内运行的 Agent 必须严格遵守以下准则。

## 1. 核心哲学
- **Skill-explicit Managed Path**：普通 host input 保持 host-native；只有用户显式进入 `imm-brainstorm`、`imm-planner` 或 `imm-loop` 才启动或恢复 Managed workflow。active Assurance owner 保持权威，但不会改写普通输入。
- **文件即 Managed 记忆**：Managed Path 的重要决策和工作流状态必须持久化到 Git-owned Spec/TaskIntent 或 `.imm/` authority；host-native path 不会创建或更新 `.imm/` 工作流状态，也不依赖对话记忆作为长期 authority。
- **按请求类型使用规格**：用户显式进入 `imm-planner` 处理清晰的新仓库变更，有实质歧义时显式进入 `imm-brainstorm`；已有 Assurance owner 由用户显式进入 `imm-loop` 恢复。Planner 只产出候选 Spec/TaskIntent，不无条件 Enrollment。
- **小步执行**：Managed Plan 必须按可独立闭合结果组织成果步。Direct 不因多文件、多条本地 verifier、普通重试或只读 subagent 自动升级为 Managed。
- **按证据沉淀**：只有确有复用价值的已闭合工作才写入 `docs/solutions/`；Direct completion 不要求 Compounder。
- **角色质量上限（gstack quality ceiling）**：Managed 核心 Skill 保持 `preferred bias`（最该坚持的质量目标）和 `prohibited drift`（绝不能越界的权力）。交互仪式压缩为真正的 authority/privilege gate；完备性只在有限输入源（Brainstorm manifest、review follow-up packet）上启用。
- **四项执行原则内嵌到流程**：
  1. Think before coding：先澄清假设、歧义和取舍。
  2. Simplicity first：只做当前目标需要的最小方案。
  3. Surgical changes：只改必要边界内的文件和行。
  4. Goal-driven execution：每一步都要能被命令、测试或人工检查验证。

## Managed Path 入口

普通 host input 不执行自然语言 Managed 路由，也不初始化项目契约；显式 Immune-Brain Skill 负责启动新的 Managed workflow。已有 active Assurance owner 保持权威，但只在用户显式进入 `imm-loop` 时恢复。
- `.imm/memory/`：存放运行态状态（`state.json`、`MEMORY.md`、`current_iteration.json`）。
- `skills/`：只存放三个 user-facing Skill 定义；内部 role prompts 位于插件 `runtime/prompts/`。
- `docs/specs/`：存放当前任务的功能规格与验收标准。
- `docs/solutions/`：存放长期沉淀的工程模式、最佳实践与问题解法。
- `CONTEXT.md`（仓库根）：共享领域词汇与术语约定；非运行态真源，与 `.imm/memory/` 互补。
- `HANDOFF.md`（仓库根）：跨会话人类可读进度摘要，真源仍以 `.imm/memory/` 为准。标记区 `<!-- GENERATED: immune-brain-handoff-state -->` 之内由 runtime 在 QA pass 时写入，agent 不要手改；标记区之外的叙述（本次会话的判断、重点文件）由 agent 维护，runtime 不会覆盖。
- `docs/adr/`：轻量架构决策记录（ADR）；目录按需创建，由内部 `compounder` role 在符合 ADR 门槛时写入。

## 3. 写入边界
- **Host-native Path**：只读或明确 no-modification 请求可由普通 host agent 解释、检查和 review，不创建或更新 `.imm/` workflow authority。
- **只读阶段**：`imm-brainstorm`（含 `adversarial` mode）默认不改代码、不改测试、不改运行态；review/QA 等内部角色由 `imm-loop` 调度。
- **会诊阶段**：`imm-brainstorm` 的 `roundtable` mode 只作为只读 advisory layer，用于暴露多角色观点、分歧和风险；不得写计划、执行代码、记录验收结论，且不拥有 `imm-planner` 或执行/QA角色的权限。
- **规划阶段**：`imm-planner` 只写 `docs/specs/`、`docs/plans/` 与必要的 `.imm/memory/MEMORY.md` 规划记录。
- **协调与执行阶段**：`imm-loop` 以 Kernel 上的 TaskIntent/TaskRecord 为权威，通过 `imm_loop_action` 投影分发内部 executor、repair、QA、review 和 compounder roles 推进当前 owner。

## 4. Agent 协作规约
- **`imm-brainstorm`**：只在关键需求或风险仍含歧义时负责澄清；澄清后重新应用 Direct/Managed 矩阵，不默认创建计划。其 `roundtable` mode 负责在复杂取舍、需求分歧或可能 replan 的场景中提供多角色只读会诊；输出只能作为后续规划的研究材料，不直接决定 scope、计划、执行或验收。
- **`imm-brainstorm`（`adversarial` mode）**：可选高压闸门，仅在 scope 不稳且存在显著多方分歧、或需要结构化审计记录（安全、数据迁移、跨边界合约）时触发；大多数任务从 `imm-brainstorm` 直接到 `imm-planner`，不经过此阶段。可调用只读 adversarial helper（`preplan_adversary`）产出风险、争议假设和验证关注点，但最终 scope posture 仍由 preplan host 判断。
- **Host-bound evidence loops**：当 planner 或 preplan 需要子代理帮助时，每个 host 使用专用 readonly helper（`planner_research`、`preplan_adversary`），不抽 shared registry。子代理只产出 evidence（constraints、risks、unknowns、file_pointers），不写 Plan、Spec、scope posture 或 QA 结论。内部 `compounder` role 通过 `subagent_scorecard` 汇总子代理结果价值判断是否值得平台化推广。
- **规划阶段**：`imm-planner` 负责清晰仓库变更的候选 Spec/TaskIntent；它不自动 Enrollment，也不把生成的 artifact 当作已授权任务。
- **Internal executor role**：负责一次只消费当前小步，不得默认扩张到相邻小步。当 Step 带有 `parallel_probes` 时，`imm-loop` 在进入执行前先分发只读并行探针（`active → probing → executing`），探针结果作为 executor 上下文输入；探针失败不阻断步骤，回退到顺序内联调查并记录 fallback reason。
- **Internal QA role**：负责先判断当前小步是否闭合，再决定是通过、返工当前小步，还是回退重拆。
- **Internal review roles**：负责 step 外的技术审查和界面质量复核，输出 blocker/fix/defer 并驱动后续修复或重排。
- **Internal repair role**：负责 PR 阻塞修复（merge conflict、review feedback、CI failure），只做与阻塞项直接相关的最小改动。
- **`imm-loop`（Kernel 执行闭环）**：以已 Enrollment 的 TaskIntent/TaskRecord 为权威，通过 `imm_loop_action` 投影决定下一个 authority（executor、QA、review、compounder、imm-kernel、imm-planner），在当前对话内推进 active Step 并经 Kernel 持久化执行证据与审查结论。不持有独立 checkpoint runtime，亦不得将 executor 验证结果转换为 QA `pass`。
- **Managed 默认继续入口**：validated Managed target 之后，通过 Kernel 与 `imm-loop` owner 继续；内部 executor、QA、review 和 repair roles 保持 authority 分离，不应在正常成功路径中变成用户必须手动切换的显式入口。

## 5. 两条执行路径

### Host-native Path（非变更请求）

只读、解释、仅审查、Plan-only 和明确 no-modification 请求由普通 host agent
处理，不创建 Spec、Plan、TaskIntent、TaskRecord、QA、mandatory
Review 或 Compounder 状态，也不写 `.imm/` workflow authority。

### Managed Path（显式 Skill 入口）

Managed Path 只从显式 Immune Skill 入口启动：`imm-brainstorm`、`imm-planner` 或
`imm-loop`。普通 host input 保持 host-native，不执行自然语言分类；已有 Assurance
projection 仍通过 `imm-loop` 恢复。Planner 输出只是后续 literal-user Enrollment 的
候选，不能绕过 Enrollment、QA、Review、authorization 或 completion。

1. **Brainstorm（按需）**: 当问题陈述、约束或成功标准仍含关键歧义时，进入 `imm-brainstorm`，禁止在关键歧义上猜测。**若澄清信息未获得用户明确回复，必须停止推进，禁止进入规划阶段。**
2. **Roundtable Advisory（可选）**: `imm-brainstorm` 的 `roundtable` mode 只在复杂取舍、跨角色分歧或 replan 判断前提供只读会诊材料；最终 scope 仍由 `imm-planner` 判断。
3. **Adversarial Review（可选高压闸门）**: 仅在 scope 不稳且存在显著多方分歧、或需要结构化审计记录时使用 `imm-brainstorm` 的 `adversarial` mode；大多数任务由 `imm-brainstorm` 内联挑战后直接进入 `imm-planner`。
4. **Plan / Spec（Managed）**: `imm-planner` 定义验收标准并产出当前 Managed TaskIntent/Plan contract。
5. **Continue Current Step**: validated plan 之后，默认通过 `imm-loop` 激活或定位当前 step，并只推进当前 step 的下一段闭环。
6. **Act**: 执行者只实施当前小步对应的单一可验证结果，不吸收相邻清理或未来扩展。
7. **Verify**: 审计员先判断当前小步是否闭合，再决定通过、返工当前小步或回退到 Plan。
8. **Compound**: 任务结束后，只沉淀有证据支撑且可复用的经验到 `docs/solutions/`。

补充入口约束：
- `L2S-WF` 使用三段主线：`imm-planner` 完成必要澄清、Spec 与 validated TaskIntent；经 literal-user Enrollment 形成 Kernel 上的 TaskIntent/TaskRecord 权威记录；`imm-loop` 以 `imm_loop_action` 投影驱动内部 executor、QA、review、repair 与 compounder roles 完成执行、复核和验收。重大歧义先进入 `imm-brainstorm`；主线不改变这些内部 authority 的分离。
- 普通单步继续默认走 `imm-loop`，而不是把内部 executor 或 QA role 当作 shell 入口暴露给用户。
- 多 step 推进通过显式 opt-in 的 `imm-loop` 在当前对话内完成，每个 Step 的执行证据与 QA/review 结论经 Kernel 持久化，不依赖独立 checkpoint runtime，亦不把推进回灌成另一个公开 Skill 的默认行为。
- `imm-brainstorm`（`roundtable`/`adversarial` modes）只作为 attachable advisory layer；内部 reviewer roles 可以补 research 或 risk，不能替代 planner、executor 或 QA authority。

---
*版本：v4.0.0 | 日期：2026-08-20*
