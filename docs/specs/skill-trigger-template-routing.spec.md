# Spec: skill trigger template routing

**任务 ID**: IMM-WORKFLOW-007
**负责人**: Planner
**状态**: Proposed

## 1. 目标

为 Immune-Brain 定义一组可直接复用的用户触发模板，把常见请求稳定路由到最小正确 skill：

- 需求不清 -> `imm-brainstorm`
- 需求明确 -> `imm-planner`
- 可清晰拆分的 review / advisory work -> 默认优先 bounded subagents
- 需并行审查 -> `imm-code-review`，并仅在安全敏感面明确命中时附加 `security-reviewer`
- 执行推进 -> `imm-work`

首版只定义 repo-local 的 routing contract、fallback 和验证路径，不实现通用自然语言分类器、
默认并行 reviewer 编排、后台调度或 authority merge。

## 2. 问题背景

仓库已经分别定义了 `imm-brainstorm`、`imm-planner`、`imm-code-review`、
`security-reviewer` 和 `imm-work` 的边界，也已经沉淀了
`trigger-only + fallback + focused regression` 的模式。

当前缺口不是缺 skill，而是缺少一份把这些 skill 汇总为“用户可直接复用的触发模板”的
planning slice。没有这层 contract，后续实现容易出现三类漂移：

- 把 `imm-work` 之前的路由说成“自动”，但没有明确什么条件进入 brainstorm、planner 或 review；
- 把默认 solo 误当成共享主策略，导致本可清晰拆分的 reviewer / advisory 子任务没有被优先激活；
- 把 `security-reviewer` 当成默认并行 reviewer，而不是条件风险审查；
- 把 role 名与 continue entry 混淆，导致已验证计划后的执行推进没有稳定收口到 `imm-work`。

## 3. 功能需求

### R1. Framing trigger template

- 当用户请求缺少最小 framing，至少缺少以下任一项时，默认路由到 `imm-brainstorm`：
  - problem statement
  - key constraint
  - success target
- `imm-brainstorm` 只负责澄清边界和成功标准，不直接产出实现或执行动作。
- 若 brainstorm 后 scope 仍不稳或验证路径不清，后续仍可继续进入
  `imm-preplan-review`；本模板不取消该条件 gate。

### R2. Planning trigger template

- 当请求目标清晰、边界稳定、且当前不存在 validated plan 时，默认路由到 `imm-planner`。
- `imm-planner` 必须继续负责 spec、plan、verification path 和 step decomposition；
  触发模板不得把“需求明确”误读成可以跳过计划直接进入实现。
- 对可被单一独立结果覆盖的小任务，允许 one-step minimal plan，但仍保留 spec / plan / QA 闭环。

### R3. Parallel review trigger template

- 当请求可被清晰拆分成 bounded、互不阻塞的 review / advisory 子任务时，默认优先进入 subagent 路径，而不是先假定 solo。
- `imm-code-review` 仍然是 broad technical review 的基线 reviewer。
- 当用户明确要求并行审查、多角度 review，或任务确实需要 broad technical review 时，
  默认至少进入 `imm-code-review`。
- `security-reviewer` 只在以下任一条件成立时加入：
  - 用户显式要求 security review
  - 当前变更或请求明确触及 `auth`、`authz`、`input_handling`、
    `public_endpoint`、`secret_flow`、`permission_model`、`security_config`
- 若没有明确安全敏感面，不得把 `security-reviewer` 默认并入“并行审查”模板。
- 若任务是单一紧耦合链、子任务边界不清、环境不支持并行 subagent，或用户明确要求 solo，
  模板应显式 fallback 到 solo，而不是隐式保持单人路径。
- reviewer 输出保持 advisory-only；任何 scope 或 repair 结论仍需回到
  `imm-planner` 或 `imm-work`。

### R4. Execution continuation template

- 当 validated plan 已存在，且用户请求“继续执行 / implement / do it / continue”时，
  默认 continue entry 必须收口到 `imm-work`。
- `imm-work` 继续保持 current-step driver 身份，在内部决定 activate / executor / QA
  语义；模板不得要求用户手动切到 `imm-executor` 或 `imm-qa` 才能走正常成功路径。
- 若不存在 validated plan 或 executable step，`imm-work` 必须明确回退到
  `imm-planner` 或 `imm-preplan-review`，而不是直接改代码。

### R5. Fallback and verification contract

- 路由模板必须为每一类触发声明最小 fallback：
  - framing 仍不清 -> `imm-brainstorm` 保持只读收敛，必要时进入 `imm-preplan-review`
  - planning 证据不足 -> 留在 `imm-planner`，不得升级成执行
  - 并行审查缺少 dedicated reviewer trigger -> 保留已可清晰拆分的 bounded subagents，但不默认附带 `security-reviewer`
  - 可拆分判断不成立 -> fallback 到 solo
  - 执行推进缺少 validated plan -> 回到 `imm-planner`
- 首版必须有 focused regression 或可复现检查，证明：
  - 模板文案与 skill contract 没有互相冲突
  - `security-reviewer` 仍然保持条件触发而非默认加入
  - `imm-work` 仍然是计划后的默认 continue entry

## 4. 验收标准

- [ ] 仓库中存在一份明确的 4 模板 routing contract，而不是分散在多个 skill 中靠读者自行拼装。
- [ ] “需求不清 -> `imm-brainstorm`” 与 “需求明确 -> `imm-planner`” 不会绕过 preplan/planner guard。
- [ ] 可清晰拆分的 review / advisory 工作默认优先进入 bounded subagents，而不是默认 solo。
- [ ] “需并行审查” 默认至少落到 `imm-code-review`，但不会自动默认附带 `security-reviewer`。
- [ ] `security-reviewer` 只有在安全敏感面被明确命中时才会被纳入模板。
- [ ] “执行推进 -> `imm-work`” 明确保持 continue entry 语义，而不是 role 混淆。
- [ ] focused verification 能证明 README、skill contract 与测试/检查之间的 routing truth 一致。

## 5. 非目标

- 不实现通用自然语言分类器或意图识别引擎。
- 不实现 shared reviewer dispatcher、默认 parallel fan-out 或长期 subagent memory。
- 不改变 `imm-preplan-review`、`imm-planner`、`imm-work`、`imm-executor`、
  `imm-qa` 的 authority boundary。
- 不把 `security-reviewer` 升级成默认 gate。
- 不在本切片中引入新的 workflow state 字段或后台调度。

## 6. 依赖项

- 依赖 [IMMUNE.md](IMMUNE.md) 的 authority boundary 与 small-step principles。
- 依赖 [workflow-trigger-repair.spec.md](docs/specs/workflow-trigger-repair.spec.md)
  的 observable trigger / fallback 模式。
- 依赖 [workflow-friction-reduction.spec.md](docs/specs/workflow-friction-reduction.spec.md)
  的默认入口收口与 preplan 条件 gate。
- 依赖 [role-entrypoint-contract-separation.md](docs/solutions/role-entrypoint-contract-separation.md)
  对 role 与 continue entry 区分的沉淀。
- 依赖 `skills/imm-brainstorm/SKILL.md`、`skills/imm-planner/SKILL.md`、
  `skills/imm-code-review/SKILL.md`、`imm-advisory-reviewer` `security` lens、
  `skills/imm-work/SKILL.md` 的现有边界定义。
