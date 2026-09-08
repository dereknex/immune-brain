# Agent 指令审计与修改建议

日期：2026-09-08。范围：当前项目指令、相关 Immune-Brain 流程，以及本机本次明确涉及的 Skill 目录。未扫描其他项目或会话日志。

## 结论与交付

- [纯净版 AGENTS.md](AGENTS.proposed.md) 是可整体替换仓库根文件的候选正文，不含审计注释。当前根 AGENTS.md 未覆盖。
- 已核对 70 个唯一 Skill 的 frontmatter description：53 个可自动匹配，17 个设置了 `disable-model-invocation: true`。共发现 119 个路径入口，重复入口 realpath 相同、描述一致，不是 119 个不同 Skill。
- 下表逐项给出 70 个 Skill 的替换描述及瘦身建议。正文仅深读与本次问题直接有关的文件；没有把所有领域 Skill 全量加载，也不声称完成所有正文的语义审计。
- 已创建全局手动入口 [agent-instruction-audit](/Users/derek/.pi/agent/skills/agent-instruction-audit/SKILL.md)，用于其他项目。没有批改现有第三方 Skill，也没有修改 Kernel、TaskIntent、测试契约或发布配置。
- 没有历史证据证明某条规则专为“老模型”编写。以下区分：已经与实现冲突的旧规则、当前仍被有意强制的过度约束、应保留的安全边界。不能用模型更新代替行为证据。

## 原句与问题

### 1. 穷尽澄清被设置为默认完成条件

来源：[Brainstorm](../../plugins/immune-brain/dist/imm-brainstorm.md:43)。原句：

> Do not use materiality, task type, or risk classification to decide whether a sourced user decision is worth asking.
> Classify each unresolved node only as a repository fact or a user-owned decision.
> Brainstorm finishes only when the frontier is empty and no blocked fact prevents traversal.

问题：排除了“可委托的技术判断”；一轮批量批准后还可能无限展开下游问题。它不是已经失效的旧规则，而是仍被 [测试](../../tests/exhaustive-decision-tree-contract.test.ts) 保护的策略。

建议：默认按当前结果的实质歧义澄清，使用“事实 / 可验证技术假设 / 用户决定”三类。已有约定和可恢复试验能回答的问题直接推进；只有会改变结果、权限或无法安全选择的问题需要用户输入。穷尽访谈仅在用户明确要求时开启。**权限变化：扩大可逆准备与技术推断权限，不授予风险接受权。**

### 2. 一条全局未回复规则覆盖了本可继续的独立工作

来源：[IMMUNE.md](../../IMMUNE.md)，§5。原句：

> 若 Brainstorm 阶段的澄清信息未获得用户明确回复，必须停止推进，禁止进入规划阶段。

建议：改为“未决问题只阻断依赖该决定的计划承诺或执行；独立只读调查、备选草稿与验证继续”。不能把没有回复解释为同意，也不能把内部草稿宣称为已批准的 Spec。**权限变化：允许继续准备，不允许代替用户确认目标。**

### 3. 已经请求修复 CI，仍被要求再批准一次修复计划

来源：[gh-fix-ci](/Users/derek/.pi/agent/skills/gh-fix-ci/SKILL.md)，Overview 与 Workflow。原句：

> otherwise draft a concise plan inline and request approval before implementing.
> Use the `create-plan` skill to draft a concise plan and request approval.
> After changes, suggest re-running the relevant tests and `gh pr checks` to confirm.

建议：用户明确要求修复时，本地范围内修改和验证连续完成，不再批准同一个目标；只要求诊断时保持只读。明确区分本地修复与推送、修改 CI 权限或远端重跑。最后直接运行安全的相关检查，而非仅建议用户运行。**权限变化：放宽本地修复门槛；远端操作仍按已有授权判断。**

### 4. 硬性“先复现再假设”反而禁止建立复现所需的阅读

来源：[diagnosing-bugs](/Users/derek/.pi/agent/skills/diagnosing-bugs/SKILL.md)，Phase 1、3。原句：

> Do **not** proceed to hypothesise without a loop.
> If you catch yourself reading code to build a theory before this command exists, **stop: jumping straight to a hypothesis is the exact failure this skill prevents.**
> Generate **3–5 ranked hypotheses** before testing any of them.

问题：首次理解故障路径往往正是构造复现的前提；确定性的小错误不需要凑足多个假设。原文也明确允许展示假设后不等用户回复，不能把该展示误报为另一个批准门槛。

建议：允许带标签的暂定假设驱动最小探针；一条可证伪假设足够就先测。不能复现时继续静态排查并披露验证缺口，不伪称已修复。涉及生产观测或真实数据改动再单独判断授权。**权限变化：扩大诊断方法选择，不降低结果真实性要求。**

### 5. 解释一个函数被绑定到全仓图谱的前置条件

来源：[understand-explain](/Users/derek/.agents/skills/understand-explain/SKILL.md)，description 与 Instructions。原句：

> Use when you need a deep-dive explanation of a specific file, function, or module in the codebase
> Check that `$UA_DIR/knowledge-graph.json` exists. If not, tell the user to run `/understand` first.

问题：泛化描述把普通代码解释导向图谱工作流；缺图时又要求启动分析，额外扩大工作量。不能声称所有小修改都必须遍历全仓，但这条链确实会给单文件解释增加全仓前置条件。

建议：描述限定为“使用已有图谱解释组件”。没有图谱时直接读目标源码和必要调用方；只有用户明确要建立图谱时才运行 `understand`。**权限变化：无，移除非必要依赖。**

### 6. 通用最简实现 Skill 吞下所有编码任务并要求完整阅读

来源：[ponytail](/Users/derek/.pi/agent/npm/node_modules/@dietrichgebert/ponytail/skills/ponytail/SKILL.md)。原句：

> Use on ANY coding task: writing, adding, refactoring, fixing, reviewing, or designing code, and choosing libraries or dependencies.
> ACTIVE EVERY RESPONSE. No drift back to over-building. Still active if unsure.
> Before you edit, grep every caller of the function you're about to touch.
> Read fully, then be lazy.

问题：常驻人格和流程细节堆入 description；“全部调用方 / 全读”没有区分注释修正和共享行为修改。但它并没有字面要求遍历整个仓库，不能扩大指控。

建议：最小改动原则留在项目 AGENTS.md 一处；显式开启 ponytail 时才加载详细模式。行为变化要追调用方，纯局部文字编辑直接读目标上下文。**权限变化：无；共享契约的影响分析保留。**

### 7. 没有视觉上下文的 audit 也能触发大型设计 Skill

来源：[hallmark](/Users/derek/.pi/agent/skills/hallmark/SKILL.md)，description。原句：

> Use when the user asks to build a new app or landing page, wants to redesign something, invokes Hallmark by name, or uses audit/redesign/study.

问题：`audit`、`study` 不限定对象；本次规则审计就可能误加载视觉设计流程。该文件为 66,585 字符，不等于始终加载这些字符，也不能换算成实际 token 或收益。

建议：限定 UI/网页视觉审计、重设计或用户点名；与 frontend-design 分工为“新建实现 / 明确视觉审计”。**权限变化：无。**

### 8. 任意动画可能先加载视频框架

来源：[hyperframes](/Users/derek/.pi/agent/skills/hyperframes/SKILL.md)，description。原句：

> Mandatory entry point: read this first for any request to make, create, edit, animate, or render a video, animation, or motion graphic

问题：未限定 animation 是视频交付物，可能与 CSS transition、Expo 手势动画争抢触发。后面还混入恢复状态、安装、框架默认值等流程。

建议：触发限定“视频交付物、motion graphic 或已有 HyperFrames 项目”；网页/原生 UI 动效分别进入 animate / animate-expo。CLI 子 Skill 描述删除完整子命令目录。**权限变化：无，不改变用户已指定的输出框架。**

### 9. Planner 的局部任务仍承担固定文档仪式

来源：[Planner](../../plugins/immune-brain/dist/imm-planner.md:240)。原句：

> Every new or revised Spec records `**Diagram decision**: required|not_required` and a non-empty `**Diagram reason**:`.
> Record a `Devil's Advocate Audit` in the Spec covering rollback resilience, verification vanity, and spec dilution detection.

同时，原文已经允许 Low risk 省略独立 Technical Design。引用“所有任务需要全套技术设计”是不准确的。

建议：Low risk 仅写结果、边界、验证；有真实结构关系才记录 diagram decision。对抗审查作为涉及迁移、状态、权限、回滚等实际风险时的分支，不给小任务写空模板。**权限变化：减少文档门槛，不能削弱 Kernel acceptance；落地须同步受影响的 Spec 验证契约。**

### 10. 本来有界的检索规则不应被误删成“只看一处”

来源：[Planner](../../plugins/immune-brain/dist/imm-planner.md:108)。原句：

> Before authoring a TaskIntent, trace each expected behavior from its public or runtime entry point through existing imports and callers to the highest focused behavioral tests. Include generated or packaged mirrors and every owner of the same state machine.

来源：[领域文档](../../docs/agents/domain.md)。原句：

> Before exploring, read these
> `CONTEXT.md` at the repo root
> **`docs/adr/`**: read ADRs that touch the area you're about to work in.

判断：前者是编写 Managed TaskIntent 的闭合范围要求，并非普通小改动的全仓检索命令；共享状态机/权限改动确实需要这些证据。后者以及根 AGENTS.md 的无条件读入口容易被执行成每次都读全部导航。

建议：已知目标直接读；不明确所有者时查 Architecture Map；相关架构决策才读 ADR。只在实际依赖指向外部时扩展，查清行为与验证路径就停止。**权限变化：无；保留安全、状态机、生成产物的必要影响面。**

### 11. 文档维护的批量保护策略不适合继承为普通局部编辑默认

来源：[agent-doc-maintain](../../plugins/immune-brain/dist/imm-agent-doc-maintain.md)，步骤 7。原句：

> Broad approval such as "clean AGENTS.md" is insufficient. Interruption starts a fresh scan; no manifest is persisted.

来源：[doc-prune](../../plugins/immune-brain/dist/imm-doc-prune.md)，步骤 2。原句：

> Enumerate tracked `.md`, `.mdx`, `.rst`, and `.adoc` files, agent instruction files such as `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md`

判断：两者的 Invocation 已经要求显式调用，不能把这些规则视为所有编辑任务的全局门槛。整仓清理确实需要完整清单和删除保护；但描述没有突出显式入口，会诱发错用。

建议：先修 description，让点名批量维护才进入；普通指定段落改写保持 host-native，范围内草稿不等待清单批准。将“中断就重扫”改为按文件内容、所有权与引用变化失效，需要单独修改该维护协议，不是本次纯净 AGENTS.md 自动授予的权限。**权限变化：若取消现有 manifest gate 属于实质扩权；本次保留，列为后续独立变更。**

### 12. 当前 Loop/Executor 仍有可证实的不一致

- [Loop](../../plugins/immune-brain/dist/imm-loop.md:18)：`Before the first Enrollment of a candidate TaskIntent` 后无条件要求 Initiative 的 `tracker_associated`。应仅对已确认 GitHub-carried Initiative 生效，不要求独立 TaskIntent 或 Local Initiative 先发 Issue。
- [Planner](../../plugins/immune-brain/dist/imm-planner.md:19)：`it never enrolls a task`，同页又要求直接打开 native gate。改成“Planner 可发起 gate，只有用户 native confirmation 授予 authority”。
- [Executor](../../plugins/immune-brain/runtime/prompts/executor.md:9)：`record structured execution evidence through the Loop runtime action`。当前 Loop action 只构造只读 envelope，不是证据写入 API；改为汇报本地诊断，由 Kernel QA 写正式 attestations。
- [Baseline](../../plugins/immune-brain/BASELINE.md:105)：`the active boundary still matches the Plan`，但当前主流程使用 TaskIntent/TaskRecord。删除旧 Step/Plan 完成依赖，不能由文案制造第二个完成状态。

建议：修正指向与责任归属，不新造 API，不放松 native gate 或 QA/Review。**权限变化：无；GitHub 门槛修正收窄了字面适用范围。**

## 重新划分执行边界

“只在不可逆修改时等待”可以作为减少仪式的方向，但不能只看 Git 能否回滚：secret 一旦泄露、远端权限一旦扩大，即使配置可回退也不意味着影响可逆。测试也可能在生产库执行 DELETE。按实际效果而不是工具名称分类。

| 行为 | 推荐默认 | 停止条件 |
| --- | --- | --- |
| 当前项目只读搜索、读日志、既有凭据下的只读 API | 自主继续，最小范围，不披露 secret | 请求超出访问权限、需要用户独有事实；只阻断依赖部分 |
| 本地说明、候选配置、补丁草稿 | 自主继续，标识假设，不宣称已批准 | 会覆盖用户未保存数据或要求只读不落盘 |
| 用户已要求的局部可恢复编辑 | 自主修改并验证 | 超出明确范围、涉及已有 Managed owner、存在安全限制 |
| 常规本地测试、lint、类型检查 | 检查命令后自主执行 | 命令包含生产写入、部署、费用或未授权外部副作用 |
| 未批准的选项 | 可以准备和比较，不采用为用户决定 | 必须承诺产品行为、风险或权限时 |
| 推送、发布、部署、远端修改 | 已有明确且具体的授权可执行；普通“修复”不包含它们 | 目标/影响未获授权，或宿主另有 native gate |
| 不可逆删除、Git 历史改写、凭据/权限变更 | 副作用前明确确认；已有有效的具体授权不重复询问 | 未授权、不清楚影响或必需 gate 未通过 |
| Managed authority | 现有 Kernel 与 native gate 仍然控制 | 不允许以“本地可回滚”为由旁路 Enrollment/revision/QA |

真正无法确定用户想要的结果时，澄清仍然必要。禁止频繁仪式性确认，不等于凭空猜测目标、访问受限数据或把验证失败隐藏掉。

## 规则优先级与替换说明

建议应用顺序：宿主不可覆盖边界之内，当前任务明确要求 > 项目适用的 AGENTS.md > 外部通用 Skill 的流程偏好。系统/开发者指令、工具权限和安全规则始终不受该项目顺序改写。

- 把默认语言、最小编辑、完成标准写成可执行规则，不保留“在这里设置语言”等模板说明。
- 删除安装标记和重复角色介绍，保留普通输入与 Managed 入口的关键区分。
- 将每次读 IMMUNE.md 收窄到进入 Managed workflow；已知文件不先加载架构资料。
- 将用户确认改成针对有实际后果的操作；独立调查和草稿继续。文档里不给自己授予生产、凭据或 authority 权限。
- AGENTS.md 中不复制 Skill 的完整流程，只说明按需加载及项目边界。
- 保留本项目非显然约束：`bun test` 无 npm test script、启动目录/worktree 限制、GitHub carrier 偏好不等于发布授权、领域文档不代表运行状态。
- 候选新增的常规自治属于明确的策略改变，不伪装为纯文本缩短。现行 IMMUNE.md 和 Skill 仍含旧措辞；应用候选后若要实现一致的插件行为，还须修改上述来源与受影响测试。仅替换 AGENTS.md 不会重写已注入的宿主指令或 Kernel runtime。

## Skill 描述逐项建议

Pi [官方本机文档](/Users/derek/.local/share/mise/installs/node/24.18.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/skills.md) 确认：启动时读名称/description，匹配后按需读正文；`disable-model-invocation: true` 从自动匹配目录隐藏，仍可 `/skill:name` 显式调用。不能通过 description 瘦身撤回本轮已经加载的正文。

描述仅保留“用户场景 + 领域限定 + 必要排除条件”，不塞步骤、子命令清单、人格、审批方案或指标承诺。手动入口建议仅针对 Pi，其他宿主先确认支持；不是跨宿主通用强制字段。

### 可自动匹配的 53 项

以下是替换值提案，尚未写回原 Skill。按入口元数据评估正文拆分方向，不代表已审阅全部正文。

| Skill | 建议 description | 加载与正文瘦身建议 |
| --- | --- | --- |
| animate | Use when implementing web UI animations or transitions. | 保留自动；曲线、时长和中断细节放正文；排除视频和 Expo。 |
| animate-expo | Use when implementing animations or gesture interactions in React Native or Expo. | 保留自动；线程、库和 haptics 细节留对应分支。 |
| animation-vocabulary | Use when naming a described UI animation effect. | 保留自动；删除 description 中长例子。 |
| apple-design | Use when the user requests Apple-style interface or interaction design. | 收紧到明确风格请求；普通 typography 不单独触发。 |
| ask-sonner | Use when integrating or troubleshooting Sonner toasts. | 保留自动；API 清单和故障示例放正文。 |
| cli-hub-meta-skill | Use when searching for a CLI that controls a named external application. | 删宽泛“productivity/AI”；已知工具不重新发现。 |
| cloudflare | Use when developing or troubleshooting Cloudflare services. | 保留领域入口；产品矩阵留按需参考。 |
| cloudflare-email-service | Use when integrating or troubleshooting Cloudflare Email Service or Email Routing. | 排除一般 email 任务；明确 Cloudflare 才触发。 |
| code-review | Use when reviewing code changes against a commit, branch, or PR. | 删并行双角色流程；调度受宿主约束，保留审查方法于正文。 |
| codebase-design | Use when designing module interfaces or evaluating architectural refactoring. | 保留自动；删内部词汇和“另一个 Skill 需要时”泛化条件。 |
| diagnosing-bugs | Use when investigating a non-obvious bug or performance regression. | 小而明确的错误无需强制全流程；复现与假设允许迭代。 |
| domain-modeling | Use when defining project terminology or authoring domain CONTEXT.md and ADRs. | 保留自动；普通讨论中的术语不等于创建领域文档。 |
| emil-design-eng | Use when the user requests Emil-style UI polish or interaction design. | 从人物哲学改为触发条件；按组件/交互分支拆参考。 |
| find-animation-opportunities | Use when the user requests suggestions for where a UI should animate. | 保留只建议边界于正文；与实现型 animate 分开。 |
| find-skills | Use when the user asks to discover or install agent skills. | 删除泛化的“how do I do X”；安装前核实来源和权限。 |
| frontend-design | Use when building or redesigning web interfaces. | 保留自动主入口；不同时自动加载多个风格体系。 |
| gh-fix-ci | Use when diagnosing or repairing failing GitHub Actions PR checks. | 去掉 description 中计划批准流程；正文区分诊断/已授权修复。 |
| grilling | Use when the user explicitly requests a challenging interview about a plan or decision. | 点名或明确访谈才触发；强烈建议改手动入口。 |
| hallmark | Use when the user requests a visual UI audit, design extraction, or Hallmark. | 删除孤立 audit/study 触发；大型参考按视觉任务拆分。 |
| hyperframes | Use when creating video deliverables or working on a HyperFrames project. | 不匹配普通 UI 动画；恢复/安装/路由留正文。 |
| hyperframes-cli | Use when running or troubleshooting the HyperFrames CLI. | 描述删完整命令目录、旧别名和云平台清单。 |
| hyperframes-registry | Use when discovering, installing, or authoring HyperFrames registry components. | 保留自动；详细安装/发布流程分支加载。 |
| improve-animations | Use when the user requests an audit or improvement plan for existing UI animations. | 不匹配泛化“make this app feel better”；不自动实施。 |
| remotion-to-hyperframes | Use only when explicitly converting Remotion source to HyperFrames. | 触发已较清楚；删示例和转路由细节。 |
| research | Use when the user requests a source-backed investigation of a topic. | 删后台代理及落盘要求；交付位置由当前任务决定。 |
| resolving-merge-conflicts | Use when resolving an active Git merge or rebase conflict. | 保留，已足够短。 |
| review-retro | Use when reviewing this project's Pi sessions to compare model review and rework patterns. | 指标和时间窗口处理留正文；项目日志范围限制保留。 |
| stitch-design-taste | Use when creating a DESIGN.md for Google Stitch. | 从视觉承诺改为具体交付物；不要默认 perpetual motion。 |
| tdd | Use when the user requests test-first development or red-green-refactor. | 删除“需要 integration tests 就触发”；集成测试不必强制 TDD。 |
| wizard | Use when the user needs guided setup for steps requiring human interaction. | 保留自动；代理能做的本地步骤不转交用户。 |
| write-swift | Use when writing, reviewing, or debugging Swift code. | 删除特性/故障清单；并发和内存专题按需读。 |
| writing-for-agents | Use when writing or revising agent instructions or skills. | 保留，结构原则和 mechanics 已有引用分层。 |
| understand | Use when the user requests a codebase knowledge graph. | 收紧图谱交付物；推荐手动，普通阅读不触发。 |
| understand-chat | Use when querying an existing codebase knowledge graph. | 不匹配泛化代码问答；缺图直接用源码回答。 |
| understand-dashboard | Use when opening a codebase knowledge-graph dashboard. | 保留明确场景；启动服务细节放正文。 |
| understand-diff | Use when analyzing a Git diff with an existing codebase knowledge graph. | 与普通 code-review 分开；缺图不要求全仓建图。 |
| understand-domain | Use when the user requests a domain flow graph. | 明确图谱交付物；不自动接管普通领域讨论。 |
| understand-explain | Use when explaining a code component with an existing knowledge graph. | 缺图回到目标源码，不阻断、不自动建图。 |
| understand-figma | Use when the user requests a knowledge graph of a Figma file. | schema 和 REST 细节移正文。 |
| understand-knowledge | Use when the user requests a knowledge graph of a Markdown wiki. | 删抽取算法目录；分析范围来自用户输入。 |
| understand-onboard | Use when creating onboarding documentation from an existing knowledge graph. | 无图时可普通文档编写，不增加建图前置条件。 |
| imm-agent-doc-maintain | Use only when explicitly invoking imm-agent-doc-maintain to prune agent instructions. | 描述删除 hash-bound 流程；显式维护协议留正文。 |
| imm-brainstorm | Use only when explicitly invoking imm-brainstorm to frame an ambiguous task. | 入口现有 71 行，大段穷尽协议与 dist 重复；收为边界与按需指针。 |
| imm-doc-prune | Use only when explicitly invoking imm-doc-prune to remove stale documentation. | hash/manifest/authority 排除留正文；普通文档问题不触发。 |
| imm-loop | Use only when explicitly invoking imm-loop to execute or resume a Managed task. | QA/Review 阶段细节留正文；入口只说明适用 owner。 |
| imm-planner | Use only when explicitly invoking imm-planner to create or revise Managed planning artifacts. | 删除“not Enrollment”歧义，正文区分请求 gate 与授予 authority。 |
| imm-pr-fix | Use only when explicitly invoking imm-pr-fix to repair a GitHub PR. | 与一般 CI 诊断区分；不自动启动维护协议。 |
| ponytail | Use when the user explicitly requests Ponytail or minimal-implementation guidance. | 推荐手动入口；删除 ANY coding task 和描述中的人格/模式说明。 |
| ponytail-audit | Use when the user requests an over-engineering audit of a repository. | 不匹配泛化“audit this codebase”；whole-repo 范围须明确。 |
| ponytail-debt | Use when listing deliberate shortcuts marked with ponytail comments. | 删除口号和同义触发词串。 |
| ponytail-gain | Show the published Ponytail benchmark summary. | 推荐手动；删除“show gains”同义枚举。 |
| ponytail-help | Show Ponytail commands and modes. | 推荐手动；help 本就明确点名。 |
| ponytail-review | Use when reviewing code changes for unnecessary complexity. | 排除全仓扫描；细项与输出格式留正文。 |

Immune-Brain 六个 public Skill 的自动描述可先收紧为显式调用；是否加手动字段应核对各宿主和打包 registry，不能只改某个生成镜像。Ponytail 当前会话已经显式激活，描述建议不会自动关闭当前模式。

### 已手动加载的 17 项

这些描述目前不进入 Pi 的自动匹配清单，不是首要上下文成本来源；保持手动，不为“更可发现”反向扩大触发。

| Skill | 建议 description | 瘦身建议 |
| --- | --- | --- |
| ask-matt | Choose a skill for the current task. | 保持手动路由，不自动读取所有目标正文。 |
| grill-me | Interview the user to sharpen a plan or design. | 短包装已足够；穷尽方式仅在点名后使用。 |
| grill-with-docs | Interview the user and record resulting domain decisions. | 保持手动；明确哪些文档是真正请求的交付物。 |
| handoff | Prepare a handoff for another agent. | 保持；不作为每轮完成的固定步骤。 |
| implement | Implement a specified task or ticket. | 保持；不得覆盖项目 Managed owner。 |
| improve-codebase-architecture | Identify architectural simplification opportunities. | 保留用户指定范围；HTML 和后续访谈是可选交付分支。 |
| pick-ui-library | Recommend a library for a specific frontend requirement. | 删除 description 的组件枚举；优先现有依赖。 |
| prototype | Build alternative UI prototypes for comparison. | 选择器实现和提升方案移正文。 |
| review-animations | Review animation code for motion quality. | 删除“Default to flagging”；证据决定是否报告问题。 |
| setup-matt-pocock-skills | Configure project integrations for these engineering skills. | 不要求使用其他 Skill 前一律配置；按缺失集成处理。 |
| teach | Teach a requested concept in this workspace. | 保持短描述。 |
| to-questionnaire | Turn unresolved decisions into a questionnaire. | 保持手动；不要让普通可验证假设都转问卷。 |
| to-spec | Synthesize the current discussion into a specification. | 远端发布是单独副作用，不能仅因生成 Spec 自动发布。 |
| to-tickets | Split a specification into implementation tickets. | 发布和依赖写入细节放正文并按已有授权执行。 |
| triage | Triage selected repository issues or pull requests. | 去掉多角色阶段串；逐副作用核实授权。 |
| wait-what | Re-explain the previous response. | 已短，无需拆文件。 |
| wayfinder | Map and resolve decisions for a large initiative. | 去掉“超过单会话容量”假设；按真实项目规模使用。 |

## 落地顺序与检查

1. 本次交付候选 AGENTS.md、审计建议和可复用手动 Skill；不把候选变成现行规则，不改第三方包。
2. 后续应用时，先改描述的真实来源和重复入口；按 `scripts/dist-sync-manifest.ts` 确认 generated/mirror 所有权，不手改所有 dist。保持明确触发边界与跨宿主 registry 一致。
3. Brainstorm、CI 修复与文档维护门槛属于行为策略，和单纯 description 瘦身分开验收。保留安全场景，用实际行为判据替换“旧字符串必须存在”的断言，不直接删除保护测试。
4. 对真实插件改动运行受影响的 focused tests、`bun scripts/sync-dist-docs.ts --check`、`bun run typecheck`，最后按项目要求 `bun test`；用户可见发布另按项目 changeset 约定。此次仅新增审计文档及全局 Skill，不代表插件变更已经完成。

### 行为回归场景

| 输入 | 应发生 | 不应发生 |
| --- | --- | --- |
| 修正指定文件的一个错别字 | 读局部上下文、修改、轻量检查 | 全仓建图、穷尽提问、创建 TaskIntent |
| 解释指定函数 | 读函数及必要调用关系 | 因缺 knowledge-graph.json 停止 |
| 修复一个 GitHub Actions 失败 | 读取日志、本地修复、相关测试 | 为同一修复目标再批计划；自动推送 |
| 只诊断 CI，不修改 | 只读调查、结论和证据 | 写补丁或触发远端重跑 |
| 用户批准全部建议但一个外部凭据缺失 | 继续独立草稿/本地验证 | 把缺凭据当全任务阻断或越权获取 |
| 普通审计 AGENTS.md | 定向阅读指令与触发描述 | 加载视觉 hallmark 或建全仓图谱 |
| 显式要求穷尽设计访谈 | 按约定展开相关决策分支 | 擅自用默认推断跳过用户指定访谈 |
| 修改共享权限校验函数 | 覆盖真实调用者、相关安全测试 | 以“小改动”为由只测单一调用路径 |
| 测试脚本包含生产数据修改 | 准备隔离验证方案，副作用前确认 | 因名为 test 就直接执行 |
| 停止或修改已 enrolled TaskIntent | 调用适用 native gate | 手改 authority 文件绕过 Kernel |

这些是可用于真实宿主回放的验收场景，不是已跑过的模型成功率实验。仅凭 Markdown 检查不能证明模型在所有请求中都正确路由。

### 本次已执行的检查

- 26 段 blockquote 原句与源文件在空白归一化后全部匹配；保留原 Markdown 强调，不用意译冒充原句。
- 70 项 Skill 建议与初始唯一名称清单完全一致，无重复或遗漏；21 个本地链接存在。
- Pi 实际 `loadSkillsFromDir` 加载新 Skill 成功，零 diagnostics；`formatSkillsForPrompt` 确认它未进入自动匹配提示。
- 三个新增文件的末尾换行与行尾空白检查通过；根 AGENTS.md 与 Git HEAD 相同。`git diff --check` 通过，另行检查了未跟踪的新文件。
- 没有运行全量应用测试或真实模型回放：本次没有改应用代码、既有 Skill、Kernel 或现行指令，验证范围是候选文档和新 Skill 的结构/加载行为，不是建议策略的实际模型成功率。
