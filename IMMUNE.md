# IMMUNE.md - 系统宪法

这是 **Immune-Brain** 系统的核心规约文件。所有在此工作空间内运行的 Agent 必须严格遵守以下准则。

## 1. 核心哲学
- **Skill-explicit Managed Path**：普通 host input 保持 host-native；只有用户显式进入 `imm-brainstorm`、`imm-planner` 或 `imm-loop` 才启动或恢复 Managed workflow。active Assurance owner 保持权威，但不会改写普通输入。
- **文件即 Managed 记忆**：Managed Path 的重要决策和工作流状态必须持久化到 Git-owned Spec/TaskIntent 或 `.imm/` authority；host-native path 不会创建或更新 `.imm/` 工作流状态，也不依赖对话记忆作为长期 authority。
- **按请求类型使用规格**：用户显式进入 `imm-planner` 处理清晰的新仓库变更，有实质歧义时显式进入 `imm-brainstorm`；已有 Assurance owner 由用户显式进入 `imm-loop` 恢复。Planner 只产出候选 Spec/TaskIntent，不无条件 Enrollment。
- **小步执行**：Managed TaskIntent 按可独立验收、回滚和结算的结果划分；内部实施批次不创建第二套 Step authority。Direct 不因多文件、多条本地 verifier、普通重试或只读 subagent 自动升级为 Managed。
- **按证据沉淀**：只有确有复用价值的已闭合工作才写入 `docs/solutions/`；Direct completion 不要求 Compounder。
- **角色权限边界（role authority boundary）**：Managed 核心 Skill 保持 `preferred bias`（最该坚持的质量目标）和 `prohibited drift`（绝不能越界的权力）；交互仪式压缩为 `role_prompt_bridge.ts` 按角色分配的工具策略与 Kernel authority/capability gate。完备性只在有限输入源（Brainstorm manifest、review follow-up packet）上启用。
- **四项执行原则内嵌到流程**：
  1. Think before coding：先澄清假设、歧义和取舍。
  2. Simplicity first：只做当前目标需要的最小方案。
  3. Surgical changes：只改必要边界内的文件和行。
  4. Goal-driven execution：每一步都要能被命令、测试或人工检查验证。

## Managed Path 入口

普通 host input 不执行自然语言 Managed 路由，也不初始化项目契约；显式 Immune-Brain Skill 负责启动新的 Managed workflow。已有 active Assurance owner 保持权威，但只在用户显式进入 `imm-loop` 时恢复。
- `.imm/state/`：worktree-local 运行态（TaskRecord v4、workspace ownership、锁与 transaction marker），整体 Git-ignored；terminal evidence 归 `.imm/audit/<task-id>/` tracked 存储。旧 v3 布局 `.imm/memory/`（state.json、MEMORY.md、current_iteration.json）已 retired：runtime 只作 drain-only 读取，新写入一律走 v4 布局。
- `skills/`：存放六个 user-facing Skill 定义；`imm-brainstorm`、`imm-planner` 和 `imm-loop` 是 Managed Path 入口，`imm-pr-fix`、`imm-doc-prune` 和 `imm-agent-doc-maintain` 是 host-native 维护入口；内部 role prompts 位于插件 `runtime/prompts/`。
- `docs/specs/`：存放当前任务的功能规格与验收标准。
- `docs/solutions/`：存放长期沉淀的工程模式、最佳实践与问题解法。
- `CONTEXT.md`（仓库根）：共享领域词汇与架构导航；非运行态真源，运行状态由 TaskRecord 和 Kernel projection 提供。
- `HANDOFF.md`（仓库根）：跨会话人类可读进度摘要，真源以 `.imm/state/` 的 TaskRecord 为准。标记区 `<!-- GENERATED: immune-brain-handoff-state -->` 之内是 v3 runtime 的历史输出（该 writer 已随 v3 移除，当前 runtime 不再写入），内容仅作历史参考；标记区之外的叙述由 agent 维护。
- `docs/adr/`：轻量架构决策记录（ADR）；目录按需创建，由内部 `compounder` role 在符合 ADR 门槛时写入。

## 3. 写入边界
- **Host-native Path**：只读或明确 no-modification 请求可由普通 host agent 解释、检查和 review，不创建或更新 `.imm/` workflow authority。
- **只读阶段**：`imm-brainstorm`（含 `adversarial` mode）默认不改代码、不改测试、不改运行态；review/QA 等内部角色由 `imm-loop` 调度。
- **会诊阶段**：`imm-brainstorm` 的 `roundtable` mode 只作为只读 advisory layer，用于暴露多角色观点、分歧和风险；不得写计划、执行代码、记录验收结论，且不拥有 `imm-planner` 或执行/QA角色的权限。
- **规划阶段**：`imm-planner` 只写候选 Spec、通过 canonical author 创建 TaskIntent，以及已确认的 Initiative carrier（carrier 无内置默认值，按 `docs/reference/immune-brain-config.md` 的偏好优先级解析，解析不到时必须询问用户）；不写旧 State Ledger，不覆盖 enrolled TaskIntent。
- **协调与执行阶段**：`imm-loop` 以 Kernel 上的 TaskIntent/TaskRecord 为权威，通过 `imm_loop_action` 投影分发内部 executor、repair、QA、review 和 compounder roles 推进当前 owner。

## 4. Agent 协作规约
- **`imm-brainstorm`**：只在关键需求或风险仍含歧义时负责澄清；澄清后重新应用 Direct/Managed 矩阵，不默认创建计划。其 `roundtable` mode 负责在复杂取舍、需求分歧或可能 replan 的场景中提供多角色只读会诊；输出只能作为后续规划的研究材料，不直接决定 scope、计划、执行或验收。
- **`imm-brainstorm`（`adversarial` mode）**：可选高压闸门，仅在 scope 不稳且存在显著多方分歧、或需要结构化审计记录（安全、数据迁移、跨边界合约）时触发；大多数任务从 `imm-brainstorm` 直接到 `imm-planner`，不经过此阶段。可调用内部只读 `advisory-reviewer` role（经 `imm-loop` 内部角色路由分发，见 ADR-0003）产出风险、争议假设和验证关注点，但最终 scope posture 仍由 preplan host 判断。
- **Host-bound evidence loops**：当 planner 或 preplan 需要子代理帮助时，每个 host 使用内部只读 role（`arch-explorer`、`advisory-reviewer`，经 `imm-loop` 内部角色路由分发，见 ADR-0003），不抽 shared registry。子代理只产出 evidence（constraints、risks、unknowns、file_pointers），不写 Plan、Spec、scope posture 或 QA 结论。内部 `compounder` role 只在已闭合 Step 的证据证明存在可复用 Learning 时才被分发，判断是否值得沉淀到 `docs/solutions/`。
- **规划阶段**：`imm-planner` 负责清晰仓库变更的候选 Spec/TaskIntent；它不自动 Enrollment，也不把生成的 artifact 当作已授权任务——只有 literal-user Enrollment 才能把候选提升为 Kernel 上的 TaskIntent/TaskRecord 权威记录。
- **Internal executor role**：只实现已 Enrollment TaskIntent 的 acceptance 与 `scope_hint`，在当前对话内做 focused verification。可选只读探针仅提供调查证据，不创建持久 Step 状态。
- **Deterministic QA**：冻结后由 Host integration 在前台逐项运行固定 acceptance descriptors，原子提交验收；不再分发逐 Step QA Agent。
- **Internal review roles**：material/critical 任务按 Kernel 返回的 snapshot-bound `agent_params` 分发独立前台 Reviewer；Parent 将结构化 verdict 交给 `submit_review`，不自发增加审查 gate。
- **Internal repair role**：负责 PR 阻塞修复（merge conflict、review feedback、CI failure），只做与阻塞项直接相关的最小改动。
- **`imm-loop`（Kernel 执行闭环）**：以已 Enrollment 的 TaskIntent/TaskRecord 为权威，在内部 role boundary 使用 `imm_loop_action`，由 Kernel Tool 完成 freeze、QA、Review 与 settlement。消费操作返回的新 projection；中断、结果不明或缺失 projection 时重新读取 status，不重复已经提交的验收。不持有独立 checkpoint runtime，亦不得将 executor 验证结果转换为 QA `pass`。
- **Managed 默认继续入口**：validated Managed target 之后，通过 Kernel 与 `imm-loop` owner 继续；内部 executor、QA、review 和 repair roles 保持 authority 分离，不应在正常成功路径中变成用户必须手动切换的显式入口。

## 5. 两条执行路径

Host-native Path 与 Managed Path 的定义、入口条件和角色分工见 §1（核心哲学）、
§3（写入边界）与 §4（Agent 协作规约）；本节不重复展开。

补充约束（不在别处出现）：
- **若 Brainstorm 阶段的澄清信息未获得用户明确回复，必须停止推进，禁止进入规划阶段。**

---
*版本：v4.0.1 | 日期：2026-09-01*
