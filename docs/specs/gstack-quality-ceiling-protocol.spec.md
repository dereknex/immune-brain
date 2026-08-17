# Spec: gstack quality ceiling protocol

**任务 ID**: IMM-GSTACK-QUALITY-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

把 gstack 的三条高价值哲学压进 Immune-Brain 现有 contract 层：

- 极度的角色偏好分离：每个核心 Skill 明确自己最该偏执的质量目标，以及不该越界承担的权力。
- 严苛的交互仪式：把交互纪律收敛为入口门和出口门，而不是增加默认流程成本。
- 湖水烧干式完备性：只在 closed-world 输入存在时强制全量映射和 closure 证明。

本 Spec 只交付 reference guidance 与 focused contract guards，不新增 runtime、shared registry、browser daemon、classifier 或 memory plane。

## 2. 背景

当前实现已经具备主要基础：

- `skills/BASELINE.md` 定义了 Shared Guards、Success Criteria、Collaboration Posture、Hub skill anatomy 和 Shallow Discovery。
- `plugins/immune-brain/dist/imm-brainstorm.md`、`plugins/immune-brain/dist/imm-planner.md`、`.imm/imm_core/plan_runtime.py`、`plugins/immune-brain/dist/imm-qa.md` 已形成 `Brainstorm manifest -> Brainstorm Trace -> origin_coverage -> QA closure` 的完备性链路。
- `docs/reference/automatic-subagent-activation-policy.md` 保持 subagent activation host-bound、trigger-only、advisory-only。
- `docs/reference/gstack-borrow-p1-guidance.md` 已经保留 P1 borrow guidance 和 rejected boundaries。

缺口是：这些能力目前分散在多个文档和 runtime 说明里，缺少一份面向 Skill 质量上限的集中协议，后续 agent 不容易稳定复用。

## 3. 功能需求

### R1. Role Preference Contract

- 新 guidance 必须覆盖至少四个核心 authority / hub Skill：
  - `imm-planner`
  - `imm-executor`
  - `imm-qa`
  - `imm-compounder`
- 每个 Skill 必须明确：
  - preferred bias：该角色最该坚持的质量目标。
  - prohibited drift：该角色不应承担的越界行为。
- wording 必须保留现有三权分立：planner 不实现，executor 不关闭 QA，QA 不改代码，compounder 不替代 closure。

### R2. Interaction Ritual Gates

- 新 guidance 必须把交互仪式收敛成两个门：
  - Entry gate：目标、边界、验证路径、不确定项足够清楚。
  - Exit gate：证据、风险、rework / replan / compound 下一步明确。
- guidance 必须明确：这两个门是轻量 contract，不是默认新增流程阶段。
- guidance 必须与 `skills/BASELINE.md` 的 Success Criteria 和 Collaboration Posture 保持一致。

### R3. Closed-world Completeness Boundary

- 新 guidance 必须明确：湖水烧干式完备性只在 closed-world 输入存在时启用，例如 `Brainstorm manifest` 或 review follow-up packet。
- guidance 必须链接现有链路：
  - `Brainstorm manifest`
  - `Brainstorm Trace`
  - `origin_coverage`
  - QA closure gate
- guidance 必须明确：普通小任务不因该协议自动升级为重流程。

### R4. Deferred and rejected boundaries

- 新 guidance 必须保留当前 rejected boundaries：
  - 不新增 shared registry 或 generic dispatcher。
  - 不新增重复 memory authority。
  - 不新增 browser daemon。
  - 不新增 Canary Token 或 ONNX runtime。
- 新 guidance 必须说明 P2/P3 runtime candidates 需要单独 Spec 和 Plan。

### R5. Focused contract guard

- `tests/test_skill_contracts.py` 或等价 focused guard 必须能验证新 guidance 中的核心短语没有漂移。
- guard 至少覆盖：
  - role preference wording
  - entry gate / exit gate
  - closed-world completeness boundary
  - rejected boundaries

## 4. 验收标准

- [ ] 存在一份 Skill quality ceiling guidance，能让后续 agent 快速理解如何把 gstack 三条哲学应用到当前实现。
- [ ] guidance 不改变 runtime 权限和 State Ledger 语义。
- [ ] focused contract guard 覆盖 guidance 的关键边界。
- [ ] `python3 -m unittest tests.test_skill_contracts` 通过。
- [ ] `imm-plan` 对本轮 Plan 的 JSON 校验通过。

## 5. 非目标

- 不实现 shared registry、generic dispatcher、background scheduler 或 LLM-only router。
- 不实现 browser daemon、Accessibility Ref runtime、Canary Token、ONNX classifier 或 untrusted-output runtime。
- 不新增 `learnings.jsonl`、SQLite、FTS 或新的 memory authority。
- 不改 `Activation Plan` 触发语义。
- 不把所有小任务默认升级成 Brainstorm manifest 或 origin coverage 流程。

## 6. 依赖项

- `skills/BASELINE.md`
- `docs/reference/gstack-borrow-p1-guidance.md`
- `docs/reference/automatic-subagent-activation-policy.md`
- `docs/solutions/gstack-skills-borrow-insights.md`
- `docs/solutions/contracts.md`
- `docs/solutions/rejected-pro-workflow-sqlite-wiki-authority.md`
- `docs/solutions/rejected-shared-registry-generic-dispatcher.md`
- `plugins/immune-brain/dist/imm-brainstorm.md`
- `plugins/immune-brain/dist/imm-planner.md`
- `plugins/immune-brain/dist/imm-qa.md`
- `tests/test_skill_contracts.py`
