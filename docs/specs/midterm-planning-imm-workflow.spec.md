# Spec:  Immune-Brain 中期规划交付闭环与目标追踪

**任务 ID**: IMM-MIDPLAN-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标
将中期规划执行方式从“方向讨论”收敛到“可追踪闭环”，围绕现有 `imm-*` 工作流建立：

- 治理主线（固定）：统一交付闭环治理，保证 `imm-brainstorm -> imm-preplan-review -> imm-planner -> imm-executor/imm-qa` 的 handoff 结构稳定一致。
- 扩展主线（固定）：建立 1 套高复用的中期目标追踪模板，支持目标、KPI、验收与回退条件的统一记录。
- 目标周期：3-6 个月，优先稳定和复用输出，避免一次性改造过深。

## 2. 需求

### R1. 交付闭环治理
- 统一 handoff 与计划入口字段映射，确保从 `imm-brainstorm` 与 `imm-preplan-review` 到 `imm-planner` 的 `Origin / Research / Decisions / Assumptions` 不丢失。
- 明确 `imm-preplan-review` 的阻塞条件与放行条件，避免范围漂移导致的无效规划。
- 形成“可复用治理主线结果清单”，用于后续每次预规划快速核验。

### R2. 中期目标追踪模板（高价值扩展）
- 提供一套统一模板，记录每个中期目标：问题陈述、范围、KPI、验证方式、回退条件、里程碑。
- 模板必须支持 1+1 结构（1 个治理主线 + 1 个扩展主线）默认格式。
- 输出应能直接用于 `imm-planner` 的 Task 与 Step 依据。

### R3. 验收与复盘机制
- 1+1 两个主线必须有可验证验收指标与复盘时间点。
- 采用“单一可复用入口”记录，减少不同文件中重复口径。
- 非本轮范围：不做上游项目扩展，不新增外部工具链，不做运行态系统改造。

## 3. 验收标准
- [ ] 中期规划 spec 在 `.imm/specs/` 存在且明确写明“治理主线 + 扩展主线 + 目标周期 + 验收路径”。
- [ ] 对应 plan 在 `docs/plans/` 中提供至少 2 个独立闭合 step，每个 step 可被单独验收。
- [ ] 计划与 handoff 字段链路支持从 `imm-brainstorm`/`imm-preplan-review` 直接切入，不依赖额外上下文。
- [ ] 规划文档明确不扩展运行态实现与工具链，仅覆盖治理与模板两条主线。
- [ ] 在 `imm-plan <plan-path> --json` 下通过 validator，或记录明确的失败原因与修正动作。

## 4. 依赖项
- 依赖 `IMMUNE.md` 的流程边界。
- 依赖现有 `imm-brainstorm` 与 `imm-preplan-review` 的边界产物。
- 依赖 `docs/brainstorms/` 的历史 handoff 与 `docs/plans/` 的既有计划结构。

## 5. 非目标
- 不扩展到上游项目范围。
- 不新增功能型 skill 或执行能力。
- 不新增自动化执行器或复杂 CI 任务。

