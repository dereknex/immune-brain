# Immune-Brain 使用手册 v0.5.0

> **像生物系统一样进化，像外部大脑一样持久。** —— 两条工作流覆盖从想法到知识沉淀的完整生命周期。

Immune-Brain (免疫大脑) 是一套基于 `compound-engineering` 的深度定制化 Agentic 系统。它推行 **文件即大脑 (FileSystem-as-Brain)** 哲学，通过 24 个职责聚焦的技能覆盖软件开发的完整生命周期。

---

## 快速入门

**两条路径，明确的自动化边界：**

```bash
# 路径一：需求明确
/imm-planner                 # 需求 → validated Plan
/imm-loop                    # 当前对话执行可观察 autorun

# 路径二：存在重大歧义
/imm-brainstorm              # 需求澄清
/imm-planner                 # 迭代规划
/imm-loop 或 /imm-work        # Pi autorun 或逐步推进
/imm-code-review             # 代码评审（或 /imm-ui-review 界面评审）
/imm-compounder              # 在 handoff 后由用户明确运行
```

`imm-loop` Skill 在当前 host 对话中执行可观察的 autorun：主对话保留实现上下文；是否派发独立 QA 由 Plan profile 和 runtime checkpoint 决定，最终 review 使用 host `Agent` subagent。每个 checkpoint 都显示进度；只有 runtime 明确要求时才报告 `imm-compounder` handoff，**不自动运行 `imm-compounder`**。

### 风险分级执行

| Profile | 适用范围 | 执行合同 |
| --- | --- | --- |
| Direct | 低风险、单模块、无 schema/API/迁移/并发影响 | 不创建 Spec/Plan/Ledger，不派发独立 QA，直接修改并验证 |
| Standard | 边界明确的中风险 managed change | Plan 写 `Workflow profile: standard`；passing evidence 由 runtime 自动关闭 Step；最后统一执行 required code/UI review；Compounder 非必需时最终 gate pass 与 `imm-finish` 原子提交 |
| Strict | workflow/Ledger、迁移、安全、并发、公共 API、跨 host release | 逐 Step 独立 QA，最终 review，Compounder handoff，显式 `imm-finish` |

兼容规则：旧 Plan 和未声明 profile 的 Plan 默认为 `strict`；声明 Strict 风险的 Plan 不能选择 `standard`。Standard 的 same-boundary review follow-up 最多两轮。`Compounder: optional` 在两轮 follow-up 后，或当前变更触及 `docs/solutions/` / `CONTEXT.md` 时自动升级为 required。host 只消费 `imm-autowork` 的 `workflow_profile`、`review_budget_state` 和 `compounder_requirement`，不得自行重算。

**首次使用？** 先在项目根目录初始化：
```bash
/imm-init
```

---

## 两条核心工作流

### 工作流一：`imm-planner` → `imm-loop`（默认路径）

`imm-planner` 产出 validated Plan；`imm-loop` 在当前 host 对话中推进执行，主对话保留 active Step 上下文。Strict Step 与 review follow-up 由隔离 subagent 承担 QA；Standard Step 由 runtime 根据 passing evidence 确定性关闭；最终 review 保持隔离。

```
/imm-planner ──→ validated Plan ──→ /imm-loop
                                      ├─ imm-autowork (checkpoint)
                                      ├─ imm-executor (主上下文执行)
                                      ├─ imm-qa (隔离判定)
                                      ├─ imm-code-review / imm-ui-review
                                      └─ 报告 imm-compounder handoff
```

| 阶段 | 技能 | 你做什么 | 系统做什么 |
|------|------|---------|-----------|
| 框定 | `imm-brainstorm` | 重大歧义时回答开放问题 | 提炼约束/假设/非目标，产出 BR-* 脑暴清单 |
| 审查 | `imm-brainstorm`（`adversarial` mode） | 确认 Scope | 高风险时自动触发，锁定工程边界 |
| 规划 | `imm-planner` | 确认计划 | 生成 Spec + Plan，自我批判审计 |
| 执行 | `imm-loop` | 输入 `/imm-loop` | 在当前对话推进 Plan，实现保留主上下文，QA/review 使用隔离 subagent |
| 步进 | `imm-work` | （观察） | 驱动当前 Step 执行与 QA，遇阻断熔断 |
| 编码 | `imm-executor` | （观察） | 手术式修改当前步骤，YAGNI 自审 |
| 质检 | `imm-qa` | （观察） | 基于物证判定 pass/rework/replan |
| 评审 | `imm-code-review` | 审阅 Findings | 全分支安全/性能/契约多透镜审计 |
| 页面设计契约 | `imm-planner`（`page_design` mode） | 确认页面设计 | 页面实现前定义 `page_design` |
| 沉淀 | `imm-compounder` | 在 handoff 后明确调用 | 提取可复用知识，刷新记忆索引 |

---

### 工作流二：`imm-brainstorm` → `imm-planner`（`page_design` mode 按需）→ `imm-loop`/`imm-work` → `imm-code-review`/`imm-ui-review` → `imm-compounder`（逐步掌控）

当需求存在重大歧义或你需要精细控制每个阶段时，按顺序逐个调用。这条路径在规划前显式增加 `imm-brainstorm`，让你可以：

- 在 brainstorm 阶段反复打磨需求框定
- 在 planner 输出后手动审查和修改 Spec 和 Plan
- 页面生成前用 `imm-planner` 的 `page_design` mode 先确认页面结构、操作区和响应式；有设计来源或用户明确要求时才定义视觉字段，缺少来源时标记为 `unknown` / `not_applicable`
- 用 `imm-loop` 在当前对话中可观察地自动推进；需要手动控制时用 `imm-work` 逐步推进当前 Step
- 在 code-review 后选择立即修复还是记录技术债务

```
imm-brainstorm ──→ imm-planner（page_design mode 按需）──→ imm-loop / imm-work ──→ review ──→ imm-compounder
                                     (页面任务按需)          (当前对话 + 隔离 QA/review)                 (用户明确调用)
```

#### 阶段一：`imm-brainstorm` — 需求框定

把模糊想法转化为结构化需求清单，产出五种 ID 的脑暴清单（`BR-REQ-*` / `BR-DEC-*` / `BR-OUT-*` / `BR-DEFER-*` / `BR-Q-*`）。

**调用**：`/imm-brainstorm`

**何时完成**：所有 `BR-Q-*` 开放问题得到答复，框定稳定。

**关键机制**：
- **已否决审计**：启动时扫描 `docs/solutions/` 中 `rejected: true` 的历史决策，发现相似方案立即报警
- **澄清屏障**：存在未答复 `BR-Q-*` 时，强制阻断后续规划
- **默认路由**：直接移交 planner；仅高风险场景（安全/数据迁移/跨边界契约/合规审计）建议走 `adversarial` mode

**辅助技能**：`imm-brainstorm`（`roundtable` mode）— 当存在重大技术选型争议时，在 brainstorm 和 planner 之间随时调用，获得多角色独立分析。

---

#### 阶段二：`imm-planner` — 迭代规划

将脑暴清单物化为 `docs/specs/` 规格书和 `docs/plans/` 结构化计划。

**调用**：`/imm-planner`

**何时完成**：Plan 通过 `imm-plan --json` 校验，所有 BR-* ID 有归宿。

**关键机制**：
- **脑暴追溯**：每个 BR-* ID 必须映射到实现/非目标/决策/延迟，否则校验不通过
- **恶魔代言人审计**：发布前自我批判回滚韧性、验证虚荣性、规格稀释
- **执行姿态**：为每步标注 `test-first`（TDD）、`characterization-first`（遗留代码）或 `Prototype: true`（抛弃型原型）

**辅助技能**：
- `imm-brainstorm`（`adversarial` mode）— 高风险任务在 planner 前触发，进行 Scope Mode 决策和工程边界锁定。可选派发魔鬼代言人子智能体做对抗审计
- `imm-arch-explorer` — 架构重构前调用，深度扫描浅模块/循环依赖/模糊边界，移交建议给 planner

---

#### 阶段三：`imm-loop` / `imm-work` — 执行驱动

按计划步骤逐项执行，每步经过质检后闭环。

**自动模式**：`/imm-loop` 在当前 host 对话中消费 `imm-autowork` checkpoint，主对话完成 active Step 实现；Strict Step 和 review follow-up 进入隔离 QA，Standard Step 在 passing evidence 被接受后直接关闭，全部 Step 结束后进入隔离 final review。它在 `replan`、blocker、预算耗尽、取消或明确的 Compounder handoff 停止，不自动运行 `imm-compounder`。

**手动模式**：`/imm-work` — 每次只推进当前 Step。适合需要逐步审查、或调试复杂步骤时。

**Checkpoint**：`imm-autowork --json` — runtime 命令原语（非可安装技能），仅报告 workflow snapshot，主要供 `imm-loop` 和 Pi lifecycle adapter 消费。

**内部闭环**（两种模式共用）：
```
imm-work → imm-executor → imm-qa
    ↑            │            │
    │   (rework) ←────────────┤
    │                         │
    └───────── (pass) ────────┘
```

**关键机制**：
- **单步锁**：每次仅激活一个步骤，防止超范围修改
- **YAGNI 红线**：executor 自审 + qa 复查，拒绝重构/未来防护/非步骤变更
- **TDD 纪律**：`test-first` 步骤强制 RED → GREEN → REFACTOR
- **诊断循环**：Bug 步骤强制 3-5 可证伪假设 + 单一变量测试
- **快速通道**：≤2 步可自动校验的计划，激活→执行→质检单次 turn 完成
- **HANDOFF.md**：每次 QA Pass 自动维护跨会话连续性快照

**熔断条件**：Rework / Replan / Blocker / 预算耗尽 / 取消 / Compounder handoff。

**辅助技能**：`test-fixer` — executor 可在活跃步骤内派发，专门修复测试断言/快照/Mock，但严禁触碰生产代码。

---

#### 阶段四：`imm-code-review` / `imm-ui-review` — 多维评审

Plan 完成且有实质变更后，对完整分支变更集进行深度审计。

**代码评审**：`/imm-code-review`

按 `subagent-trigger-catalog.yaml` 的触发条件自动匹配透镜，通过 `imm-advisory-reviewer` 容器并行派发只读子智能体：

| 透镜 | 触发条件 |
|------|---------|
| `security` | 认证/授权/输入校验/密钥/安全配置变更 |
| `api_contract` | API 路由/响应 Schema/序列化/版本变更 |
| `data_integrity` | 数据库迁移/数据模型变更 |
| `reliability` | 并发/错误处理/资源管理变更 |

**UI 评审**：`/imm-ui-review`

DESIGN.md 优先为审查契约，按变更表面自适应裁剪校验。自动匹配 UI 透镜：`ui_a11y` / `ui_responsive` / `ui_i18n` / `ux_heuristic` / `ui_visual`。

**评审后的三种路由**：
- **同边界小修复** → 生成 `follow_up` 交 `imm-work` 快速处理（不重新走 planner）
- **跨边界大问题** → 路由到 `imm-planner` 重新规划
- **全部通过** → 进入下一阶段

**辅助技能**：
- `imm-pr-fix` — 已提交 PR 遇到 CI 失败/Review 打回/合并冲突时使用，远程诊断 + 隔离分支并行修复
- `imm-advisory-reviewer`（`debug_hypothesis` lens）— 遇到复杂 Incident 或难复现 Bug 时使用，强制科学方法（反馈环 → 假设 → 单一变量）
- `imm-advisory-reviewer` 透镜 — `ai_eval`（评估集/Rubric/Guardrails/监控变更）、`prompt_contract`（System Prompt/Tool Schema 变更）、`release_readiness`（部署/回滚/特性开关变更）、`docs`（README/手册/CLI 范例变更）显式触发

---

#### 阶段五：`imm-compounder` — 知识沉淀

全部闭环后，将本次迭代中的知识持久化，实现"越用越聪明"。

**调用**：`/imm-compounder`（在完成 handoff 后由用户明确触发）

**工作方式**：
1. 调用 `imm-finish` CLI 记录开发洞察
2. 批判自我审查（可证伪性/证据链/复用价值）
3. 主题追加到 `docs/solutions/` 四大中心（workflow / contracts / infra / architecture）
4. 标记 `rejected: true` 的否决决策，防止重蹈覆辙
5. 满足条件时建议创建 ADR
6. 刷新 MEMORY.md 和 CONTEXT.md 架构地图
7. 消费派发遥测日志和子智能体记分卡

---

## 完整技能速查表

### 核心链路技能

| 技能 | 工作流位置 | 职责 |
|------|-----------|------|
| `imm-brainstorm` | 阶段一 | 需求框定，产出 BR-* 脑暴清单 |
| `imm-planner` | 阶段二 | 迭代规划，产出 Spec + Plan |
| `imm-loop` | 阶段三 | 当前对话中的可观察 autorun，隔离 QA/review |
| `imm-work` | 阶段三 | 单步驱动、协调执行与质检 |
| `imm-executor` | 阶段三 | 手术式代码修改 |
| `imm-qa` | 阶段三 | 基于物证的质量判定 |
| `imm-code-review` | 阶段四 | 多透镜代码评审 |
| `imm-ui-review` | 阶段四 | 界面可用性与设计还原评审 |
| `imm-planner`（`page_design` mode） | 阶段二/三之间 | 页面实现前的页面设计契约 |
| `imm-compounder` | 阶段五 | 知识沉淀与智力复利 |

### 阶段辅助技能

| 技能 | 所属阶段 | 用途 | 触发方式 |
|------|---------|------|---------|
| `imm-init` | 前置 | 项目就地激活 | 首次使用时手动 |
| `imm-brainstorm`（`roundtable` mode） | 阶段一/二 | 多角色技术选型论证 | 争议时手动 |
| `imm-brainstorm`（`adversarial` mode） | 阶段一/二之间 | 高风险任务工程边界锁定 | 安全/迁移/跨边界时自动触发 |
| `imm-arch-explorer` | 阶段二 | 架构深度扫描 | 重构前手动 |
| `test-fixer` | 阶段三 | 测试断言/Mock修复 | executor 派发 |
| `imm-advisory-reviewer`（`debug_hypothesis` lens） | 阶段四 | 科学方法调试 | Incident/难复现 Bug 时手动 |
| `imm-pr-fix` | 阶段四 | PR CI/Review/冲突修复 | PR 阻塞时手动 |
| `imm-planner`（`page_design` mode） | 阶段二/三之间 | 页面设计契约 | 页面生成或重排前手动 |
| `imm-advisory-reviewer` | 阶段四 | 透镜子智能体容器 | code-review/ui-review 自动派发 |

---

## 技能详解

### 核心链路技能

#### `imm-brainstorm` — 需求澄清与框定

**用途**：将模糊想法转化为结构化、可验证的脑暴清单。

**工作方式**：
1. 扫描 `docs/solutions/` 历史否决决策，避免重蹈覆辙
2. Socratic 内联收敛：扫描四大鸿沟（证据/受众特异性/替代路径/最小交付边界）
3. 多领域任务可并行派发只读研究子智能体
4. 产出五种 ID 的脑暴清单

**产出格式**：
- `BR-REQ-*`：确认需求 | `BR-DEC-*`：确认决策 | `BR-OUT-*`：非目标
- `BR-DEFER-*`：延迟项 | `BR-Q-*`：开放问题（全部答复前阻断规划）

**CONTEXT.md 感知**：遇到模糊术语时检查 CONTEXT.md 规范术语，缺失时建议规划中创建。

---

#### `imm-planner` — 迭代规划器

**用途**：将脑暴清单物化为 Spec + Plan。

**工作方式**：
1. 以可验证"结果单元"为颗粒度拆解步骤
2. 每个 BR-* ID 必须映射到归宿
3. `imm-plan --json` 校验语法和逻辑闭环

**关键行为**：
- **脑暴追溯**：BR-* 映射不完整 → 校验不通过
- **恶魔代言人审计**：发布前自检回滚韧性/验证虚荣性/规格稀释
- **执行姿态标注**：test-first / characterization-first / Prototype

---

#### `imm-autowork` — Checkpoint runtime 原语（非可安装技能）

**用途**：读取 State Ledger 并报告 workflow snapshot。它是 runtime/CLI 命令原语（`imm-autowork --json`），不是可安装技能，也不是用户可见强自动入口。

**工作方式**：
1. 读取当前 Plan、active Step、execution evidence 与 review gate 状态
2. 返回 `stop_reason`、`next_recommended_skill`、`recommended_authority` 与 `required_input`
3. 可消费 host 显式传入的 QA queue，但不默认作出 QA 结论

**边界**：不调用 executor、不调用 QA、不调用 reviewer、不调用 compounder。强自动推进由 `imm-loop` 消费 checkpoint 后完成。

---

#### `imm-work` — 当前步骤驱动器

**用途**：执行态中央协调器，确保每次只修改当前步骤范围内的代码。

**工作方式**：
1. 检查活跃步骤或 pending follow_up
2. 步骤有 `parallel_probes` 时先派发并行只读探针
3. 激活步骤 → Executor → 收集证据 → QA
4. QA Pass 后更新 HANDOFF.md

**关键行为**：
- **单步锁**：一次仅一个活跃步骤
- **快速通道**：≤2 步可自动校验 → 单次 turn 完成
- **HANDOFF.md**：每次 QA Pass 自动更新，压缩前填充恢复字段
- **Child Evidence**：子证据仅咨询，不能关闭步骤或绕过 QA

---

#### `imm-executor` — 外科手术式执行器

**用途**：只修改当前步骤声明的代码，不碰计划外文件。

**YAGNI 三项红线**（记录证据前自审）：
1. **重构拒绝**：不捎带无关整理和架构调整
2. **未来防护修剪**：删除步骤未声明的抽象/参数/接口
3. **手术映射**：每行变更映射到步骤 Result 和 Verification

**TDD 纪律**（`test-first` 步骤）：
- RED：先写失败测试，确认失败原因与缺口一致
- GREEN：最小实现使测试通过
- REFACTOR：绿灯下清理结构并重跑测试

**诊断循环**（Bug/Incident 步骤）：
- 先建最小可复现脚本 → 3-5 可证伪假设 → 单一变量排除 → 锁定根因后修复

**原型步骤**（`Prototype: true`）：
- 跳过 TDD，聚焦回答问题，删除前将答案持久化为 ADR 或 solution

---

#### `imm-qa` — 质量判定器

**用途**：基于执行物证判定 pass/rework/replan。

**工作方式**：
1. 检查 `record-execution` 记录的执行证据
2. 尊重 `imm-autowork` snapshot 的 `recommended_authority` / `allowed_actions`；QA 只在 `awaiting_qa_decision` 边界记录 pass/rework/replan
3. Zoom-Out 全局核查：局部通过 + 全局劣化 → 一票否决
4. YAGNI Rework Gate：发现冗余代码 → rework
5. Plan Fit 升级：步骤与计划不匹配 → replan
6. Origin Coverage 闭包：最终 Plan 关闭前校验 origin_coverage

**三种判定**：
- **pass** → `imm-work` 下一步
- **rework** → `imm-executor` 局部重做
- **replan** → `imm-planner` 结构变更

**Pi host 注意**：如果 Immune-Brain host helper 不可用或命令超时，使用 plugin-local CLI wrapper 继续同一个 State Ledger。Pi 中优先从已加载 skill 的绝对路径反推 `<plugin-root>`（`/.../plugins/immune-brain/skills/<skill>/SKILL.md` → `/.../plugins/immune-brain`），例如 `<plugin-root>/bin/imm-autowork --json`；不要因为目标仓库缺少 `plugins/immune-brain` 就判定 runtime 不可用。Pi 任务追踪使用 `todo`；不要在 Pi-facing 操作说明中要求不存在的 Task 工具。

---

#### `imm-code-review` — 多透镜代码评审

**用途**：全分支变更集安全/性能/契约深度审计。

**工作方式**：
1. plugin-local `imm-activation-plan` CLI 目录驱动触发匹配
2. 生成委托包（共享上下文 + 文件分片）
3. 并行派发 `imm-advisory-reviewer` 只读子智能体
4. 父级合成评审报告

**Follow-up 直通**：同边界小修复 → 生成 follow_up → `imm-work` 处理。跨边界大问题 → `imm-planner`。

---

#### `imm-ui-review` — 界面评审

**用途**：UI 变更的设计还原与可用性核验。

**工作方式**：DESIGN.md 优先 → 缺失时回退设计中性防粗糙规则 → 按变更表面自适应裁剪：
- 表单 → 防错 + 纠错
- 异步 → 状态可见性（loading/active）
- 导航 → 一致性
- 空状态 → 极简美学

---

#### `imm-planner`（`page_design` mode）— 页面设计契约

**用途**：页面生成或重排前，先定义 `page_design`，避免实现时边写边决定版式；有设计来源或用户明确要求时才定义视觉字段。

**工作方式**：减少元素 → 一区块一核心信息 → 列表页保证扫描性 → 详情页保证上下文完整性 → 操作区和信息区分离。

**使用时机**：放在 `imm-planner` 之后、`imm-work` 或 `imm-ui-review` 之前；它不写代码、不创建 `DESIGN.md`，只给后续实现和评审提供版式约束。

---

#### `imm-compounder` — 知识沉淀器

**用途**：实现"越用越聪明"的智力复利。

**工作方式**：
1. `imm-finish` CLI 记录洞察 → 状态脱水
2. 批判自我审查（可证伪性/证据链/复用价值）
3. 主题追加到 `docs/solutions/`（workflow/contracts/infra/architecture）
4. `rejected: true` 标记否决决策
5. 满足三标准（难以逆转/无上下文会困惑/真实权衡）时建议 ADR
6. 刷新 MEMORY.md + CONTEXT.md 架构地图

---

### 阶段辅助技能

#### `imm-init` — 项目初始化

在任意已有项目中就地激活。调用 `/imm-init`，创建 `.imm/memory/`、`docs/` 等目录，零污染（不拷贝引擎代码），完全幂等。

---

#### `imm-brainstorm`（`roundtable` mode）— 多角色圆桌论证

重大技术选型时，并行派发 2-4 个只读专家子智能体（Security/SRE/Tech Lead），归一化输出为 position/risk/disagreement/confidence/decision_criteria。无异议标记 agreements，有争议留档 role_decisions。移交 `imm-planner`。

---

#### `imm-brainstorm`（`adversarial` mode）— 预计划高压审查

高风险任务的触发式风险阀门（非默认流程）。选择 Scope 姿态（Hold Scope / Scope Reduction / Selective Expansion），决策树展开逼出边缘情况，可选派发魔鬼代言人子智能体做对抗审计。

---

#### `imm-arch-explorer` — 架构分析

深度扫描浅模块/循环依赖/模糊领域边界，支持领域地图模式并行派发。移交前进行 Best-Fit Challenge（爆炸半径/维持现状成本/更简单替代/为什么当前方案可能错）。

---

#### `imm-pr-fix` — PR 修复

拉取远程诊断快照 → 分类 Blocker（check_repair / feedback_repair / conflict_repair） → 隔离分支并行修复 → 统一 CI 验证。

---

#### `test-fixer` — 测试修复器

由 executor 在活跃步骤内派发，仅修改显式委托的测试文件，严禁触碰生产代码。

---

#### `imm-advisory-reviewer`（`debug_hypothesis` lens）— 调试调查器

强制科学方法：建立最小可复现脚本 → 3-5 可证伪假设（声明信号和预期观测） → 单一变量逐一排除 → 锁定根因。

---

### 专项评审透镜

以下透镜由 `imm-code-review` 或 `imm-ui-review` 在 `imm-advisory-reviewer` 容器中按触发条件自动派发。全部纯只读、无工具、高隔离。

| 透镜 | 派发方 | 触发条件 |
|------|--------|---------|
| `security` | code-review | 认证/授权/输入校验/密钥/安全配置 |
| `api_contract` | code-review | API 路由/响应 Schema/序列化/版本 |
| `data_integrity` | code-review | 数据库迁移/数据模型 |
| `reliability` | code-review | 并发/错误处理/资源管理 |
| `ui_a11y` | ui-review | 无障碍标签/焦点顺序/ARIA |
| `ui_responsive` | ui-review | 布局/CSS/视口适配 |
| `ui_i18n` | ui-review | locale 资源/硬编码文字/RTL |
| `ux_heuristic` | ui-review | 交互流程/状态可见性 |
| `ui_visual` | ui-review | 组件样式/设计还原 |
| `prompt_contract` | code-review | System Prompt/Tool Schema 变更 |
| `release_readiness` | code-review | 部署/回滚/特性开关/数据迁移回滚 |
| `docs` | code-review | README/手册/CLI 范例/代码示例 |
| `ai_eval` | code-review | 评估集/Rubric/Guardrails/监控变更 |

---

## v0.5.0 关键能力

### HANDOFF.md 与跨会话连续性
每次 QA Pass 后 runtime 自动刷新 `HANDOFF.md` 的 `GENERATED` 标记区（Plan、已完成步骤、活跃步骤、已知阻塞）。标记区之外的内容由 agent 维护：上下文压缩前填充 Compaction Handoff 区段（最多 5 个优先重载文件、会话决策、下一边界技能）。`HANDOFF.md` 是这些字段唯一的留存位置——机器可读镜像与 `--rehydrate` 已随 `imm-dehydrate` 退役。

### CLI 激活计划
通过 plugin-local `<plugin-root>/bin/imm-activation-plan` 生成确定性子智能体派发计划；`<plugin-root>` 来自已加载 plugin package，不要求目标仓库内存在 `plugins/immune-brain`。Review 主机使用 CLI runtime 作为当前主入口。

### 全局子智能体激活策略
`~/.immune-brain/config.toml` 中 `[subagent_activation]` 控制：
- `auto`：边界清晰时自动使用子智能体
- `explicit_only`：仅用户显式请求时使用（默认推荐）
- `disabled`：完全禁用

会话中输入以下内容开启自动派发：
> 本会话允许 Immune-Brain 在 auto 且边界清晰时自动使用 bounded readonly subagents/parallel probes。

### 派发遥测与记分卡
子智能体派发结果和 Finding 级采纳/拒绝统计持久化到 `.imm/memory/`，`imm-compounder` 消费以量化 ROI 并优化触发目录。

---

## 最佳实践

### 三条黄金守则

1. **Advisory 与 Execution 物理隔离**：所有透镜只读，代码修改由 `imm-executor` 和 `test-fixer`（仅测试文件）承载
2. **规划与执行状态紧锁**：无激活步骤不能修改代码；QA 判定仅依赖 `record-execution` 物证
3. **文件分片调度**：子透镜只接收相关文件分片，最大化专注度和 Token 效率

### 日常操作速查

| 我想... | 用快捷路径 | 或逐步控制 |
|---------|-----------|-----------|
| 开始新任务 | `/imm-planner` → `/imm-loop`（当前对话 autorun） | `/imm-brainstorm` → `/imm-planner` → `/imm-loop` |
| 逐步推进（非自动） | — | `/imm-work` 替代 `/imm-loop` |
| 只做代码评审 | — | `/imm-code-review` |
| 只做 UI 评审 | — | `/imm-ui-review` |
| 页面实现前先定设计 | — | `/imm-planner`（`page_design` mode） |
| 修复 PR | `/imm-pr-fix` | — |
| 分析架构 | `/imm-arch-explorer` | — |
| 技术选型争论 | `/imm-brainstorm`（`roundtable` mode） | — |
| 调试复杂 Bug | — | `/imm-advisory-reviewer`（`debug_hypothesis` lens） |
| 初始化新项目 | `/imm-init` | — |
