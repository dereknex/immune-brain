# Spec: skill contract lint

**任务 ID**: IMM-WORKFLOW-005
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 增加一层更明确的 skill/workflow contract lint，使关键
`imm-*` skill 的输出字段、权限边界和 workflow guard 不再只依赖自然语言约定，
而是能被本地测试或结构检查机械验证。

首版聚焦“让 contract 可检查”，不扩展到完整 workflow harness、知识清理或新的
后台自动化。

## 2. 问题背景

当前系统已经具备 `plan/work` 级别的 validator、current-step driver 和部分
skill contract 测试，但对 skill 文档本身的检查仍偏轻，主要覆盖是否存在
`Boundary` / `Output artifact` 以及少量实现权限约束。

OpenAI 在 2026-02-11 发布的 Harness engineering 文章指出，提升 agent 系统
稳定性的关键不只是写更多提示，而是让代码仓库、工具和规则对 agent 来说更
“legible” 且具备机械反馈回路：

- 参考文章：[Harness engineering](https://openai.com/index/harness-engineering/)

对当前仓库来说，最小且高杠杆的首轮改进，不是重做整套执行 harness，而是先把
skill/workflow contract 提升为可检查工件，让 planner/work/review guard 能
在文档、测试和状态约束之间对齐。

## 3. 功能需求

### R1. skill contract lint 范围

- 首版必须覆盖 `imm-*` 用户可见 workflow skill 的核心 contract。
- contract 至少包括：
  - `Next Action`
  - `Allowed`
  - `Blocked`
  - `Workflow guard`
- 首版可以按角色差异保留例外，但例外必须显式定义，不得靠测试豁免散落在代码中。

### R2. 权限边界可检查

- lint 必须能区分只读角色、规划角色、协调角色、执行角色和验收角色。
- 首版至少要能机械检查以下边界：
  - 哪些 skill 不得编辑实现文件
  - 哪些 skill 不得写 plan 或 runtime state
  - 哪些 skill 必须在缺少 validated plan 或 active step 时阻止直接实现
- 不要求首版构建完整语义分类器；优先使用小而明确的规则集合。

### R3. workflow handoff guard 可检查

- lint 必须检查 brainstorm / preplan / planner / work / executor / QA 之间的关键 handoff guard 是否存在。
- 首版必须覆盖：
  - brainstorm 后续实现不能跳过 preplan/planner
  - 无 validated plan 时不能直接实现
  - 无 active step 时不能越过 work/协调层直接执行当前步外改动
- 若某条规则只适用于部分角色，规则应在文档或测试中显式声明适用范围。

### R4. 文档与测试一致性

- 首版必须让 skill 文档中的 contract 与测试检查口径对齐。
- 若现有 `docs/solutions/` 已沉淀相关模式，计划应复用这些模式，而不是引入新的平行术语。
- 首版无需修改实现逻辑，但应让后续实现者清楚知道要补哪些测试、哪些 skill 文本和哪些 guard。

### R5. 非侵入式首版

- 首版不得把此工作扩展成完整 workflow harness。
- 首版不得新增后台任务、外部服务依赖或复杂规则引擎。
- 首版不得把 prompt 风格、语气或措辞偏好纳入强制 lint 范围。
- 若后续发现需要更强的状态级验证，应单独规划 `workflow harness` 作为下一阶段工作。

## 4. 验收标准

- [ ] Spec 明确把首轮范围限定为 skill/workflow contract lint，而不是完整 harness。
- [ ] 计划能指出首版需要覆盖的 contract 字段、权限边界和 handoff guard。
- [ ] 文档中显式记录参考文章 URL，便于后续实现和复盘追溯来源。
- [ ] 后续实现的验证路径可以建立在现有 `tests/test_skill_contracts.py` 或其扩展上，而不是依赖手工检查。
- [ ] 计划经过 `python3 .imm/imm-plan.py <plan-path> --json` 校验通过。

## 5. 非目标

- 不在本轮实现完整 workflow harness。
- 不在本轮实现知识库 GC 或 stale docs 清理。
- 不在本轮新增新的 orchestration runtime。
- 不把文档语言风格变成 lint 规则。
- 不修改 `imm-work`、`imm-executor`、`imm-qa` 的 authority boundary。

## 6. 依赖项

- 依赖 `IMMUNE.md` 中既有的 planner / work / executor / QA 权限边界。
- 依赖 [docs/solutions/skill-local-workflow-guards.md](docs/solutions/skill-local-workflow-guards.md) 已沉淀的跨 turn guard 模式。
- 依赖现有 `tests/test_skill_contracts.py` 作为首版测试入口。
- 依赖已有 `imm-brainstorm`、`imm-preplan-review`、`imm-planner`、`imm-work` 等 skill 文本可被本地读取与检查。

## 7. 首版验证路径

首版实现完成后，至少必须证明下面三类路径；没有这些证据，不得宣称
skill contract lint 已闭合：

### 验证入口约定

- 首选验证入口必须是 `tests/test_skill_contracts.py`。
- 若某类检查在该文件中不适合直接表达，可以补充 focused fixtures 或辅助测试，
  但必须仍由本地测试命令驱动，而不是退回人工 checklist。
- `tests/test_skill_contracts.py` 或其扩展至少要覆盖：
  - contract fields coverage
  - role boundary coverage
  - workflow guard coverage

### V1. contract fields coverage

- 场景：扫描全部 `skills/imm-*/SKILL.md`。
- 期望：要求纳入检查范围的 skill 都包含 `Next Action`、`Allowed`、`Blocked`
  和 `Workflow guard` 契约说明。
- 证明方式：测试或 focused fixture 明确报告缺失字段的 skill 名称。

### V2. role boundary coverage

- 场景：检查规划、协调、执行、验收和只读角色的关键边界文本。
- 期望：只读/规划/协调 skill 不误宣称可改实现；执行/验收 skill 的权限边界与
  `IMMUNE.md` 一致。
- 证明方式：测试输出能区分哪类 contract 缺失属于权限越界，而不是笼统失败。

### V3. workflow guard coverage

- 场景：检查 brainstorm -> preplan/planner -> work 的跨阶段 guard。
- 期望：缺少 validated plan 或 active step 的情况下，相关 skill 文本会把后续实现
  路由回正确阶段，而不是允许直接改代码。
- 证明方式：测试或 fixture 明确断言存在对应 guard 文本，并能指出缺失的 skill。

## 8. 参考资料

- OpenAI, "Harness engineering", 2026-02-11:
  [https://openai.com/index/harness-engineering/](https://openai.com/index/harness-engineering/)
