## Archived 2026-05-15T14:09:42

- [2026-05-10] 完成 `051`/`052` 并 compound：051 引入 `upstreams/addy-agent-skills`、`docs/reference/addy-agent-skills-contrast.md`、hub 四件套 Rationalizations/Red Flags/Verification、`agent-quality-checklists` 索引与 README 入站简表；052 补齐 spec/plan/reference 入库与 051 spec 勾选；沉淀 `docs/solutions/addy-upstream-contrast-and-hub-anatomy-pattern.md`，并更新 iteration-plan hygiene 验证条目。
- [2026-05-10] 完成 `049`/`050` 闭环并 compound：`049` 固化 planner/preplan/IMMUNE/README 的粗粒度 outcome 规划与条件 preplan；`050` 将遗漏的 049 spec/plan 入库、`current_iteration.json` POSIX 换行尾；新增 `docs/solutions/iteration-plan-result-markers-and-repo-hygiene.md` 并扩展 `outcome-based-planning-steps.md`。
- [2026-05-10] 基于本轮 `review -> follow-up -> 解决` retrospective，规划 `2026-05-10-045-fix-review-followup-authority-gate-plan.md`：收窄到把 `append_to_plan` 的判定从 reviewer 输出移回 planner / planning validation，并增加 route-layer drift guard；不修 `.imm/imm-plan.py` 的 same-path signature reset，也不做历史 enum 全量重命名。
- [2026-05-10] 基于 `imm-code-review` 对 `043` 的 follow-up 审查，规划 `2026-05-10-044-fix-review-task-handling-followup-alignment-plan.md`：收窄到修复 route taxonomy 中 `append_to_plan` 的层级冲突，以及让 `MEMORY.md` 顶部 durable summary 与当前 runtime follow-up 状态重新对齐；虽然问题仍属 same-boundary repair，但因 `.imm/imm-plan.py` 的 same-path signature reset 会清空 `completed_steps`，本轮拒绝 `append_to_plan`，改走新的 narrow slice。
- [2026-05-10] 规划 `2026-05-10-043-feat-review-task-handling-workflow-plan.md`：完整收敛 review 任务处理 workflow，把 `rework`、same-boundary follow-up、`append_to_plan`、`new_slice` 与 `pr_blocker` 统一成一张 route matrix；因用户要求完整规划，当前 `042` 窄计划被新的总规划切片取代。
- [2026-05-10] 规划 `2026-05-10-042-fix-review-followup-imm-work-entry-plan.md`：把 same-boundary review follow-up 的默认继续入口收口到 `imm-work`，由 `imm-work` 内部承接 planner / append routing，同时保留 `imm-planner` 的 plan authority；不扩展到 route enum 重命名、自动建计划或自动执行。
- [2026-05-10] 完成 `2026-05-10-041-fix-install-local-copy-default-plan.md`：将 `install-local` 默认安装方式切换为 managed copy，移除 symlink 安装入口，补齐本地 runtime copy，并修复跨 checkout 的受管身份识别。
- [2026-05-10] 沉淀 repo-agnostic managed-copy marker 模式：对会跨 checkout 存活的全局安装产物，用 family/kind/name 类稳定 marker 识别受管 copy，并用 focused cross-checkout regression 锁住 `--check` / `--uninstall`。
- [2026-05-10] 完成 `2026-05-10-040-feat-subagent-runtime-mvp-plan.md`：把 `imm-code-review` 提升为首个 shared runtime host，限定 child reviewer 为 `security-reviewer` / `api-contract-reviewer`，补齐 runtime-hosted delegation packet、explicit fallback reasons、README runtime truth 与 focused regression，且不引入 shared platform。
- [2026-05-10] 沉淀 shared-runtime-host-before-platform 模式：当 standalone reviewer hosts 与 shared orchestration contract 已经就绪时，先让一个现有 orchestrator 承接第一条真实 delegation path，并用 focused regression 锁住 no-registry / no-dispatcher 边界，再决定是否需要更大的 runtime 平台。
- [2026-05-10] 完成 `2026-05-10-039-feat-workflow-entrypoint-telemetry-record-plan.md`：把手动 `imm-telemetry.py record` 接到 `imm-work`、`imm-review`、`imm-finish` 的真实 workflow transition，补齐 exact-env contract、estimated fallback，以及 failure-isolation focused regressions。
- [2026-05-10] 沉淀 workflow-entrypoint telemetry bridging 模式：当 raw telemetry schema 已存在但 trace 长期为空时，先把 hook 接到 repo-local workflow entrypoints，并用 exact-vs-estimated contract 与 failure-isolation regressions 锁住边界。
- [2026-05-10] 完成 `2026-05-10-037-fix-skill-baseline-followup-contract-regressions-plan.md`，修复 reviewer `append_to_plan` schema drift、`imm-work` 的 security-first arbitration truth、以及 baselined skills 的 shared baseline 引用路径，并补齐 focused contract-test guards。
- [2026-05-10] 沉淀 skill baseline follow-up 的 contract-truth guard 模式：在 prompt slimming / baselining 后，用同一个 focused contract suite 直接锁 reviewer route schema、security-first fallback 与 repo-local baseline path，避免再靠人工 review 才发现 drift。
- [2026-05-10] 基于 `imm-code-review` 对当前 baseline batch 的 follow-up 审查，规划 `2026-05-10-037-fix-skill-baseline-followup-contract-regressions-plan.md`：收敛到 reviewer artifact `append_to_plan` schema 对齐、`imm-work` 冲突仲裁 truth 恢复、shared baseline 链接修复，以及 focused contract-test guards；当前 runtime 无 active plan，因此走新的 narrow slice 而不是 `append_to_plan`。
- [2026-05-10] 完成 `2026-05-10-003-feat-standardize-reviewer-delegation-packets-plan.md`：标准化 Reviewer 分层通讯契约，提升跨 Agent 协作效率。
- [2026-05-10] 完成 `2026-05-10-002-feat-skills-baselining-batch-2-plan.md`：完成全量 22 个技能的基线化，整体减重 65%。
- [2026-05-10] 完成 `2026-05-10-001-feat-skills-efficiency-improvement-plan.md`：建立技能基线机制，实现核心技能大幅瘦身。
- [2026-05-10] 规划并启动 `2026-05-10-005-feat-knowledge-debt-elimination-plan.md`
：执行历史债清理，优化扫描器并回灌 7+ 高置信度知识点。
- [2026-05-10] 完成 `2026-05-10-032-feat-subagent-activation-audit-plan.md`：审计并确认全系统符合 default-subagent-first 与 solo-fallback 策略。
- [2026-05-10] 规划并启动 `2026-05-10-001-feat-skills-efficiency-improvement-plan.md`
：建立 `skills/BASELINE.md` 基线，推行 Role Delta 模式与标准化分层 delegation packet，减少 146KB 的 context 冗余。
- [2026-05-10] 完成 `2026-05-10-036-fix-subagent-first-followup-alignment-plan`
，补齐 README 顶部入口模板的 `subagent-first` 直达摘要与 shared spec source-of-truth focused regression，并更新 `workflow-skill-orchestration-contract` solution，明确“可清晰拆分即默认 bounded subagents，solo 仅作显式 fallback”。
- [2026-05-10] 重新检查 `033` 实现并基于 review follow-up 规划 `2026-05-10-036-fix-subagent-first-followup-alignment-plan`：收窄到 README 顶部模板摘要对齐和 shared spec source-of-truth regression coverage；因当前 runtime 已不再保留 `033` 为 current plan，拒绝 `append_to_plan`，改走新的 narrow slice。
- [2026-05-10] 完成 `2026-05-10-035-fix-plan-sync-enforcement-followup-plan`，修复 `imm-plan` sync 失败仍成功、same-path signature change 沿用旧 closure，以及 `imm-work` 越权写 plan-level runtime state，并沉淀 `validated-plan-sync-ownership` 模式。
- [2026-05-10] 基于 `imm-code-review` 对 `034` 的 3 个高风险 finding，规划 `2026-05-10-035-fix-plan-sync-enforcement-followup-plan`：收敛到 sync failure 必须硬失败、same-path signature change 失效旧 closure，以及 `imm-work` 不再绕过 `imm-plan` 写 plan-level runtime state。
- [2026-05-10] 规划 `2026-05-10-034-fix-imm-plan-state-sync-plan`，明确任何 plan 变更都通过 `imm-plan` 成功验证后更新 `.imm/memory/current_iteration.json` 的同步真源，防止由 `imm-work` 承担计划级状态写入。
- [2026-05-10] `032` 审计型切片在 autowork 中命中 `replan`：纯 read-only audit step 无法通过现有 `imm-executor` / `imm-qa` 生命周期闭环，因此改规划为 `033` 可执行 contract-alignment slice，直接修复共享 subagent-first truth。
- [2026-05-10] 规划并启动 `2026-05-10-032-feat-subagent-activation-audit-plan`：新增 `.imm/specs/subagent-activation-default-review.spec.md` 与计划，审核仓库内 subagent 激活策略是否已满足默认优先并行激活 + solo fallback 并形成合规/不一致结论。
- [2026-05-09] 规划 completed-plan follow-up append 切片，收敛到 reviewer `append_to_plan` 路由、planner 对当前 completed plan 的 in-place append、`imm-work`/README 路由说明，以及 focused runtime + contract tests；不扩展到 finish 后 reopen 或新的 runtime state 字段。
- [2026-05-09] 规划 orchestration review follow-up 直修切片，收敛到 `MEMORY.md` 顶部摘要与当前完成态对齐，以及收紧 planner-oriented contract test 断言，不扩展到新的 orchestration 规则或 runtime 机制。
- [2026-05-09] 规划 workflow skill -> subagent orchestration 切片，收敛到“先判定是否拆分、保持 `imm-brainstorm -> imm-preplan-review -> imm-planner -> imm-work -> imm-executor/imm-qa -> imm-finish` 主链、在 `imm-planner` / `imm-work` 前并行收敛 reviewer、并用 retry-once + 固定优先级仲裁回退”的 repo-local contract，不扩展到通用调度器或自动执行。
- [2026-05-09] 规划 direct skill trigger templates 路由切片，收敛到“需求不清 -> `imm-brainstorm`、需求明确 -> `imm-planner`、并行审查 -> `imm-code-review` + 条件 `security-reviewer`、执行推进 -> `imm-work`”的 repo-local contract，不扩展到通用分类器或自动 reviewer 编排。
- [2026-05-09] 复用并验证 `imm-party` subagent delegation 计划，确认现有 spec/plan 已覆盖当前 `Scope Reduction` 边界，并将 durable summary 收敛到 `imm-party` 的显式 delegation runtime slice。
- [2026-05-09] 完成 review follow-up handoff 切片，并沉淀 reviewer 输出 bounded `follow_up` handoff、planner 消费映射、README 用户路由说明与 focused contract-test 守卫。
- [2026-05-09] 规划 `review follow-up handoff` 切片，收敛到 review 输出补齐 planner-ready handoff、`imm-planner` 消费规则、reviewer family 路由一致性，以及 focused contract tests；不扩展到自动建计划或自动修复。
- [2026-05-09] 完成 solution truth drift follow-up，并将 `conditional-risk-reviewer-activation-hosts` 模式文档对齐到当前 reviewer activation truth 与 38 条 contract tests。
- [2026-05-09] 规划 solution truth drift follow-up，收敛到修复 `docs/solutions/` 中过期的 reviewer activation 描述，不回头改 reviewer runtime 行为或 shared runtime 设计。
- [2026-05-09] 完成 remaining subagents rollout：补齐 `reliability-reviewer`、`release-readiness-checker`、`debug-investigator` 的 docs-first contract、runtime host、README 路由说明与 repo-level regression truth，保持 standalone host + trigger-only + fallback，而不引入 shared runtime 平台。
- [2026-05-09] 规划 `data-integrity-reviewer` 下一条 single-slice runtime activation 预备工作（不扩展 registry/shared runtime）
- [2026-05-09] 规划 remaining first-batch runtime activation，收窄到 `security-reviewer` 与 `api-contract-reviewer` 两条 conditional-risk reviewer host，避免把全 README roster 一次性扩成 shared runtime 平台。
- [2026-05-05] 初始化目录结构与《系统宪法》 (IMMUNE.md)。
- [2026-05-05] 编写 Rehydration 功能规格说明书。
- [2026-05-05] 实现基础自愈扫描器 (Heal)。
- [2026-05-06] 建立 plan/work/review 小步主循环的本地基础工件。
- [2026-05-07] 规划 BMAD 多角色 Party 会诊能力的 Immune-Brain 接入边界。
- [2026-05-07] 沉淀跨项目 skill 路由守卫模式，避免 brainstorm 后续实现绕过 plan/work。
- [2026-05-07] 沉淀只读多角色会诊层模式，明确 party 输出只能作为 preplan research。
- [2026-05-07] 规划 outcome-based step planning，移除固定 step 数量作为计划质量标准。
- [2026-05-07] 沉淀结果驱动 step 粒度模式，避免固定数量和动作清单污染计划。
- [2026-05-07] 规划 single-step orchestration，让 `imm-work` 成为计划后的单步继续入口。
- [2026-05-07] 沉淀单步编排入口模式，用 `next_action` 顺滑路由而不合并执行与验收权限。
- [2026-05-07] 规划 Codex-native interaction contract，让 Immune-Brain 更好利用 Codex 交互能力但不扩大执行权限。
- [2026-05-07] 沉淀 Codex-native interaction contract 模式，统一状态、下一动作、权限边界和能力钩子。
- [2026-05-07] 规划 current-step driver，补齐一次 `imm-work` 调用推进当前 step 闭环的缺口。
- [2026-05-07] 规划 Codex native plan sync，参考 CE 将持久计划步骤映射到 Codex 原生任务显示。
- [2026-05-07] 沉淀 Codex plan task snapshot 模式，用只读任务快照驱动 Codex 原生 `update_plan` 展示。
- [2026-05-07] 沉淀 plan switch state isolation 模式，避免旧 plan 完成状态误解锁新 plan 依赖步骤。
- [2026-05-07] 规划 developer insights 全局 inbox，让系统开发者跨项目记录 workflow 改进素材。
- [2026-05-07] 沉淀 opt-in 的全局 developer insights inbox 模式，让跨项目 workflow 改进素材落到本机用户级入口而不是项目运行态内存。
- [2026-05-07] 修正 single-step orchestration 经验：`Next Action` 是同轮语义路由，不应变成等待用户二次确认的停顿点。
- [2026-05-07] 规划系统级 subagents 设计，基于 BMAD、CE、GSD、gstack 和 impeccable 上游对比收敛出三层 roster。
- [2026-05-07] 规划独立 bounded autowork skill，让系统可在 validated plan 基础上按 stop condition 自动推进到阻塞点，而不把 `imm-work` 变成默认 full-plan autowork。
- [2026-05-07] 沉淀 opt-in bounded autowork entry 模式，要求多 step 自动推进使用独立入口、显式 opt-in、bounded stop conditions，并复用 `imm-work -> imm-executor -> imm-qa` 权限链。
- [2026-05-07] 规划 skill/workflow contract lint 首轮切片，收窄到可机械检查的 contract fields、role boundaries 和 workflow guards，并在规划文档中保留 Harness engineering 参考 URL。
- [2026-05-07] 沉淀 tested skill contracts 模式，把 skill contract 字段、角色边界和 workflow guard 提升为本地可运行测试，而不是只留在文档约定里。
- [2026-05-07] 完成 `.imm` 运行时污染收敛切片，沉淀仓库入口洁净与兼容回退可复用模式，补充 `.imm-backup` 回退清单与 `docs/solutions` 迁移经验。
- [2026-05-07] 规划 workflow trigger repair，收窄修复 autowork Codex status、compound dev insights 写入、显式 sub-agent 激活三个可观测缺口。
- [2026-05-07] 沉淀 observable workflow trigger contract 模式，把 Codex status、dev insights、sub-agent 触发点绑定到可验证入口与 focused regression。
- [2026-05-07] 规划 workflow health gate repair，收窄到 heal skill inventory 漂移与 workflow loop QA gate 回归对齐。
- [2026-05-07] 沉淀 workflow health gate alignment 模式，要求健康检查清单与 QA gate 回归 fixture 一起追随真实契约演进。
- [2026-05-08] 规划 Dev Insights Review Loop 手动分析切片，收窄到本地 report 入口、fixture 验证和隐私/写入边界，不做 scheduler、自动建计划或 runtime dispatcher。
- [2026-05-08] 沉淀 manual dev insights review loop 模式，把 opt-in inbox 的后续分析收敛为手动、本地、只读 report，再路由回 brainstorm/preplan/planner gate。
- [2026-05-08] 规划 role-entrypoint contract repair，收窄到 `imm-work` 单入口、`imm-executor`/`imm-qa` 角色语义和 CLI 文档契约对齐。
- [2026-05-08] 沉淀 role-entrypoint contract separation 模式，把 authority role 与 CLI continue entry 显式分离，并用状态契约与安装测试双向守卫。
- [2026-05-08] 规划 Immune-Brain 中期规划框架（方案 C），确认 1+1 主线并产出 spec/plan。
- [2026-05-08] 更新 `MEMORY.md`，将中期规划闭环状态标记为 planned，并同步 U1/U2 执行成果。
- [2026-05-08] 规划会话流顺滑化与输出收敛切片，收窄到 `imm-work` 单入口、默认结果模式输出、以及可恢复状态失配的静默自愈。
- [2026-05-08] 完成会话流顺滑化与输出收敛计划，闭环 `imm-work` 默认入口、canonical runtime state source、以及 `imm-qa` 的 default/debug 输出分流。
- [2026-05-08] 修复 `imm-dehydrate.py` 的 canonical runtime path，并恢复 `tests.test_workflow_loop` 对 dehydrate/finish 路径的基本回归覆盖。
- [2026-05-08] 规划外部项目最小化 `imm-init` bootstrap，收窄到最少目录/文件、无本地运行引擎复制、以及非破坏式重复执行。
- [2026-05-08] 完成外部项目最小化 `imm-init` bootstrap，并沉淀最小 bootstrap 与幂等追加规则。
- [2026-05-08] 规划 framing 阶段默认输出进一步简洁化，收窄到 `imm-brainstorm` / `imm-preplan-review` 的默认结论优先、按需展开解释，以及最少必要的契约守卫。
- [2026-05-08] 规划 workspace authorization hygiene，收敛到“从目标 project 根目录启动会话”规则与同类授权触发面清单，不扩展到脚本或 sandbox 改造。
- [2026-05-08] 完成 workspace authorization hygiene，明确目标 project 根目录启动规则，并沉淀同类授权提示的路径边界排查模式。
- [2026-05-08] 规划 compound finish entry contract repair，收窄到 `imm-compounder` 的默认 `imm-finish` 入口、fallback 语义、以及 focused regression / solution wording 对齐。
- [2026-05-08] 完成 compound finish entry contract repair，并沉淀“新 CLI 默认入口 + 旧脚本仅 compatibility fallback”的 trigger contract 规则。
- [2026-05-08] 规划 `imm-pr-fix` 当前 branch 默认 PR 发现切片，收窄到 skill contract、唯一远端确认、以及 focused regression，不扩展到 GitHub 自动化脚本。
- [2026-05-08] 完成 `imm-pr-fix` 当前 branch 默认 PR 发现切片，并沉淀“current branch 仅作 lookup key，远端 GitHub metadata 才是 PR source of truth”的 repair contract 模式。
- [2026-05-08] 规划 workflow scenario coverage，按用户确认的 1-9 场景收敛默认入口、轻量 bugfix、模糊任务、恢复/返工、证据不足与畸形计划守卫，并排除 10-14 场景。
- [2026-05-08] 完成 workflow scenario coverage 计划，闭环默认入口/进度可见性、轻量 bugfix 与模糊任务 gate、resume/rework 回路，以及 evidence-poor / malformed-plan guard，并沉淀场景打包式 contract 覆盖模式。
- [2026-05-08] 规划 `imm-brainstorm` 默认输出自然化切片，收窄到结论优先、按需显式边界字段，以及针对 rigid template 回漂的最小 contract guard。
- [2026-05-08] 将输出简化目标从 `imm-brainstorm` 单点扩展到全部本地 `imm-*` skills，规划 repo-wide natural-output contract 与按角色分组的执行切片。
- [2026-05-08] 完成全部本地 `imm-*` skills 的 natural-output contract，闭环共享基线、按角色分组的默认输出契约，以及 repo-wide focused regression 守卫。
- [2026-05-08] 规划 `current_iteration` closure contract repair，收敛到单一运行态状态源、finish 后 reset 语义，以及 `status/finish/dehydrate` 跨工具一致性回归。
- [2026-05-08] 将 `current_iteration` closure contract 的 U3 验收从过宽的整文件 workflow-loop 回归收窄为仅覆盖本轮 touched runtime-state regressions，避免被无关 `imm-heal` leftovers 阻塞。
- [2026-05-08] 完成 `current_iteration` closure contract repair，并增强 canonical runtime state pattern：active runtime 先 snapshot 到 durable memory，再在 finish 后 reset；本轮 regression 只验证 touched contract，不吞无关 health gate leftovers。
- [2026-05-08] 规划 system subagents 治理契约收敛切片，锁定 authority matrix、routing boundary、manifest/output contract 和项目专用层的最小首版范围。
- [2026-05-08] 规划 project-scoped runtime state repair，收敛到当前项目根的 runtime 路径与同项目范围内的 self-heal 恢复，阻止 external worktree plan 抢占当前 iteration。
- [2026-05-09] 沉淀 layered subagent governance contract 模式，明确 authority class 优先、共享 manifest contract，以及条件风险层与项目专用层的分层边界。
- [2026-05-09] 规划 `imm-party` 显式 subagent delegation 切片，收敛到 execution-ready delegation contract、focused regression 和 Codex runtime 人工验证路径。
- [2026-05-09] 完成 `imm-party` 显式 subagent delegation 切片，并沉淀 bounded advisory delegation packet 模式，统一 packet 字段、固定 fallback reason 与人工 runtime 验证路径。
- [2026-05-09] 规划 `prompt-contract-reviewer` project-specific slice，收敛到 docs-first contract、明确 fallback 与可验证路径，不扩成 registry 或多 reviewer rollout。
- [2026-05-09] 完成 `prompt-contract-reviewer` project-specific slice，并沉淀 project-specific reviewer contract slice 模式，统一 standalone contract、显式 fallback 与 focused regression / manual runtime validation 路径。
- [2026-05-09] 规划 `prompt-contract-reviewer` runtime slice，收敛到 dedicated activation host、trigger-only routing、明确 fallback 与 focused regression / manual runtime validation。
- [2026-05-09] 完成 `prompt-contract-reviewer` runtime slice，并沉淀 dedicated reviewer activation host 模式，统一独立宿主、trigger-only routing、focused regression 与 manual runtime validation 的组合收口。
- [2026-05-09] 规划 `ai-eval-planner` single-slice 首版，收敛到 standalone contract、最小 activation host 目标、`advisory` 边界，以及 focused regression / manual runtime validation 路径。
- [2026-05-09] 按用户要求把首轮 subagent rollout 从单个 `ai-eval-planner` slice 扩成四个独立 slice 的 batch：`security-reviewer`、`api-contract-reviewer`、`ai-eval-planner`、`docs-verifier`。
- [2026-05-09] 执行 first-subagent-batch 的 U1，补齐 `security-reviewer` standalone contract slice 与独立 slice plan，保持 conditional-risk、advisory、read-only 与 non-default 边界。
- [2026-05-09] 执行 first-subagent-batch 的 U2，补齐 `api-contract-reviewer` standalone contract slice 与独立 slice plan，保持 conditional-risk、advisory、read-only 与 non-default 边界。
- [2026-05-09] 执行 first-subagent-batch 的 U3，对齐 `ai-eval-planner` 现有 standalone slice，使其可作为 batch 成员复用而不与共享 reviewer framework 绑定。
- [2026-05-09] 执行 first-subagent-batch 的 U4，补齐 `docs-verifier` standalone contract slice 与独立 slice plan，保持 project-specific、advisory、read-only 与 non-default 边界。
- [2026-05-09] 规划 post-batch durable summary sync hotfix，收窄到 `MEMORY.md` 顶部摘要与 completed batch / `imm-compounder` 路由对齐，不处理 `.imm/memory/current_iteration.json` 的提交策略。
- [2026-05-09] 执行 post-batch durable summary sync hotfix，更新 `MEMORY.md` 顶部状态，使其与已完成 batch 和 `imm-compounder` 路由对齐。
- [2026-05-09] 沉淀 first-subagent-batch rollout 模式，明确首批多 subagent 推进时应保持 batch 共享边界与 slice 独立闭合，并在 batch 完成后同步 durable summary。
- [2026-05-09] 规划 `ai-eval-planner` runtime slice，收敛到 dedicated activation host、trigger-only routing、明确 fallback 与 focused regression / manual runtime validation，同时保持第一批 activation roadmap 仍按单 slice 顺序闭环。
- [2026-05-09] 规划 `docs-verifier` runtime slice，收敛到 dedicated activation host、trigger-only routing、明确 fallback 与 focused regression / manual runtime validation，并保持“已有 subagents 可用化”仍按单 slice 顺序闭环。
- [2026-05-09] 规划 `docs-verifier` durable summary sync hotfix，收窄到 `MEMORY.md` 顶部摘要与已完成 runtime slice / `imm-compounder` 路由对齐，不处理 `.imm/memory/current_iteration.json` 的 reset 或提交策略。
- [2026-05-09] 规划 README installed-skills sync hotfix，收窄到安装说明与 `install-local.sh --list` 的真实输出对齐，不修改安装器逻辑或扩散到其他 README 段落。
- [2026-05-09] 执行 README installed-skills sync hotfix，移除 README 中会漂移的静态安装 skill 清单，并改为以 `mise run list-skills` / `install-local.sh --list` 的实时输出为准。
- [2026-05-09] 沉淀 live install-list source-of-truth pattern，明确当安装器已动态发现 skills 时，README 应引用 live list 命令，而不是维护静态安装枚举。
- [2026-05-09] 规划 compound debt inventory 首版，收窄到 repo-local 历史漏沉淀候选识别、证据分级、去重，以及仅对高置信候选开放 bounded backfill，不实现历史轮次总账或无依据的全量自动补齐。
- [2026-05-09] 完成 compound debt inventory 首版，实现 repo-local 历史漏沉淀候选识别、证据分级、去重，以及仅对高置信候选开放 bounded backfill queue。
- [2026-05-09] 规划 workflow friction reduction 切片，收敛到默认入口收口、条件触发的 preplan gate，以及保留 spec/QA 的 one-step minimal loop，不扩大到 authority merge、runtime state rewrite 或默认 autowork。
- [2026-05-09] 规划 workflow friction review follow-up 切片，收敛到 preplan 路由冲突修复和 `MEMORY.md` 顶部 durable summary 对齐，不扩展到 `current_iteration.json` 策略或 runtime 行为改造。
- [2026-05-09] 规划 dev insights telemetry trace 切片，收敛到用户级全局 raw trace、telemetry-derived inbox 信号，以及隐私/保留边界，不扩展到目标项目状态写入或完整 observability 平台。
- [2026-05-09] 将 dev insights telemetry trace 重新规划为实现闭环切片，收敛到显式 `record/analyze` 入口、可实现的首版信号规则，以及与现有 review loop 的端到端兼容验证。
- [2026-05-09] 基于 `imm-code-review` 的 3 个 telemetry 缺口，规划 bounded follow-up fix slice，收敛到项目级 baseline 隔离、写入失败降级，以及重复 `analyze` 的幂等守卫。
- [2026-05-09] 沉淀 telemetry-derived signal hygiene 模式，要求显式 telemetry 链路同时满足写失败降级、项目级 baseline 隔离，以及重复分析幂等，避免 derived inbox 噪音和误报。
- [2026-05-09] 基于 telemetry session 复盘，规划 workflow friction retrospective follow-up 切片，优先修复 review-to-repair 路由、默认 status 噪音、durable summary 漂移，以及 focused verification 输出噪音。
- [2026-05-09] 规划 imm-party contract and context hygiene 切片，收敛到 runtime/design 拆层、shared context packet、default-2 delta-only advisory contract、最小 repo inspection boundary，以及 imm-party 定向结构化 contract tests。
- [2026-05-09] 基于 imm-party hygiene code review findings，规划 bounded follow-up fix slice，收敛到 true single-layer `party_packet`、shared-context wording cleanup，以及 shared guard baseline 的 reference-plus-delta 收口。
- [2026-05-09] 沉淀 runtime payload 与 outer contract 分层模式，要求 handoff payload、shared-context packet 和 repo-wide guard baseline 各自留在自己的层次，避免 skill contract 减重时把重复字段塞回 payload。

## Archived 2026-05-15T17:48:04

- [2026-05-10] 完成 `053` code simplification lens：新建 `docs/reference/code-simplification-checklist.md` 薄索引（范围解析 + 三透镜 + 边界 + submodule 链接），在 `imm-code-review` Progressive checklists 挂载简化审查触发条件；沉淀 `docs/solutions/progressive-disclosure-review-lens.md`。

## Archived 2026-05-15T21:32:00

- [2026-05-11] 完成 `055` first-wave subagent runtime dispatch：创建 `docs/reference/subagent-dispatch-protocol.md` 共享 6 阶段 dispatch protocol，在 `imm-code-review`、`imm-party`、`imm-ui-review` 三个 host skill 注入 Dispatch Protocol 段，补齐 DispatchProtocolTests 5 条 contract 断言，并通过 Cursor Task tool 真实 dispatch `security-reviewer` 完成端到端验证；沉淀 `docs/solutions/executable-subagent-dispatch-protocol.md`。

## Archived 2026-05-15T23:28:38

- [2026-05-11] 闭环 `056` feat-automatic-subagent-activation（执行于切换到 057 前的同一工作会话）：`subagent-trigger-catalog.yaml`、`automatic-subagent-activation-policy.md`、`.imm/activation_plan.py`、`tests/test_activation_plan.py`、`imm-code-review` Phase 2 catalog 默认顺序与 specs carve-out；沉淀 `docs/solutions/catalog-driven-host-subagent-activation.md`。

## Archived 2026-05-16T09:21:39

- [2026-05-11] 完成 `057` refactor-inline-clarification-preplan-demotion：内联澄清与 Planning Bootstrap、`imm-preplan-review` 降级为可选高压闸门、README/IMMUNE/workflow 路由一致、`test_inline_clarification_and_preplan_demotion` 合约守卫；沉淀 `docs/solutions/inline-clarification-and-optional-preplan-gate.md`。

## Archived 2026-05-17T15:51:59

- [2026-05-11] 完成 `060` feat-tdd-execution-discipline：`imm-planner` Execution posture、`imm-executor` TDD Execution Discipline、`imm-qa` TDD evidence check、`test_tdd_execution_discipline_contract` 合约守卫；spec `.imm/specs/tdd-execution-discipline.spec.md`；沉淀 `docs/solutions/tdd-execution-discipline-skill-pipeline.md`。

## Archived 2026-05-17T16:49:56

- [2026-05-12] 完成 `068`/`069`/`070` State Ledger 主线：`068` 引入 per-step ledger 与 v1 兼容；`069` 修复 review blockers；`070` 加固 heal/迁移/force 历史/derive 调用；compound 写入 `docs/solutions/state-ledger-heal-and-migration-safety.md`。
- [2026-05-12] 完成 `064`/`065`/`066` Pocock-inspired improvements：从 mattpocock/skills 学习 7 项改进模式（CONTEXT.md 共享词汇、验证质量标注、原型步骤、fast-track 仪式压缩、HANDOFF.md 跨会话续接、拒绝决策记录、轻量 ADR），经两轮 code-review 修正 6 个 boundary/authority 违规后全部适配到 Immune-Brain 权限分离体系；96 条合约测试通过；沉淀 `docs/solutions/upstream-pattern-integration-boundary-discipline.md`。

## Archived 2026-05-17T21:09:42

- [2026-05-12] 完成 `071` fix-baseline-md-install：install-local.sh 在子目录循环后显式 copy/check/uninstall `skills/BASELINE.md`；`test_install_local.py` 补齐 presence/absence 断言与 `--check` 失败测试；12 条安装测试全过；沉淀 `docs/solutions/install-loop-shared-sibling-file-coverage.md`。

## Archived 2026-05-17T21:31:25

- [2026-05-13] 完成 `078` CLI wrapper unification：hub skill Verification sections 与 BASELINE.md 全部改用 CLI 形式（`imm-plan` / `imm-work` / `imm-review`）；`imm-work.py` command 字段同步；install-local.sh 刷新所有已安装副本；97 条合约测试全过；沉淀 `docs/solutions/hub-skill-verification-cli-portability.md`。
- [2026-05-12] 完成 `074`/`075`/`076` subagent activation install-runtime repair：`install-local.sh` 安装 `docs/reference` artifacts 到 skill root 与 CLI runtime，新增 managed `imm-activation-plan` CLI，Codex dispatch protocol 改为当前 `spawn_agent` schema；后续 review 修复 runtime health 漏检，并拆分 CLI runtime ownership vs health，让缺失 `.imm/activation_plan.py` 的受管 runtime 能被 `--check` 报错、被 reinstall 修复、被 uninstall 清理；`tests.test_install_local`、`tests.test_activation_plan`、`tests.test_skill_contracts` 组合通过 125 条测试；沉淀 `docs/solutions/installer-ownership-vs-health-split.md`。

## Archived 2026-05-18T10:22:24

- [2026-05-14] 完成 `081` imm-ui-review catalog wiring：新增 `imm-ui-review` host-bound activation catalog、host-specific activation plan parsing、policy/remaining-work 同步与 standalone UI reviewer trigger 覆盖；review follow-up 通过 same-path append-safe U5 补齐 responsive/visual 独立触发测试；32 条 activation plan 测试通过；沉淀 `docs/solutions/host-bound-catalog-expansion-coverage.md`。

## Archived 2026-05-19T14:15:55

- [2026-05-14] 完成 `082`/`083` reviewer follow-up dual-track work entry 与 closure-contract repair：reviewer `follow_up` 从 planner-ready handoff 升级为 `imm-work` 可消费的 execution artifact，并补齐 `imm-qa` evidence gate、`imm-work` follow-up Next Action gate、`imm-code-review` stale `append_to_plan` 清理；验证 `follow_up` 覆盖 reviewer/work/QA 且 code-review 无 `append_to_plan`；沉淀 `docs/solutions/reviewer-followup-closure-contract.md`。

## Archived 2026-05-19T21:53:22

- [2026-05-15] 完成 autowork workflow refinement：`imm-work` 暴露机器可读 `can_auto_advance`，`imm-autowork` 收敛为轻量调度 wrapper，review/planner/QA 合同文本补齐同一 follow-up 边界，workflow loop 增加 replan stop regression；`mise run test` 通过 296 条测试；沉淀 `docs/solutions/machine-readable-autowork-advance-gate.md`。
- [2026-05-14] 完成 `080`/`084` subagent telemetry and arbitration integration：将 dispatch telemetry 通过 host-facing activation wrapper 接入可执行路径，新增 review synthesis adapter 复用 arbitration helper，并经 review follow-up 修正“有 child findings 仍 pass”的聚合结果语义；71 条相关测试通过；沉淀 `docs/solutions/host-facing-subagent-integration-adapters.md`。

## Archived 2026-05-19T22:35:28

- [2026-05-15] 完成 autowork workflow refinement：`imm-work` 暴露机器可读 `can_auto_advance`，`imm-autowork` 收敛为轻量调度 wrapper，review/planner/QA 合同文本补齐同一 follow-up 边界，workflow loop 增加 replan stop regression；`mise run test` 通过 296 条测试；沉淀 `docs/solutions/machine-readable-autowork-advance-gate.md`。
- [2026-05-14] 完成 `080`/`084` subagent telemetry and arbitration integration：将 dispatch telemetry 通过 host-facing activation wrapper 接入可执行路径，新增 review synthesis adapter 复用 arbitration helper，并经 review follow-up 修正“有 child findings 仍 pass”的聚合结果语义；71 条相关测试通过；沉淀 `docs/solutions/host-facing-subagent-integration-adapters.md`。

## Archived 2026-05-20T00:07:15

- [2026-05-15] 完成 subagent activation intent transparency：收紧 `explicit_solo` 判定为仅显式用户否定，强制 `solo_fallback_meaning` 在 imm-code-review 和 imm-ui-review 的 solo fallback 输出中出现；`python3 -m unittest tests.test_skill_contracts` 通过 103 条测试；沉淀 `docs/solutions/dispatch-intent-transparency-and-fallback-meaning.md`。
- [2026-05-15] 完成 post-closure evidence correction policy：将 closed Step 之后发现 de evidence 漏记问题改为 fresh correction Step 处理，避免回写 State Ledger 或 backdate 时间线；`python3 -m unittest tests.test_skill_contracts` 通过 102 条测试；沉淀 `docs/solutions/contracts.md` 的 Post-Closure Evidence Correction pattern，并记录 rejected `docs/solutions/rejected-post-closure-ledger-rewrite.md`。

## Archived 2026-05-23T14:31:20

- [2026-05-17] 完成 Wave 2 architecture deepening：消除了 `imm_core` 对根目录脚本的反向动态加载依赖，移除了 `current_iteration_state.py` 和 `state_machine.py` 遗留垫片，并将 `activation_plan.py` 核心实现归口至 `imm_core`；`python3 -m unittest discover -s tests` 通过 327 条测试；沉淀 `docs/solutions/architecture.md` 中的 Internal Package Migration and Dependency Hygiene pattern.
- [2026-05-16] 完成 project audit fixes：删除四个 legacy reviewer skill surface，修正 v2 State Ledger 默认初始化与 stale `completed_steps` 推导，补齐旧计划 frontmatter，并让 `imm-compounder` 明确 compound debt backfill；`python3 -m unittest discover -s tests` 通过 327 条测试；沉淀 `docs/solutions/architecture.md` 的 Runtime Surface Retirement Contract Sweep pattern.
- [2026-05-16] 完成 Wave 1 architecture deepening：建立机器可读的 `skills/registry.yaml` 注册表，解耦状态机逻辑到 `.imm/state_machine.py`，并合并 5 个咨询类审阅者到统一的 `imm-advisory-reviewer`（通过 lens 动态驱动）；`pytest tests/test_activation_plan.py` 与 `tests/test_current_iteration_state.py` 通过；沉淀 `docs/solutions/architecture.md` 中的三个核心架构模式。
- [2026-05-15] 完成 discovery navigation layer：为 Plan / State Ledger 增加 `discovery_cache` 导航元数据，`imm-init` bootstrap `CONTEXT.md` / `CLAUDE.md` / `AGENTS.md` 导航入口，compounder 维护 solution `key_files` 与 Architecture Map，brainstorm/planner 记录 Discovery Protocol；`python3 -m unittest tests.test_imm_plan tests.test_imm_init tests.test_skill_contracts` 通过 135 条测试；沉淀 `docs/solutions/contracts.md` 的 Three-tier Discovery Navigation Contract pattern。

## Archived 2026-05-23T22:05:14

- [2026-05-17] 完成 subagent evolution plan：扩展 State Ledger 以支持 `child_evidence` 持久化，引入第一个执行受限子代理 `test-fixer` 并定义 `active-step-bounded-executor` 权限类，通过 `focus_delta.specific_changes` 实现 context sharding（分片委派）以节省 token；`python3 -m unittest discover -s tests` 通过 331 条测试；沉淀 `docs/solutions/architecture.md` 与 `docs/solutions/contracts.md` 中的三个核心模式。

## Archived 2026-05-24T21:07:34

- [2026-05-17] 完成 imm-code-review 子代理闭包收口并固定了本轮约束：host-bound execution truth 优先，明确拒绝在本阶段引入 shared registry 或真正通用 dispatcher。沉淀 `docs/solutions/rejected-shared-registry-generic-dispatcher.md`，并将 `shared registry / generic dispatcher` 标记为后续再议条件。

## Archived 2026-05-25T11:35:41

- [2026-05-17] 完成 Execution Truth Protocol MVP for Subagents：在 `imm-code-review` 中硬化了子代理激活序列，强制先调用 `imm-activation-plan` CLI 生成计划，再通过 `build_delegation_packets` 切片上下文，最后分发。同时 `imm-compounder` 接入了 `dispatch_telemetry.jsonl` 以消费执行效率指标；所有改动通过 `pytest tests/test_skill_contracts.py` 断言验证；沉淀了 `docs/solutions/subagent-execution-truth-protocol.md`。

## Archived 2026-05-25T17:34:02

- [2026-05-17] 完成 cost-efficiency r3 实施闭环收口：实现 `closed_step` 在 `imm-finish` 前脱水、补充 `child_evidence_ref` / `focus_delta_ref`，并把 `skills/BASELINE.md` 扩展为 Shallow Discovery 约束；`docs/reference/subagent-dispatch-protocol.md` 新增 light-weight short-circuit；新增/更新 `docs/plans/2026-05-17-003-feat-cost-efficiency-r3-plan.md`、`docs/specs/cost-efficiency-r3.spec.md`、`tests/test_current_iteration_state.py`、`tests/test_workflow_loop.py`、`.imm/imm-finish.py`、`.imm/imm_core/current_iteration_state.py` 与相关 contract tests；沉淀 `docs/solutions/contracts.md` 两条复用模式：`Dehydrate Closed Step Payload Before Finish Snapshot`、`Shallow Discovery with Cost-Scoped Dispatch Short-Circuit`。

## Archived 2026-05-25T19:33:40

- [2026-05-18] 完成 imm-arch-explorer domain mapper 实施收口：实现 Domain Mapper 模式支持平行领域调查 (Parallel Domain Survey)，将代码库按顶级目录或领域划分为分片进行并行分析。新增 `imm_core/domain_mapper_dispatch.py` 以确保确定性封包与结果归一化；在 `imm-arch-explorer` contract 中锁定 Domain Mapper mode 契约与结构化输出 schema；在 `current_iteration.json` (v2) 中记录 `child_evidence` 并通过 telemetry 持久化；`python3 -m unittest tests.test_domain_mapper_dispatch tests.test_telemetry_trace tests.test_skill_contracts` 全部通过；沉淀 `docs/solutions/contracts.md` 中的 `Parallel Domain Survey via Domain Mapper` 模式，并更新 `docs/solutions/subagent-execution-truth-protocol.md`。

## Archived 2026-05-26T14:33:38

- [2026-05-19] Reviewer Feedback Optimization：讨论并规划了减少 Code Review 轮次的方案。拒绝了要求子审查员提供精确 `suggested_patch` 的方案（因存在上下文缺失与冲突风险），改为要求子审查员提供可测试的 `verification_criteria`。同时增加了 Executor 提交前本地测试基线前置校验，以及严格限制 Rework 阶段 Executor 只能为通过 verification criteria 进行修改的边界约束。沉淀记录于 `docs/solutions/rejected-rigid-patch-generation-in-reviewer-subagents.md`。

## Archived 2026-05-27T16:33:26

- [2026-05-19] Architecture Improvement Wave 3 闭环：U001–U005 全部 closed；`imm-plan.py` shim、`heal`/`migration`/`dehydration` 拆分、`review_arbitration` 接入合成、`.imm/pyproject.toml` 可编辑安装、`scripts/detect-stale-refs.py`；沉淀 `docs/solutions/architecture.md`（5 模式）与 `rejected-wave3-dev-install-boundaries.md`；CONTEXT.md Architecture Map 已准确，compounder 未再改。
- [2026-05-18] 改进公开 README 模板：在 `public-release/templates/README.md` 中引入了以用户价值为导向的表达方式，使用 "FileSystem-as-Brain" 隐喻，并将 `imm-*` skill 包装为直观的 "Lifecycle Skills"；提供了极简的 `Plan -> Work -> Review` 核心循环引导；更新了 CLI 命令高信号摘要表；沉淀 `docs/solutions/contracts.md` 中的 `Value-Driven Public Surface for Agentic Systems` 模式，确保内外文档表达契约的一致性。

## Archived 2026-05-29T13:17:05

- [2026-05-19] pro-workflow compaction handoff 闭环：注册 `upstreams/pro-workflow`，交付 borrow-map / compaction-handoff-hosts / HANDOFF-template / spec，实现 `imm-work` Compaction Handoff 与 `imm-dehydrate --logic-state`；code-review follow-up 加固 `load_logic_state_file`；沉淀 `docs/solutions/pro-workflow-compaction-handoff-integration.md` 与 `rejected-pro-workflow-sqlite-wiki-authority.md`；更新 `docs/solutions/workflow.md` 与 CONTEXT.md Architecture Map。

## Archived 2026-06-01T09:14:48

- [2026-05-19] `imm-heal` 技能库存对齐修复：将 `REQUIRED_SKILLS` 硬编码列表替换为基于 `skills/*/SKILL.md` 的动态扫描逻辑，解决了 alias 技能（如 `prep`, `run`）缺失导致的误报；更新了 `tests/test_workflow_loop.py` 验证。沉淀 `docs/solutions/live-inventory-source-of-truth.md`。

## Archived 2026-06-03T15:40:42

- [2026-05-21] 完成 `imm-ui-review` 的 UI/UX 审阅能力升级：新增 `ux_heuristic` lens，并把触发与 policy 变更同步到主 runtime 与 plugin dist runtime。完成 `.imm/activation_plan.py`、`.imm/imm_core/delegation_packet.py` 及其 plugin copy 的镜像更新；补充 `tests/test_activation_plan.py` 与 `tests/test_skill_contracts.py` 的分离触发 + 合约回归；沉淀 `docs/solutions/contracts.md` 模式：`Lens Extension Requires Runtime- and Plugin-Copy Parity`。`imm-work` 记录的 Step U1-U4 pass，`docs/reference/subagent-remaining-work.md` 标记 UI lens 已完成。
- [2026-05-20] 完成 Cross-Host Plugin Runtime 实施闭环：将 Immune-Brain 分发从全局 managed-copy 安装器迁移至宿主原生插件包（Codex, Claude Code, Cursor）；实现了统一的插件内运行时适配器 `immune_brain_runtime.py` 与 MCP 映射；移除了遗留的全局 `install-local.sh` 与 `imm-cli-launcher`；更新了 `sync-to-public.sh` 以插件包为核心构建产物。沉淀 `docs/solutions/architecture.md` 中的 `Host-Native Plugin Distribution and Plugin-Local Runtime` 模式；更新了 CONTEXT.md Architecture Map。

## Archived 2026-06-05T11:50:37

- [2026-05-22] 完成“全局子代理默认策略”统一计划：新增 `~/.immune-brain/config.toml` 可配置的 activation policy（auto/explicit_only/disabled），支持全局+host+lens+subagent 覆盖，显式列表强制，补齐 `.imm/imm_core/activation_plan.py`、`work_probes.py`、`domain_mapper_dispatch.py` 与 plugin dist 运行时一致性，并新增 `docs/reference/subagent-dispatch-protocol.md` / `automatic-subagent-activation-policy.md` / `immune-brain-config.md` / `subagent-remaining-work.md` 的补齐说明。

## Archived 2026-06-05T18:38:36

- [2026-05-22] 完成 `imm-work` 并行探针 runtime 闭环收口：U1-U5 全 closed，完成并发探针注释同步、probe envelope helper、`probing` 状态持久化、fallback evidence 记录及跨技能 contract 回归，最终 `python3 -m unittest tests.test_imm_plan tests.test_current_iteration_state tests.test_work_probes tests.test_workflow_loop tests.test_skill_contracts` 通过（194 条）。

## Archived 2026-06-06T01:07:39

- [2026-05-23] 完成 `feat-ui-i18n-review-lens` 后续收口 U1-U5：新增 `ui_i18n` lens checklist 与触发规则，修正 `max_parallel_children` 下的匹配策略（`keyword` > `specific_path` > `generic_path`），更新 `automatic-subagent-activation-policy` 与 `subagent-trigger-catalog`，同步 plugin dist runtime，补充 `tests/test_activation_plan.py` / `tests/test_skill_contracts.py` 的覆盖，并沉淀 `docs/solutions/workflow.md` 新模式 `Match-Strength-Ordered Activation Under Parallel Caps`（`python3 -m unittest discover -s tests` 通过 436）。

## Archived 2026-06-08T19:18:44

- [2026-05-23] 完成 `mcp-first-subagent-activation` 收口：新增 plugin MCP `imm_activation_plan`，将 Codex/Cursor/Claude Code runtime 主入口统一到 MCP，`bin/imm-*` 降为 manual/debug fallback；将 activation eligibility 与 host authorization 分离，新增 `host_authorization_required`；AGENTS 模板提供 standing authorization 但明确不覆盖 host tool policy；修复 `.mcp.json` Cursor cache bootstrap。沉淀 `docs/solutions/architecture.md` 新模式 `MCP-First Runtime Entry With Host Authorization Gate`。

## Archived 2026-06-08T23:08:26

- [2026-05-24] 完成 gstack quality ceiling protocol 收口：新增 `docs/reference/gstack-quality-ceiling-protocol.md`，把角色偏好分离落成 `preferred bias` / `prohibited drift`，把交互仪式压缩为 Entry / Exit gate，并限定 closed-world completeness 只消费 finite source packets；code review follow-up 修正 `Brainstorm Trace`、`origin_coverage`、`QA closure gate` 为 derived processing stages；`tests/test_skill_contracts.py` 增加 focused guard；沉淀 `docs/solutions/contracts.md` 新模式 `gstack Quality Ceiling as Skill Contract Guidance`。

## Archived 2026-06-09T11:27:26

- [2026-05-25] 完成 validate-only plan command 收口：`imm-plan --json` 默认改为只读验证，显式 `--sync` 才写入 State Ledger；`imm-work` activation guard 与 `imm-planner` handoff 均改成 sync 口径；同路径 metadata-only Plan 更新保留 closed Step；plugin dist runtime 加入 exact parity 测试，避免宿主副本漂移。沉淀 `docs/solutions/contracts.md` 新模式 `Validate-Only CLI With Explicit Runtime Sync`，并更新旧 `Validated Plan Sync Ownership` 口径。

## Archived 2026-06-09T15:14:07

- [2026-05-25] 完成 `imm-ui-review` design-contract alignment 收口：新增 `docs/reference/design-contract-review-checklist.md`，把 `DESIGN.md` 优先、缺失只提醒、anti-slop 风格中性固定下来；更新 `plugins/immune-brain/dist/imm-ui-review.md` 与打包副本；`tests/test_skill_contracts.py` 增加 focused regression，防止回漂到“自动生成 `DESIGN.md` / 默认 SaaS 风格”；沉淀 `docs/solutions/project-specific-reviewer-contract-slices.md` 的 design-contract 补充模式，并记录 `rejected-ui-review-fallback-design-generation.md`。本轮未更新 `CONTEXT.md`，因为没有新的架构导航变化，只是收紧既有 reviewer contract 边界。

## Archived 2026-06-09T19:17:12

- [2026-05-25] 完成 `imm-autowork` runtime host 收口：新增真实 `.imm/imm-autowork.py` host，支持 same-run 进入 QA、QA pass 后继续解锁下一 Step、completed Plan 后消费 bounded reviewer `pending_follow_up`；plugin dist 暴露 `imm_autowork` MCP tool 与 `bin/imm-autowork` wrapper；code review 未发现 actionable finding；`python3 -m unittest tests.test_imm_autowork tests.test_workflow_loop tests.test_imm_work tests.test_imm_review tests.test_immune_brain_mcp_runtime tests.test_skill_contracts` 通过 251 tests。沉淀 `docs/solutions/workflow.md` 新模式 `Runtime Host Owns Autowork Continuation`，并更新 `CONTEXT.md` Architecture Map。

## Archived 2026-06-22T14:47:38

- [2026-05-26] 完成 Planning Quality Gate 收口：先将 009 方案从强制 Master-Phase 改为 documentation-only Planning Quality Gate，并用 `imm-plan --json` 验证；再通过 010 plan 新增 `docs/reference/planning-quality-gate.md`，把 `imm-planner` contract 接入 elevated-risk trigger signals，补 `tests/test_skill_contracts.py` 防止回漂到”忘记质量门”或”全局强制 ceremony”。`python3 -m unittest tests.test_skill_contracts` 通过 140 tests，`imm-plan` 对 010 plan 校验通过。沉淀 `docs/solutions/contracts.md` 新模式 `Risk-Triggered Planning Quality Gate`，并更新 `CONTEXT.md` Architecture Map。

## Archived 2026-06-25T13:39:34

- [2026-05-26] 完成 Plan Status Display Disconnect 修复：`build_codex_plan` 原本用简单的 `active_step_number == step_number` 推导展示状态，忽略了 V2 账本中的 `replanning`、`rework_needed`、`ready_for_review` 等状态，导致展示与路由脱节。修复后直接读取 `state[“steps”]` 权威账本状态，6 种状态完整映射。`heal.py` 幽灵 closed 步骤附加 `healed_at` 时间戳。沉淀 `docs/solutions/codex-plan-task-snapshot.md` 和 `docs/solutions/state-ledger-heal-and-migration-safety.md` 的 refined patterns。

## Archived 2026-06-26T16:27:59

- [2026-05-27] 完成 `imm-autowork` 简化闭包：把 `imm-autowork.py` 明确为 deterministic checkpoint runtime，返回
  `awaiting_execution_input`、`awaiting_qa_decision` 与最小 host handoff context；`imm-autowork` skill
  contract 收敛到同一入口 + 明确 host loop，不添加 `imm-autowork-driver`，并拒绝 runtime default QA
  pass 行为。`python3 -m unittest tests.test_imm_autowork tests.test_skill_contracts` 与
  `python3 .imm/imm-plan.py docs/plans/2026-05-27-001-fix-autowork-skill-driver-simplification-plan.md --json` 均通过，沉淀新的 workflow 模式与 rejected 学习。

## Archived 2026-06-27T23:26:37

- [2026-05-27] 完成 `stale global imm-plan sync` 修复：为 MCP runtime 工具链补充显式 `sync` 参数，保持 `imm-plan --json` 验证默认只读；`imm-heal` 识别 PATH 层 `imm-plan` 缺 `--sync` 时输出 warning，并保持健康分数 100/100。`python3 .imm/imm-heal.py` 与 `python3 -m unittest tests.test_immune_brain_mcp_runtime tests.test_immune_brain_plugin_package` 通过，沉淀 `docs/solutions/contracts.md` 新模式 `Explicit Sync Capability and Stale Wrapper Warnings`。

