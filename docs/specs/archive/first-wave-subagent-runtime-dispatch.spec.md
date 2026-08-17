# Spec: First-Wave Subagent Runtime Dispatch

**任务 ID**: IMM-DISPATCH-001
**负责人**: Planner
**状态**: Accepted

## 1. 目标

把 Immune-Brain 的 subagent 体系从"治理契约 + skill 文本约定"推进到"host skill
可在真实 runtime 中自主判断、调度、回收和容错"的可执行状态。

首版只覆盖三个已有 dispatch host（`imm-code-review`、`imm-party`、`imm-ui-review`）
和已命名的第一波 child reviewers。不引入通用 registry、scheduler 或 agent-to-agent
通信。

## 2. 问题背景

当前仓库在 subagent 方向已完成：

- 三层 subagent 模型（核心闭环 / 条件风险 / 项目专用）及 manifest v1
- `shared_context_summary + focus_delta` layered delegation packet（imm-party 首验）
- reviewer capabilities have runtime specs and focused regressions; conditional-risk reviewers now run through `imm-advisory-reviewer` lenses
- `imm-code-review` 被命名为首个 shared runtime host
- 标准化 fallback reason（`unclear_boundary` / `trigger_not_hit` /
  `unavailable_environment` / `cost_scope_mismatch`）
- 56 条 contract tests 全部通过

核心缺口：仓库里没有任何 skill 或工具包含**可执行的 dispatch 指令**——没有环境检测、
没有 Task tool / spawn_agent 调用模板、没有结果解析流程、没有异常处理逻辑。
所有 delegation 描述仍停留在"应该怎么做"的原则层，而不是"agent 拿到 skill 后
就能直接执行"的 runtime 层。

## 3. 功能需求

### R1. Shared dispatch protocol

创建一份可被所有 host skill 引用的共享 dispatch protocol reference。该 protocol
必须覆盖以下 6 个阶段：

1. **Environment detection**: 判断当前 runtime 是否支持 subagent dispatch
   （Cursor → Task tool; Codex → spawn_agent），输出 `dispatch_available: bool`
2. **Trigger matching**: 基于 diff / task 内容匹配 child reviewer trigger surfaces
3. **Delegation prompt construction**: 从 layered packet 模板生成 per-child prompt
4. **Platform dispatch invocation**: 使用 runtime 原生工具发起 subagent 调用
5. **Result collection & synthesis**: 收集 child 输出，merge / dedup / conflict resolution
6. **Exception handling**: retry（最多 1 次）→ solo fallback → reason code reporting

该 protocol 必须是 provider-agnostic 的：同一份 skill 在 Cursor 和 Codex 中都能
按对应路径执行。

### R2. Host skill dispatch instructions

以下三个 host skill 必须各自包含引用 R1 protocol 的具体 dispatch 指令：

| Host | Child reviewers | Dispatch pattern |
|------|----------------|-----------------|
| `imm-code-review` | `security-reviewer`, `api-contract-reviewer` | Parallel bounded reviewers |
| `imm-party` | Advisory roles (2-4) | Parallel advisory roundtable |
| `imm-ui-review` | Specialized UI subagents (when delegated) | Sequential or parallel |

每个 host 必须包含：
- 判断何时 dispatch vs solo 的决策逻辑
- delegation prompt 模板（引用 shared protocol）
- 结果合并策略
- 异常处理和 fallback 路径

### R3. Exception handling standards

所有 host 共享以下异常处理标准：

- **Retry**: 首次 dispatch 失败后最多重试 1 次
- **Timeout**: subagent 超过合理时间未返回时，视为 failed
- **Degraded results**: child 返回部分结果时，合并可用部分并标注 degraded
- **Solo fallback**: 所有 retry 用尽后，host 自行完成该 reviewer 的最小覆盖
- **Reason reporting**: 每次 fallback 必须记录标准 reason code
- **Conflict resolution**: 多 child 结论冲突时，按 `security > performance >
  compatibility > readability` 仲裁

### R4. Contract regression

- 新增 contract tests 覆盖三个 host 的 dispatch protocol wording
- 现有 56 条 tests 不得 break

### R5. End-to-end runtime validation

至少一个 host 必须在当前 runtime（Cursor）中完成一次真实 dispatch：
- subagent 被成功调用
- child 结果被收集并合并到 host 输出
- 若环境不支持，solo fallback 被正确触发并记录

## 4. 验收标准

- [x] `docs/reference/subagent-dispatch-protocol.md` 存在，覆盖 R1 的 6 个阶段
- [x] `imm-code-review` 包含可执行的 dispatch 指令并引用 protocol
- [x] `imm-party` 包含可执行的 dispatch 指令并引用 protocol
- [x] `imm-ui-review` 包含可执行的 dispatch 指令并引用 protocol
- [x] 异常处理覆盖 retry / timeout / degraded / solo fallback / reason code
- [x] `python3 -m unittest tests.test_skill_contracts` 通过且包含新 dispatch 断言
- [x] 至少一个 host 有真实 runtime dispatch 或 documented solo fallback evidence

### 验收证据

- **Protocol doc**: `docs/reference/subagent-dispatch-protocol.md` 包含完整 6 阶段
- **Host skills**: 3 个 host 均有 `## Dispatch Protocol` 段引用共享 protocol
- **Contract tests**: `python3 -m unittest tests.test_skill_contracts` 61 tests pass（含 5 条新 dispatch 断言）
- **Runtime dispatch**: Cursor Task tool 成功 dispatch `security-reviewer` 作为 `generalPurpose` subagent（`readonly: true`）；child 返回标准 `security_review` 格式输出（result: pass, 6 findings）；parent 成功收集并解析结果
- **Plan validator**: `python3 .imm/imm-plan.py docs/plans/2026-05-11-055-feat-first-wave-subagent-runtime-dispatch-plan.md --json` passes

## 5. 非目标

- 不实现通用 subagent registry 或 automatic dispatcher
- 不引入 agent-to-agent 通信或长期 subagent memory
- 不修改 `.imm/*.py` CLI 工具的核心逻辑
- 不把 conditional-risk reviewers 升级为默认 gate
- 不覆盖第二波 reviewers（data-integrity / reliability / release / debug）的 runtime host

## 6. 依赖项

- [subagent-runtime-mvp.spec.md](docs/specs/subagent-runtime-mvp.spec.md)
  — runtime host boundary
- [workflow-skill-subagent-orchestration.spec.md](docs/specs/workflow-skill-subagent-orchestration.spec.md)
  — split gate / fallback truth
- [bounded-advisory-delegation-packets.md](docs/solutions/bounded-advisory-delegation-packets.md)
  — layered packet pattern
- [standardized-reviewer-delegation-layered-packets.md](docs/solutions/standardized-reviewer-delegation-layered-packets.md)
  — reviewer packet standardization
