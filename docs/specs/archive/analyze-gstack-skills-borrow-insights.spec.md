# Spec: gstack skills 体系深度分析与借鉴引入规划

**任务 ID**: IMM-GSTACK-ANALYZE-001  
**负责人**: Planner  
**状态**: Accepted  

## 1. 目标

- 深度系统化分析 **`upstreams/gstack`** 仓库的技能体系与技术底座，对比本仓库的 **`agent-skills` (Immune-Brain/Impeccable)** 体系。
- 梳理出一份高规格的**《gstack 技能借鉴与引入可行性分析报告》**，沉淀到 **`docs/solutions/gstack-skills-borrow-insights.md`**，实现本仓库的长期知识资本增值。
- 在报告中深度解析以下五个核心借鉴维度：
  1. **文档自治防漂移机制 (SKILL.md Template System)**
  2. **操作级的“微知识库” (Operational Self-Improvement)**
  3. **极速无损的 Web QA 反馈闭环 (Daemon & Accessibility Ref System)**
  4. **安全熔断与防注入沙箱 (Prompt Injection Security Guard)**
  5. **极简场景技能路由表 (Skill Routing)**
- 报告应明确每个维度的：**痛点对齐**、**gstack 技术实现分析**、**本地仓库适配方案** 与 **可行性与引入优先级评估**，并提供清晰的 Mermaid 架构流图与设计伪代码。

## 2. 功能需求

### 2.1 文档化沉淀 (durable solution artifact)

- 新建 `docs/solutions/gstack-skills-borrow-insights.md`。
- 采用 **Immune-Brain Solution** 的高标准组织：
  - **核心摘要 (Abstract)**：三句话概括借鉴目的。
  - **架构对照图 (Mermaid Context Map)**：清晰展示 gstack 守护进程与无障碍 Ref 系统在 QA 反馈环中的工作链路，以及微操作 learnings 的记录检索机制。
  - **五个核心黄金维度 (The Five Golden Ore)**：逐节深入，提供原理大图、本地迁移的 schema 和适配逻辑。
  - **下一步引入规划表 (Action Roadmap)**：排出 Priority-1 (P1, 易落地/高产出) 到 Priority-3 (P3, 需高成本底座支持) 的分期落地图，明确未来在 `agent-skills` 下升级的动作。

### 2.2 五大黄金维度详细定义要求

- **SKILL.md.tmpl 模板与 CI 防御机制**：解析 gstack 如何利用占位符和构建脚本生成最终技能文件，并提出 `agent-skills` 的 `skills/BASELINE.md` 和 `allowed-tools` 对齐方案。
- **Operational Learner 机制**：深入定义本地 learnings 追加 Schema 与 Preamble 时的语义搜索或精细查询（Quirks 映射）流，规划如何提升 Agent 跨会话的操作连续性。
- **Headless Browser Daemon & Accessibility Ref System**：对比传统 Playwright 与常驻 daemons，描述 `@e1`/`@c1` refs 对 AI 交互的减负原理与 SPA state staleness count() 检测，规划对 `imm-qa` 和 `imm-ui-review` 带来的提效。
- **Canary Token 与 ONNX 防注入防御**：详细拆解 L5 Canary Token 自毁的 Deterministic BLOCK 原理，为 `imm-executor` 执行第三方外部命令/不可信数据建立防线。
- **Skill Routing Rules**：在 `README.md` 与本仓库现有 reference 文档中设计首选 Skill 路由表，降低流转摩擦力；根目录当前没有 `CLAUDE.md`，本轮不为路由表单独新增 host-specific 根文档。

### 2.3 计划校验与合法性断言

- 新增迭代计划文件 `docs/plans/2026-05-24-003-analyze-gstack-skills-borrow-insights-plan.md` 必须符合 `imm-planner` 规范。
- 运行 `python3 .imm/imm-plan.py docs/plans/2026-05-24-003-analyze-gstack-skills-borrow-insights-plan.md --json` 必须通过校验。

## 3. 验收标准

- [ ] `docs/solutions/gstack-skills-borrow-insights.md` 文件存在，包含 Abstract、Mermaid Context Map、五个维度章节、Action Roadmap 与 Evidence Index。
- [ ] 报告覆盖五个维度，每个维度都包含 gstack 证据路径、本地痛点对齐、本地适配建议、优先级判断、风险或非目标。
- [ ] Mermaid 使用 fenced `mermaid` code block，roadmap 明确 P1/P2/P3 分期，并区分“可直接借鉴”和“仅记录、暂不落地”。
- [ ] `imm-plan` 命令行对迭代计划的 JSON 校验通过。

## 4. 非目标

- 不在此 epic 阶段进行任何 gstack 技能代码的移植、Bun 守护进程或 Python 运行时的具体编写。这属于后续 `imm-executor` / `imm-work` 的成果。
- 不修改本仓库的现有 skill 契约测试和核心协作流程。
- 不新增根目录 `CLAUDE.md`、shared registry、SQLite/FTS memory layer、浏览器 daemon 或防注入 runtime；本轮只产出证据化分析与后续引入建议。

## 5. 依赖

- 本地已存在 `upstreams/gstack` 子模块并能够被 read tool 精细访问。
- 本地 Python3 及 `.imm/imm-plan.py` 能够正常执行。
