# Spec: workflow skill subagent orchestration

**任务 ID**: IMM-WORKFLOW-008
**负责人**: Planner
**状态**: Accepted（验收证据：统一 orchestration contract 落地至 docs/reference/subagent-dispatch-protocol.md；split gate + solo fallback + conflict arbitration 已写入 host skills；imm-code-review/imm-party/imm-ui-review 均引用共享 protocol；tests/test_skill_contracts.py 通过）

## 1. 目标

为 Immune-Brain 定义一份 repo-local 的 workflow skill -> subagent orchestration contract，
把以下四类规则收敛为同一份可执行规划依据：

- 是否拆分为多角色 / 多 subagent 路径
- skill 主链路的自动激活序列
- `imm-planner` / `imm-work` 前的并行 reviewer 收敛规则
- 子任务失败重试与多意见冲突仲裁规则

首版只定义 planning / routing contract，不实现通用 runtime classifier、shared
dispatcher、默认 reviewer fan-out、后台调度或 authority merge。

## 2. 问题背景

仓库已经完成两层相邻工作：

- `skill-trigger-template-routing` 已定义用户请求如何先路由到
  `imm-brainstorm`、`imm-planner`、`imm-code-review`、`security-reviewer`、
  `imm-work`。
- `system-subagents-design` 与各 reviewer slice 已定义 subagent 的 trigger-only、
  advisory-only 和 fallback boundary。

当前缺口在于：这些规则仍分散在多个 skill / spec / README 片段里，缺少一份“何时默认拆、
拆到哪些 subagents、在哪个 workflow stage 并行收敛、失败后如何处理”的统一 orchestration
contract。没有这层收口，后续实现容易出现：

- 把默认 solo 误当成唯一安全路径，导致可并行的 bounded 子任务也被主流程串行吞掉；
- 把所有复杂任务都默认拆成多 reviewer，流程成本过高；
- 把 `security-reviewer`、`api-contract-reviewer` 之类 conditional reviewers 静默拉成默认 gate；
- 把 `imm-executor` / `imm-qa` 暴露成用户必须手动切换的显式入口；
- 多 reviewer 意见冲突时没有固定仲裁顺序，导致 planner/work 无法稳定收口。

## 3. 功能需求

### R1. Split decision gate

- orchestration 在启用 subagents 前，必须先判定是否拆分。
- 若任务可被清晰拆分为 bounded、互不阻塞、可并行推进的子任务，默认拆分并优先激活 subagents。
- 以下信号通常支持默认拆分，但它们是正向证据而不是全部必须命中：
  - 用户显式要求多角色、复核、审计、parallel review、independent agents
  - `multi_domain >= 2`
  - `risk_high = true`
  - `verification_needed = true`
  - `artifact_count >= 3`
- 以下任一条件成立时，fallback 到 solo：
  - 当前任务是单一紧耦合执行链，下一步直接依赖上一子任务结果
  - 子任务边界不清晰，拆分会导致重复、冲突或过度协调
  - 当前环境不支持可靠并行 subagent
  - 用户明确要求 solo
- 首版只要求 contract 说明“default split + explicit solo fallback”规则；不要求实现通用自然语言分类器。

推荐判定字段：

```text
- split_gate:
  - explicit_multi_role_request: true|false
  - multi_domain_count: <number>
  - risk_high: true|false
  - verification_needed: true|false
  - artifact_count: <number>
  - bounded_parallelizable: true|false
  - split_decision: split|solo
  - rationale: <short reason>
  - solo_fallback_reason: <none|coupled|unclear_boundary|env_unsupported|user_requested>
```

### R2. Default activation sequence

- workflow 的默认主链路必须保持：
  `imm-brainstorm` -> `imm-preplan-review` (conditional) -> `imm-planner` ->
  `imm-work` -> `imm-executor` / `imm-qa` -> `imm-finish`
- `imm-preplan-review` 仍然只在 scope 不稳、验证路径不清、或存在明显跨角色分歧时触发。
- `imm-work` 仍是 validated plan 之后的默认 continue entry；
  `imm-executor` / `imm-qa` 继续保持 authority role，不作为正常成功路径中的默认显式入口。
- orchestration contract 不得让 reviewer/subagent 绕过这条主链。

### R3. Stage-to-subagent mapping

- 当 `split_decision = split` 时，各 workflow stage 默认按需启用最小 subagent 集合：
  - `imm-brainstorm`
    - optional: `context-mapper`，仅用于项目结构/关键文件/现有约定提炼
    - optional: `imm-party`，仅在显式多角色讨论或 scope tension 明显时提供 advisory
  - `imm-preplan-review`
    - optional: `scope-reviewer` 或 `imm-party` advisory handoff 作为研究材料
  - `imm-planner`
    - optional baseline reviewer: `imm-code-review`，仅在 broad technical review /
      review follow-up / CI-style evidence aggregation needed 时加入
    - optional conditional reviewers: `security-reviewer`、`api-contract-reviewer`
      仅在对应 trigger surface 被明确命中时加入
  - `imm-work`
    - optional repeat of the same bounded reviewers only when active-step evidence
      reveals new risk on the current step boundary
- 若没有明确 trigger surface，不得把 conditional reviewers 当作无条件 gate；但主流程仍默认优先使用已经可清晰拆分的 bounded subagents。
- 每个被调用的 subagent 都必须保持既有 authority class，不得升级成 scope、execution
  或 QA authority。

### R4. Parallel review convergence

- 并行 reviewer 只允许在 `imm-planner` 或 `imm-work` 之前作为 advisory evidence layer
  运行，不得直接改计划、改代码或记录 QA 结论。
- 默认 broad review path 是 `imm-code-review`。
- `security-reviewer` 只在 `auth`、`authz`、`input_handling`、
  `public_endpoint`、`secret_flow`、`permission_model`、`security_config`
  变化时加入。
- `api-contract-reviewer` 只在 `api_route`、`request_schema`、`response_schema`、
  `serialization`、`versioning`、`exported_type`、`public_contract`
  变化时加入。
- 首版不实现 reviewer 自动全量并行；只允许 bounded、trigger-based reviewer selection。

### R5. Failure handling and conflict arbitration

- 任一子任务失败时，先重试 `1` 次。
- 若重试后仍失败，由主流程接管，并明确标记：
  - failed_subagent
  - failure_reason
  - fallback_owner
  - residual_risk
- 多 reviewer / subagent 结论冲突时，planner/work 必须按固定优先级仲裁：
  `security > performance > compatibility > readability`
- 若冲突在该优先级下仍无法收口，必须回到 `imm-preplan-review` 或 `imm-planner`，
  不得在执行阶段静默决定。

推荐输出字段：

```text
- orchestration_resolution:
  - failed_subagent: <id|none>
  - retry_count: 0|1
  - fallback_owner: main_flow|planner|work
  - conflict_detected: true|false
  - arbitration_order:
    - security
    - performance
    - compatibility
    - readability
  - unresolved_conflict: true|false
```

### R6. Verification path

- 首版必须至少能验证：
  - split gate 不会把普通单任务默认拆分
  - activation sequence 仍保持 `imm-work` 为 post-plan 默认 continue entry
  - `imm-code-review` 是 broad review baseline
  - `security-reviewer` 与 `api-contract-reviewer` 保持 explicit trigger-only
  - retry-once + main-flow fallback + conflict arbitration 被写成可复用 contract
- 如果真实 orchestration 需要 runtime 支持，plan 必须保留 manual validation path；
  不得假装能完全在本地自动化验证。

## 4. 验收标准

- [ ] 仓库中存在一份统一的 workflow skill -> subagent orchestration contract。
- [ ] split gate 明确说明“可清晰拆分即默认拆分”与 solo fallback 条件。
- [ ] 默认 activation sequence 与既有 authority boundary 不冲突。
- [ ] `imm-code-review`、`security-reviewer`、`api-contract-reviewer` 的并行收敛规则清晰且保持 trigger-only。
- [ ] 子任务失败、重试、主流程接管与冲突仲裁顺序被明确记录。
- [ ] focused verification 或 manual validation path 能证明上述规则不是只停留在散文描述。

## 5. 非目标

- 不实现通用 intent classifier、跨 host shared dispatcher 或后台 runtime dispatch engine。
- 不禁止显式 host skill 在单次会话内使用确定性 catalog 规则生成 activation plan；
  该模式必须保持 host-bound、trigger-based、advisory-only，并由
  [automatic-subagent-activation.spec.md](automatic-subagent-activation.spec.md)
  单独约束。
- 不实现 shared reviewer platform、默认 fan-out、agent-to-agent 通信或长期 subagent memory。
- 不改变 `imm-preplan-review`、`imm-planner`、`imm-work`、`imm-executor`、
  `imm-qa`、`imm-finish` 的 authority boundary。
- 不把 `security-reviewer`、`api-contract-reviewer` 升级成默认 gate。
- 不在本切片中实现自动执行、自动 QA 或后台调度。

## 6. 依赖项

- 依赖 [skill-trigger-template-routing.spec.md](docs/specs/skill-trigger-template-routing.spec.md)
  的基础 skill 路由 truth。
- 依赖 [system-subagents-design.spec.md](docs/specs/system-subagents-design.spec.md)
  的 manifest 字段、authority class 与 output contract 建议。
- 依赖 [workflow-trigger-repair.spec.md](docs/specs/workflow-trigger-repair.spec.md)
  的 explicit trigger / fallback 模式。
- 依赖 `skills/imm-brainstorm/SKILL.md`、`skills/imm-preplan-review/SKILL.md`、
  `skills/imm-planner/SKILL.md`、`skills/imm-work/SKILL.md`、`skills/imm-code-review/SKILL.md`、
  `imm-advisory-reviewer` `security` / `api_contract` lenses
  的现有边界定义。
