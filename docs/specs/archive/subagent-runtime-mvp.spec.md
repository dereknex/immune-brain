# Spec: subagent runtime MVP host

**任务 ID**: IMM-SUBAGENT-004
**负责人**: Planner
**状态**: Accepted（仓库内契约已由 focused regression 锁住；真实 `spawn`/委派行为仍以 §7 Codex 手工验证为准）

## 1. 目标

把仓库当前“已有 subagent contract 与独立 skill host，但没有真实 delegation runtime”
的状态，推进到一个最小可执行的 runtime MVP：

- 选择一个共享宿主，让它在 Codex runtime 中真实执行显式 subagent delegation
- 复用已存在的 dedicated reviewer skill surfaces，而不是新增 roster
- 保持 `advisory`、只读、trigger-only、non-default gate 边界

当前 runtime path 只覆盖一个宿主：`imm-code-review`。它只在 review 子问题可清晰拆分、且
trigger surface 被明确命中时，显式激活 cataloged reviewer subagents。

## 2. 问题背景

当前仓库在 subagent 方向已经完成三层相邻工作：

- `README.md`、`.imm/specs/workflow-skill-subagent-orchestration.spec.md`、
  `.imm/specs/skill-trigger-template-routing.spec.md` 已经把 shared truth
  对齐到 `subagent-first + explicit solo fallback`
- `security-reviewer`、`api-contract-reviewer`、`data-integrity-reviewer`、
  `reliability-reviewer` 等都已进入“本地独立 skill surface + trigger-only +
  fallback”模式
- `imm-party` 已经验证了 `shared_context_summary + focus_delta` 的 layered
  delegation packet 以及显式 fallback 模式

当前缺口在于：仓库里还没有一条共享 workflow skill 真正承担“父流程显式调用
subagent”的 runtime host 职责。现状仍然是：

- `.imm/imm-plan.py` 与 `.imm/imm-work.py` 只识别或展示 `Agent Hint`
- repo 内没有真实 `spawn_agent` 调用约束被写进执行-facing host contract
- “subagent 可被调用”主要停留在命名、边界与手工验证层，而不是一个最小的
  真实 delegation path

因此下一步不应继续扩 reviewer roster，而应先让一条最小 runtime path 跑通。

## 3. 功能需求

### R1. Single explicit runtime host

- 当前只把 `skills/imm-code-review/SKILL.md` 作为第一个共享 runtime host。
- 该 host 的职责是：在 code review 场景下，当子任务可清晰拆分且互不阻塞时，
  显式激活已有 specialized reviewers。
- 当前 cataloged advisory lenses 为 `security`、`api_contract`、`data_integrity`、`reliability`，均由 `imm-advisory-reviewer` 承载。
- 不得同时扩到 `imm-work`、`imm-planner`、`imm-party` 之外的其他 shared host。

### R2. Explicit activation and fallback contract

- `imm-code-review` 只有在以下条件同时满足时，才允许真实 delegation：
  - review 子问题边界清晰
  - 子任务互不阻塞
  - 对应 reviewer trigger surface 被明确命中
  - 当前环境支持可靠 subagent 调用
- 若任一条件不成立，必须显式 fallback 到 solo，并说明原因，例如：
  - `unclear_boundary`
  - `unavailable_environment`
  - `cost_scope_mismatch`
  - `trigger_not_hit`
- 允许并行 reviewer delegation，但最大并发受 host-bound catalog 限制；不得借机抽象成通用 multi-reviewer dispatcher。

### R3. Delegation packet and synthesis discipline

- 父 host 必须沿用已验证的 layered delegation packet：
  - one shared `shared_context_summary`
  - one per-reviewer `focus_delta`
- child reviewer input 还必须明确：
  - `tool_policy`
  - `fallback_reasons`
  - `output_expectation`
- 默认 `tool_policy: no tools`，保持 reviewer advisory-only posture。
- 父 host 负责：
  - 合并 reviewer findings
  - 去重与冲突仲裁
  - 把结果收敛回标准 `code_review` 输出
- 任一 child reviewer 失败时，最多只重试 `1` 次；仍失败则显式回退到
  `imm-code-review` 主流程，不得伪装成 reviewer 已成功执行。

### R4. Reviewer boundary preservation

- Cataloged child reviewers 在 runtime MVP 中仍必须保持：
  - advisory-only
  - read-only
  - no code edits
  - no plan writes
  - no workflow-state mutation
  - no QA closure
- 它们仍然不是默认 gate，只在 trigger surface 命中时加入。
- 父 host 也不得把 delegated findings 直接升级成 scope authority、execution
  authority 或 QA decision。

### R5. Truthful verification path

- focused regression 至少要直接证明：
  - `imm-code-review` 被描述成显式 runtime host
  - child reviewer delegation 只在 trigger hit 时发生
  - layered packet 与 fallback reason 被明确写出
  - no shared registry / no automatic dispatcher truth 仍成立
- 若 repo 不能自动端到端证明真实 runtime delegation，可接受 Codex runtime
  manual validation，但必须写清 available / unavailable 两类预期行为。

## 4. 验收标准

- [x] `imm-code-review` 成为首个明确的 shared runtime host，而不只是 broad reviewer 描述。
- [x] runtime MVP 当前覆盖 `security-reviewer`、`api-contract-reviewer`、`data-integrity-reviewer`、`reliability-reviewer` 四条 cataloged child path。
- [x] delegation 需要 `shared_context_summary + focus_delta`，并显式写出 fallback reasons。
- [x] child reviewer 继续保持 advisory-only、只读与 non-default posture。
- [x] focused regression 与 manual validation 至少共同证明：仓库已有一条真实、可描述的
      delegation path，而不是只有 roster / contract prose。
- [x] 本轮没有引入 shared runtime registry、automatic reviewer dispatch、
      agent-to-agent communication、或 `imm-work` 级自动化。

### 验收证据

- **Focused regression**：`tests/test_skill_contracts.py` 中 `SkillContractTests.test_runtime_mvp_host_contracts_are_explicit_and_non_platform`（以及同文件中 reviewer packet、`README`/`imm-code-review` 相关的 subagent-first 断言）。
- **Manual validation**：本章 §7「Codex Runtime Manual Validation」Scenario A（runtime host available）与 Scenario B（unavailable or fallback）；CI 不模拟 Codex `spawn_agent`。

## 5. 非目标

- 不实现通用 subagent registry 或 shared dispatch engine。
- 不把 cataloged advisory lenses 升级成默认 gate。
- 不把 `imm-work`、`imm-planner` 或其他 workflow host 一次性改成真实 delegation 宿主。
- 不扩到 `release-readiness-checker`、`debug-investigator` 或其他非 cataloged reviewer 的真实 runtime orchestration。
- 不引入 agent-to-agent 通信、长期 reviewer memory、后台调度或自动 availability detection。

## 6. 依赖项

- 依赖 [workflow-skill-subagent-orchestration.spec.md](docs/specs/workflow-skill-subagent-orchestration.spec.md)
  作为 shared split / fallback / authority truth。
- 依赖 [skill-trigger-template-routing.spec.md](docs/specs/skill-trigger-template-routing.spec.md)
  作为 trigger routing truth。
- 依赖 [security-reviewer-runtime.spec.md](docs/specs/security-reviewer-runtime.spec.md)
  与 [api-contract-reviewer-runtime.spec.md](docs/specs/api-contract-reviewer-runtime.spec.md)
  作为 child reviewer runtime host 基线。
- 依赖 [bounded-advisory-delegation-packets.md](docs/solutions/bounded-advisory-delegation-packets.md)
  与 [advisory-roundtable-layer.md](docs/solutions/advisory-roundtable-layer.md)
  作为 layered packet 与 explicit fallback 模式来源。
- 依赖 `skills/imm-code-review/SKILL.md` 与 `skills/imm-party/SKILL.md`
  作为 runtime-host wording 的相邻模板。

## 7. Codex Runtime Manual Validation

当 repo 内无法自动端到端模拟真实 delegation 时，使用以下人工验证路径：

### Scenario A. runtime host available

1. 在支持 `spawn_agent` 的 Codex runtime 中，准备一次明确同时包含 broad technical
   review 与 security 或 API contract trigger 的 review 任务。
2. 通过 `imm-code-review` 进入 review，并要求按 bounded reviewer slices 执行。
3. 预期行为：
   - `imm-code-review` 明确说明是否触发 delegated reviewers；
   - 若 trigger 命中且环境可用，host 使用显式 subagent activation；
   - child reviewer 只返回 advisory findings，不改代码、不写 plan、不做 QA；
   - 父 host 合并 findings 并在主输出中保留 fallback / retry / conflict 说明。

### Scenario B. runtime host unavailable or fallback

1. 在不支持可靠 subagent activation 的环境中，执行同类 review 任务。
2. 预期行为：
   - `imm-code-review` 不伪装成已经完成 delegated review；
   - 输出明确记录 solo fallback reason；
   - 仍保持 `imm-code-review` 作为 broad technical baseline，并在需要时附带最小
     security / contract notes。
