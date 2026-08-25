# Public Skill 目录与系统 Subagent 参考

本页描述 Immune-Brain 的三个 user-facing Skill 入口及其内部 role/runtime 合同。
用户可发现的 Skill 只有 `imm-brainstorm`、`imm-planner` 和 `imm-loop`；下文的
executor、QA、Review、repair、explorer、advisory、Compounder 名称都是 Loop
内部 role 或稳定 gate identifier，不是可安装 Skill，也没有兼容 alias。

本页从主 [README.md](../../README.md) 拆出，便于单独阅读与打印。内容与仓库契约测试中的「用户文档表面」一致：**契约测试会将本文与 README 合并后做断言**。

---

## 三个 public Skill 入口与内部 role 合同

### `imm-brainstorm`
对问题先做结构化头脑风暴，明确范围、边界和假设，并把任务转换成可规划状态。

*   **特色**：扮演批判性“内省质询哨兵”，实施深度 Gap 扫描，主动挑战复杂过度工程。
*   **优势**：建立以 `BR-*` 为核心的闭包追踪与澄清硬栅栏，拦截盲目规划，从源头扼杀需求漂移。
*   **解决场景**：适用于开发前期需求定义模糊、容易发生思维定势的早期论证阶段。

内嵌原则：Think before coding。先暴露假设和分歧，不静默选择。

### `imm-brainstorm`（`adversarial` mode）
可选高压闸门：仅在 scope 不稳且存在显著多方分歧、或需要结构化审计记录时使用 `imm-brainstorm` 的 `adversarial` mode；大多数任务由 `imm-brainstorm` 内联挑战后直接进入 `imm-planner`。这个阶段只决定 scope 应保持、收缩，还是有限扩展，并确认工程边界是否已足够闭合。

*   **特色**：非侵入式只读压力测试，纯粹聚焦于范围裁剪与闭环逻辑审计，严禁触碰代码或重编细节。
*   **优势**：强力拦截无节制的 ambition 膨胀，确保进入规划前具备 100% 确定性的工程着陆面。
*   **解决场景**：适用于核心底层重构、存在重大并发/安全隐患的高风险变更前哨战。

内嵌原则：Think before coding + Simplicity first。ambition 可以主动选择，但不能静默扩张。

### Internal Loop coordination role
计划后的 current-step driver，负责推进当前 step 的下一段闭环。

职责：
- 判断是否有可执行计划
- 激活或定位当前可执行 step
- 跟踪当前状态并进入 internal executor、internal QA 或 `imm-planner` 语义
- 让一次“继续”只推进当前 step，不静默跨入下一个 step
- 当前 step 需要执行时，同一轮进入 executor 语义并留下 evidence
- 在 `pass` 后报告下一个可继续 step，但不默认自动跑完整 plan

*   **特色**：整个系统的战术控制枢纽，通过单步隔离策略维护状态连续性。
*   **优势**：严格将修改范围锁死在 active step 目标内，预先拉起并行探测器收集 `child_evidence` 供 executor 直接消费，并在 pass 后自动维护 `HANDOFF.md` 快照以抵御长会话上下文膨胀。
*   **解决场景**：多步骤复杂重构，防范开发人员“改着改着就迷失方向”以及断点恢复难题。

输出建议：
- 默认只说结论、关键证据和下一步。
- 只有在状态变化、阻塞、返工或用户明确要求时，才展开完整 workflow state。

内嵌原则：Goal-driven execution。每次只围绕当前可验收目标协调状态。

### `imm-autowork`（runtime/CLI 命令原语，非可安装 Skill）
`imm-autowork` 已下沉为确定性 checkpoint runtime 命令原语（`bin/imm-autowork --json`），由 `imm-loop` 在已有 validated plan 或 pending reviewer `follow_up` 时消费；它本身不再是可安装 Skill，也不自行调用 executor / QA / reviewer / compounder。

职责：
- 按计划自动推进多个 step，并可在 completed Plan 后继续消费 pending reviewer `follow_up`
- 只到安全阻塞点、计划和 follow-up 完成点，或小预算上限
- 复用 `imm-loop -> executor -> qa` 的权限边界
- 在 `pass` 后可以继续下一个已解锁 step，但遇到 `rework`、`replan`、缺证据或依赖缺口就停止
- 每次 autowork 改变 workflow 状态后，Pi 协调器重新读取 Loop runtime projection
  并刷新当前任务投影；该同步只是 `.imm` 到 Pi UI 的只读展示
- `imm-loop` 不把 runtime checkpoint 默认改造成 full-plan autowork

*   **特色**：机器可读的高安全度推进引擎，支持 validated 计划及 follow-up 自动推进。
*   **优势**：在保障“安全第一”的前提下，遇到任何执行红灯（断言失败、rework/replan）立即原地刹车退回，不污染本地状态。
*   **解决场景**：执行 3-5 步确定性重构或常规测试修复时，免除用户反复敲击命令与交互授权的低效打扰。

输出建议：
- 默认只说这轮推进了哪些 step、为什么停、下一步该回哪个 skill。
- 不要把完整 loop transcript 倒给用户，除非用户明确要看。

内嵌原则：Goal-driven execution + Surgical changes。自动推进不等于放宽 step 边界。

### `imm-planner`
负责定义边界和拆解任务。

职责：
- 编写 `docs/specs/` 并建立可验证目标
- 将任务拆成 `3-5` 步，单步可复查
- 防止混合目标导致的边界扩散
- 面对大任务时，将 Roadmap 作为完整记忆，把当前 executable slice 单独写成可验收 Plan
- 为 deferred phase 保留后续入口：open questions、promotion criteria、candidate next Plan

*   **特色**：严把脑暴闭包大门，采用交付物导向进行步骤拆解，对最终计划进行格式与语法双重 Validator 强校验。
*   **优势**：阻断未决的开放问题污染计划，通过 `Brainstorm Trace` 追踪表防范需求遗漏，严禁在规划阶段改动任何实现代码。
*   **解决场景**：项目边界梳理与细化，确保复杂任务以最简、可验证的形态执行。

内嵌原则：Simplicity first + Goal-driven execution。规划只保留必要步骤，每步必须能验证。

### Internal executor role
负责执行单步。

职责：
- 只处理当前激活步骤
- 不主动扩展到未确认步骤
- 产出可验证证据，交由下一步评估
- 在多轮尝试时保留最小 loop trace，并把工具输出压缩成结构化反馈

*   **特色**：极其严格的 TDD 编码纪律（RED -> GREEN -> REFACTOR），自动捕获变更快照（Characterization-first）。
*   **优势**：强制在修改前补充测试，通过 `record-execution` 在 ledger 中记录真实终端输出，并用 Loop Engineering Discipline 区分 failure exit、strategy change 和 repeated failure，杜绝捎带式清理引起的旁支逻辑塌陷。
*   **解决场景**：具体业务与测试代码编写，提供行行可信度的安全交付。

输出建议：
- 默认只总结改了什么、怎么验证、为什么现在可以进 QA。
- 小步改动不要机械复述完整 executor 模板。

内嵌原则：Surgical changes + Simplicity first。只做当前 step 的最小必要改动。

### Internal QA role
负责每步收口和质量判断。

职责：
- 输出 `pass` / `rework` / `replan`
- 用证据驱动结论，避免“看起来修完了”判断
- 结构性问题优先返回 `replan`
- 对 repeated failure without strategy change 返回 `rework` 或 `replan`

*   **特色**：刻板、冷酷的循证审计关卡，严格践行“三权分立”，绝不亲自动手编写或修改任何代码。
*   **优势**：用数据与终端客观日志证据说话，核验 Executor 的 RED-before-GREEN 链路，有效杜绝自写自测自证的逻辑漏洞。
*   **解决场景**：各个执行步骤的最终卡点与质量断言。

输出建议：
- 先给结论，再给最短必要证据，最后给下一步。
- 失败时再展开 gap 和阻断影响；通过时不要重复整套验收清单。
- `pass` 默认压缩成两句：一句结论，一句证据；只有明确要求 debug 时才展开 packet 字段、状态细节和额外背景。

内嵌原则：Goal-driven execution。没有证据就不能通过。

### Loop Engineering Discipline

Loop Engineering Discipline enhances the existing `Step` evidence loop; it is not a new platform. 它要求 `Executor` 在多轮尝试中记录短格式 loop trace，包含 attempt、observation、judgment、next strategy；要求工具输出先被整理成 structured tool feedback，再交给 `QA` 判断。`QA` 不把 repeated same error、tool failure、no progress、missing credentials、unclear target or verification 写成泛泛 blocker，而是根据是否存在 strategy change 决定 `rework` 或 `replan`。

### Internal code-review role (stable gate `imm-code-review`)
对单步外的代码审查进行结构化处理（PR review、反馈回路、CI 失败归并）；
输出 blocker/fix/defer，并明确区分“当前边界可直接修”与“需要新 follow-up plan”；
review 还应附带一个 bounded `follow_up` handoff，把最小修复边界、成功目标和验证提示交给下一轮；
前者进入 `imm-planner` 收敛成 validated one-step / small-step plan，再由 `imm-loop` 的
internal executor 执行，
后者则直接路由回 `imm-planner` 生成新的 follow-up slice。

*   **特色**：代码联检宿主，引入“文件级上下文分片（Context Sharding）”，分发任务给各专项只读顾问。
*   **优势**：利用分片提高审计吞吐率以规避大文件审查死角，采用可观察准则（verification criteria）进行 Findings 排重，将小问题降级回流直修而无需 planner重写计划。
*   **解决场景**：主干合并前的防守，以及多维度架构/安全漏洞审查。

### Internal PR repair role
负责处理 PR 无法继续合并的阻塞项：merge conflict、review feedback、CI failure。

职责：
- 按 conflict -> feedback -> CI 顺序定位阻塞
- 只做与阻塞项直接相关的最小修复
- 给出每个修复对应的验证命令和剩余风险

*   **特色**：并发分支沙盒化PR修复，配合 GitHub CLI 精准定位 CI 报错与合并冲突区。
*   **优势**：仅修改冲突与 Blocker 关联文件，提供严格的冲突区合并校验，防止意外覆盖他人成果。
*   **解决场景**：解决由于合并频繁、CI 误报等导致的分支 PR 发布拥堵。

### Internal UI review role (stable gate `imm-ui-review`)
聚焦前端交付后的界面质量与体验完整性：
功能正确后，先做可用性、无障碍、响应式、视觉一致性等复核；
给出可执行的修复优先级，决定是 `fix` 还是 `defer`；
若需进入下一轮实现，也应输出与 `imm-code-review` 对齐的 bounded `follow_up` handoff，而不是直接跳到执行。

*   **特色**：基于经典的 Nielsen 启发式可用性十条及 Web 体验指标，提供高保真的可用性与视觉美学审查。
*   **优势**：深度关注交互长任务的 Skeleton 体验与表单置灰防呆设计，支持极速的同边界修复路径。
*   **解决场景**：优化前端交互和人机界面质量，防止纯功能导向的程序员忽略无障碍（a11y）或用户操作体验。

### Internal Compounder role
负责把完成经验沉淀为可复用的组织记忆。

职责：
- 提炼经验写入 `docs/solutions/`
- 更新 `.imm/memory/MEMORY.md`
- 为下一次任务减少重复设计和重复试错

*   **特色**：自动进行庞杂执行日志与 focus delta 的“脱水归档”（Dehydrate），提炼极简架构决策记录（ADR）。
*   **优势**：根治长会话的 context 膨胀与垃圾堆积；通过结构化标签和 explicit reuse 标记实现知识高阶沉淀与智力复利。
*   **解决场景**：任务完成后归档、团队智力资产沉淀，防止同类错误反复出现。

输出建议：
- 只说明沉淀了什么模式、写到哪里、后续何时复用。
- 不把 memory 刷新过程当成用户需要阅读的主要内容。

内嵌原则：Simplicity first。只沉淀有复用前提和验证依据的经验，不写泛化口号。

### Public Skills and internal role boundaries

The table below deliberately separates the three discoverable Skills from roles that only
`imm-loop` dispatches internally.

| Surface | Write boundary | Output |
|---|---|---|
| `imm-brainstorm` | Read-only by default; optional `docs/brainstorms/` artifact | Problem frame, assumptions, risks, next-stage handoff |
| `imm-planner` | `docs/specs/`, `docs/plans/`, and planning memory | Validated Spec/Plan and verification paths |
| `imm-loop` | Current workflow boundary through explicit runtime actions | Execution, QA, Review, repair, learning, or terminal next action |
| Internal `executor` | Active Step or accepted same-boundary follow-up only | Execution evidence |
| Internal `qa` | Evidence and review decision fields only | `pass` / `rework` / `replan` |
| Internal `code-review` / `ui-review` | Read-only review evidence | Findings and stable gate decisions |
| Internal `pr-fix` / `test-fixer` | Explicitly delegated repair files only | Bounded child evidence |
| Internal `compounder` | `docs/solutions/`, ADRs, and memory after closure | Reusable Learning |

---

### 系统 Subagents 分层

Immune-Brain 的系统级 subagents 按三层设计，避免把上游的大型 agent 清单直接搬进默认流程：

1. **核心闭环层**：默认可用，服务于理解项目、控制范围、计划和 Loop 执行；内部 role 不是 public Skill。
2. **条件风险层**：仅在任务触及对应风险时启用，例如 security、data、API、reliability、UI 或 release readiness；不作为每次任务的默认参与者。
3. **项目专用层**：仅面向特定项目类型启用，例如 AI eval、prompt contract、docs verification 或 debug investigation。

这些 subagents 只能提供受控执行或 advisory 输入，不能绕过 `imm-loop` 的 active-step
或 authority gate，也不能替代 `imm-brainstorm`、`imm-planner` 或 `imm-loop` 的边界判断。

#### Authority 与 Routing Boundary

在 Immune-Brain 里，需要把 3 类东西分开看：

- `imm-brainstorm`（`roundtable` mode）：独立的只读会诊层，只负责暴露多角色观点；它不是 system subagent roster，也不拥有 scope、plan、execution 或 QA authority。
- system subagents：父 orchestrator 按需调用的辅助能力；它们可以提供 advisory、planning artifact、active-step bounded execution 或 review evidence，但都不能静默升级成 authority role。
- `imm-*` authority roles：真正拥有流程决策权的闭环内部角色，例如 `imm-planner`、internal executor、internal QA；system subagents 只能映射或服务于这些角色，不能取代它们。

首版只接受 4 类 system subagent authority class：

- **advisory**：只给出研究、评审或风险意见，例如 `context-mapper`、`scope-reviewer`、`code-reviewer`、`ui-reviewer`。
- **planning artifact writer**：只写 planning artifact，不改实现，例如 `planner`。
- **active-step bounded executor**：只在 `imm-loop` 已激活当前 step 后，改动当前 step 范围内的文件，例如 `executor`。
- **review evidence producer**：只产出闭合判断或复用沉淀所需 evidence / artifact，例如 `qa-verifier`、`knowledge-compounder`。

无论哪一类 subagent：

- 都不能直接决定最终 scope posture；
- 都不能跳过 `imm-loop` 的 active-step gate；
- 都不能把 advisory 结果直接转成 plan rewrite、code edit 或 QA `pass`；
- 一旦需要超出当前 authority class 的行为，必须回到对应的 `imm-*` role 继续闭环。

#### 首版核心 Subagents

首版核心集合控制在 8 个以内，覆盖一个任务从理解到沉淀的默认闭环：

#### Subagent Manifest Contract（v1）

同一套 manifest contract 适用于核心闭环层、条件风险层和项目专用层。首版要求核心层完整列出这些字段；条件风险层和项目专用层在被正式纳入治理文档时，也必须沿用同一字段集合，而不是再发明另一套描述方式。

首版每个 system subagent 至少要能被稳定描述为以下字段：

- `id` / `version` / `role`
- `host`
- `mode`
- `trigger`
- `trigger_surface`
- `invocation_stage`
- `authority_class`
- `tools_allowed`
- `tool_policy`
- `write_boundary`
- `input_schema`
- `output_schema`
- `failure_mode`
- `fallback_reason`

如果后续要把文档契约升级成 runtime registry，可以再补充 `state_access`、`timeout_ms` 和 `max_retries`；但首版文档契约不要求为了这些字段引入新的运行时层。

其中：

- `invocation_stage` 说明它主要服务于 `brainstorm / preplan / plan / work / review / compound` 的哪一段。
- `authority_class` 首版只允许 `advisory`、`planning-artifact-writer`、`active-step-bounded-executor`、`review-evidence-producer`。
- `write_boundary` 必须写清楚是否只读，还是只允许写 planning artifact、active step 范围文件、或 `docs/solutions/` 这类受控目标。

首版治理要求：

- 核心闭环层必须在文档里逐个写出 manifest-style contract。
- 条件风险层至少要先声明 trigger、authority class、write/tool boundary 和输出摘要，避免被默认拉进流程。
- 项目专用层只有在项目类型明确需要时才补充 manifest entry；未启用时必须有清晰 fallback，而不是把它们伪装成核心层成员。

#### Authorization Policy

Bounded advisory subagents follow literal-user intent, repository `AGENTS.md`
standing authorization, and Pi host policy. An explicit solo/no-subagent request
always prevents dispatch. Without host authorization or reliable dispatch,
Parent stays solo and reports the fallback instead of claiming child work.
No agent-local activation mode or override table exists.

所有核心 subagent 的最小输出契约至少包含：

```json
{
  "status": "ok | partial | blocked | failed",
  "summary": "...",
  "findings": [],
  "recommendations": [],
  "risks": [],
  "confidence": 0.0
}
```

面向用户的 Markdown 可以更自然，但系统消费层不能只依赖自由散文。

| Subagent | Purpose | Trigger | Invocation stage | Authority class | Write / tool boundary | Output contract | Immune-Brain mapping |
|---|---|---|---|---|---|---|---|
| `context-mapper` | 提炼项目结构、关键文件和现有约定 | 新项目、陌生代码库、规划前需要 repo context | `brainstorm`, `plan` | `advisory` | 只读；只做 repo context 读取，不改计划、不改代码、不改运行态 | project map、relevant files、constraints、risks | `imm-brainstorm` / `imm-planner` 的 research 输入 |
| `scope-reviewer` | 判断目标是否过大、是否需要收缩或有限扩展 | brainstorm 后、计划前、review 暴露 scope 风险时 | `preplan`, `review` | `advisory` | 只读；不写 plan、不决定最终 scope posture | scope posture suggestion、in/out boundary、blocking ambiguity | `imm-brainstorm`（`adversarial` mode） |
| `planner` | 产出 spec 和可独立闭合的小步计划 | scope 已稳定但还没有 validated plan | `plan` | `planning-artifact-writer` | 只写 `docs/specs/`、`docs/plans/` 和必要 planning memory | spec、iteration plan、validator result、next action | `imm-planner` |
| `executor` | 执行一个 active step 的最小必要改动 | `imm-loop` 激活 step 后需要交付结果 | `work` | `active-step-bounded-executor` | 只改当前 active step 所需文件；不改计划和 review state | changed files、verification command、verification result、remaining risk | internal executor |
| `qa-verifier` | 判断当前 step 是否 pass、rework 或 replan | step 有 execution evidence 后 | `review` | `review-evidence-producer` | 只读验证；只通过 runtime review action 记录结论 | decision、evidence、artifacts、notes | internal QA |
| `code-reviewer` | 做跨 step 或 PR 级技术审查 | PR review、CI 阻塞、宽 diff 或 review feedback | `review` | `advisory` | 只读；不直接修复；修复回到 executor 或 pr-fix | findings、blockers、deferred items、next actions | `imm-code-review` |
| `ui-reviewer` | 复核 UI/UX、可访问性、响应式和视觉一致性 | 前端、设计或交互变更完成后 | `review` | `advisory` | 只读评审；不直接改 UI；修复回到 executor | UI findings、severity、proof、fix/defer/replan suggestion | `imm-ui-review` |
| `knowledge-compounder` | 把已验证经验沉淀为可复用知识 | plan 完成并有可复用证据后 | `compound` | `review-evidence-producer` | 只写 `docs/solutions/` 和 `.imm/memory/MEMORY.md` | solution doc、reuse conditions、evidence、memory update | internal Compounder |

#### 条件风险 Advisory Lenses

条件风险 lens 只在任务内容、计划步骤或 diff 明确触发对应风险时启用；不能因为“更全面”而默认加入工作流。它们都通过 `imm-advisory-reviewer` 执行，输出只能作为当前 step、review 或 replan routing 的 evidence，不能直接扩大 scope、修改计划或提升执行权限。

这一层只保留跨项目高复用、主要由变更面触发的 lens。`debug_hypothesis` lens 更依赖故障场景，不放在条件风险层，而放到项目专用层里按需启用；`docs`、`prompt_contract`、`release_readiness`、`ai_eval` 虽然按交付方式或项目类型触发，但已作为 `imm-advisory-reviewer` 的显式触发 lens 提供。

| Advisory lens | Trigger | Default participation | Permission boundary | Output |
|---|---|---|---|---|
| `security` | 认证、授权、输入处理、公开端点、密钥、权限模型或安全敏感配置变化 | conditional；not default | 只读审查；不能修复代码；修复回到 active step 或专门 PR fix | exploitable risks、severity、affected surface、required mitigation |
| `data_integrity` | schema、migration、backfill、持久化模型、事务边界或隐私相关数据流变化 | conditional；not default | 只读审查；不能运行破坏性数据操作；不能扩大迁移范围 | data loss/corruption risks、rollback concern、verification query or check |
| `api_contract` | API route、request/response schema、serialization、versioning 或 exported type contract 变化 | conditional；not default | 只读审查；不能改 contract；变更必须回到 planner 或 executor | breaking-change risk、compatibility notes、consumer impact |
| `reliability` | retry、timeout、queue、background job、error handling、health check 或外部依赖调用变化 | conditional；not default | 只读审查；不能引入新基础设施；修复走当前 step scope | failure modes、operational risk、missing guardrails |

对 auth、authz、input handling、public endpoint、secret flow、permission model 或 security config 变化，`imm-advisory-reviewer` 通过 `security` lens 只在显式触发时加入；如果当前环境不能可靠 dispatch advisory reviewer，回退到 `imm-code-review` 与当前 step 的最小 security notes，而不是把它提升成默认 gate。

对 schema、migration、backfill、persistence boundary、redaction policy 或 integrity-critical data semantics 变化，`imm-advisory-reviewer` 通过 `data_integrity` lens 只在显式触发时加入；如果当前环境不能可靠 dispatch advisory reviewer，回退到 `imm-code-review` 与当前 step 的最小 data-integrity notes，而不是把它提升成默认 gate。

对 API route、request/response schema、serialization、versioning、exported type 或 public contract 变化，`imm-advisory-reviewer` 通过 `api_contract` lens 只在显式触发时加入；如果当前环境不能可靠 dispatch advisory reviewer，回退到 `imm-code-review` 与 planner / executor 的最小 contract notes，而不是把它提升成默认 gate。

对 retry、timeout、queue、background job、error handling、health check 或 external dependency 变化，`imm-advisory-reviewer` 通过 `reliability` lens 只在显式触发时加入；如果当前环境不能可靠 dispatch advisory reviewer，回退到 `imm-code-review` 与当前 step 的最小 reliability notes，而不是把它提升成默认 gate。

旧的 `security-reviewer`、`api-contract-reviewer`、`data-integrity-reviewer` 与 `reliability-reviewer` skill surface 已删除；自动 routing 的当前事实以 `imm-advisory-reviewer` 加具体 lens 为准。

#### Subagent Model Selection

Subagents inherit the current Pi session model by default. A Parent may select
another Pi-configured model through the host-native `Agent.model` parameter when
a bounded role has a concrete model need. Immune-Brain does not maintain a
separate model-tier mapping or provider configuration.

#### 项目专用 Subagents（首版最小集合）

项目专用层保留 1 类高信号 lens（`debug_hypothesis`）。它不是默认参与者，因为触发条件来自故障场景，而不是所有任务都会遇到的通用 diff 风险。`docs`、`prompt_contract`、`release_readiness`、`ai_eval` 已合并为 `imm-advisory-reviewer` 的显式触发 lens（旧 `docs-verifier`、`prompt-contract-reviewer`、`release-readiness-checker`、`ai-eval-planner` 独立 skill surface 已删除）。

| Subagent | Trigger | Why not core / conditional risk | Fallback when absent | Output |
|---|---|---|---|---|
| `debug_hypothesis`（`imm-advisory-reviewer` lens） | incident、tricky bug、复现困难或需要系统性排查的故障场景 | 它面向调查型任务，不是 steady-state 开发闭环的常驻角色 | 由 `context-mapper` + `code-reviewer` + 当前 active step 的最小复现组合替代 | hypotheses、repro path、missing signals、next probes |

对 AI/agent 项目中的 prompt、tool contract、instruction、structured output 或 safety boundary 变更，`imm-advisory-reviewer` 通过 `prompt_contract` lens 只在显式触发时加入；如果当前环境没有这条 dedicated reviewer 路径，回退到 `scope-reviewer` + `imm-code-review` 的基础一致性审查，而不是把它提升成默认 gate。

对 AI/agent 项目中的 behavior、eval set、rubric、guardrail 或 production monitoring 设计变更，`imm-advisory-reviewer` 通过 `ai_eval` lens 只在显式触发时加入；如果当前环境没有这条 dedicated reviewer 路径，回退到 `imm-planner` 的最小 eval 方案或人工验收路径，而不是把它提升成默认 gate。

对 README、用户文档、setup instructions、usage examples 或 behavior-to-docs delta 变化，`imm-advisory-reviewer` 通过 `docs` lens 只在显式触发时加入；如果当前环境没有这条 dedicated reviewer 路径，回退到 `executor` 的手动 docs check 或 `imm-code-review` 的基础文档一致性检查，而不是把它提升成默认 gate。

对 ship、deploy、rollback、migration rollout、feature flag 或 production switch 变化，`imm-advisory-reviewer` 通过 `release_readiness` lens 只在显式触发时加入；如果当前环境没有这条 dedicated reviewer 路径，回退到 `imm-code-review` 或人工 release checklist，而不是把它提升成默认 gate。

对 incident、tricky bug、复现困难、missing signal 或 hypothesis-driven investigation 场景，`debug_hypothesis` lens 只在显式触发时加入，并通过 `imm-advisory-reviewer` 提供 investigation 审查；如果当前环境没有这条 dedicated reviewer 路径，回退到 `context-mapper` + `imm-code-review` + 当前 step 的最小 repro notes，而不是把它提升成默认 gate。

`debug_hypothesis` 仍保持“explicit trigger + fallback”模式；条件风险 reviewer 以及 `docs`、`prompt_contract`、`release_readiness`、`ai_eval` 已合并为 `imm-advisory-reviewer` 的 lens-based 模式（旧 `docs-verifier`、`prompt-contract-reviewer`、`release-readiness-checker`、`ai-eval-planner` skill surface 已删除）。后续若继续扩展，应优先新增 lens 或独立 project-specific slice，而不是回退成 shared runtime platform。

#### 场景化启用矩阵

不同用户和项目类型不应启用同一套 subagent 阵容。默认仍从核心闭环层开始，只有项目风险或交付方式需要时才增加条件风险层：

| Scenario | Default core subagents | Conditional risk subagents | Project-specific focus | Rationale |
|---|---|---|---|---|
| Personal projects | `context-mapper`、`scope-reviewer`、`planner`、`executor`、`qa-verifier` | 仅在涉及 auth 或数据迁移时启用 `security`、`data_integrity` lenses | 保持低 ceremony；公开发布前按需补 `release_readiness` lens，完成后再考虑 `knowledge-compounder` | 个人项目最容易被流程成本拖慢，核心闭环足够保证可重入和可验证 |
| Startup product teams | 核心闭环全量可用，重点使用 `scope-reviewer`、`code-reviewer`、`knowledge-compounder` | 按 diff 触发 `api_contract`、`reliability`、`security` lenses | 快速迭代时只在 ship 前补 `release_readiness` lens，不默认拉满项目专用 agent | 创业团队需要速度和边界控制，条件风险层应服务于关键变更面，项目专用层只在交付前补强信心 |
| Mature SaaS | 核心闭环全量可用，`code-reviewer` 和 `qa-verifier` 更常驻于 PR/step 闭合 | 频繁按需启用 `security`、`data_integrity`、`api_contract`、`reliability` lenses | release 时补 `release_readiness` lens，incident 时再启 `debug_hypothesis` lens | 成熟 SaaS 的 blast radius 更大，风险 subagent 应由变更面触发，项目专用层则面向发布与故障场景 |
| AI/agent projects | 核心闭环全量可用，`context-mapper` 和 `scope-reviewer` 用于明确 agent 权限边界 | 优先按需启用 `security` lens | `prompt_contract`/`docs`/`ai_eval` lens 只在 AI 行为、工具契约、评估设计或外部说明面被触发时加入 | AI/agent 项目的主要风险来自行为不稳定、指令冲突和工具权限，需要把评估和契约作为项目专用证据，而不是默认 gate |
| Open-source SDK/CLI projects | 核心闭环全量可用，重点使用 `code-reviewer`、`knowledge-compounder` | 按需启用 `api_contract`、`security` lenses | `docs`、`release_readiness` lens 只在 public API、CLI UX 或发布说明需要时加入 | SDK/CLI 的用户影响主要体现在 contract、文档和升级路径，项目专用层要面向外部消费者而不是默认扩大流程 |

#### 首版 Non-goals

system subagents 的首版只做治理与契约，不做以下事情：

- 不实现完整自动调度平台或 runtime registry。
- 不复制任何上游项目的完整 agent roster。
- 不允许 subagent 绕过 `imm-loop` 激活 step、绕过 internal executor 改实现，或绕过 internal QA 记录闭合结论。
- 不引入 agent-to-agent 通信、长期 party state 或全局 subagent memory。
- 不在首版默认常驻大规模项目专用 roster。
