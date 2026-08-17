---
reusability: high
key_files:
  - .imm/imm-work.py
  - .imm/imm-autowork.py
  - .imm/memory/current_iteration.json
  - skills/imm-work/SKILL.md
  - plugins/immune-brain/dist/imm-autowork.md
  - tests/test_imm_autowork.py
---

# Pattern: Codex Plan Task Snapshot

**领域**: Agent workflow / Codex interaction
**描述**: 当本地 workflow 已有持久 plan 和运行态状态时，给 Codex 输出一个只读任务快照，让原生 `update_plan` 面板展示进度，而不是把 Codex 面板变成新的状态源。

## 场景

- workflow 的真实状态保存在本地文件，例如 plan 文档和 `.imm/memory/current_iteration.json`。
- 用户在 Codex 中希望看到原生 task list 的 pending / in_progress / completed 状态。
- 直接让 Codex task list 反写本地状态会引入双写、漂移和绕过 QA 的风险。

## 方案模板

1. **保留本地状态源**: 真实状态仍来自 plan 文件和 workflow state 文件。
2. **输出只读快照**: status 命令额外返回 `codex_plan.tasks`，每行包含稳定 step id、展示文本、状态和验证要求。
3. **状态单向派生**: 从 V2 State Ledger 的 `state["steps"]` 直接读取每步的权威状态，映射为展示字符串：
   - `closed` → `"completed"`
   - `ready_for_review` → `"in_review"`
   - `rework_needed` → `"needs_rework"`
   - `replanning` → `"needs_replan"`
   - `active` / `probing` / `executing` → `"in_progress"`
   - `pending` → `"pending"`
   
   **关键约束**: 展示层必须读取权威账本状态，不能通过兼容层 API（如 `derive_active_step`）推导状态。兼容层会将 `replanning` 折叠为不可见、将 `ready_for_review` 和 `rework_needed` 折叠为 `active`，导致展示与路由脱节。
4. **由协调 skill 同步展示**: 在 Codex 中由 coordinator 调用 `update_plan`，只同步展示，不记录验收结论。
5. **明确非目标**: 不做 Codex -> 本地状态的反向同步，不自动跑完整 plan，不扩大 executor/QA 权限。

## Refinement: Autowork snapshots carry final display state

当一个 coordinator 本身会连续改变 workflow 状态，例如 `imm-autowork`
在同一轮激活 Step、记录执行证据、进入 QA 或完成 Step，最终返回值也应携带
最新 `codex_plan.tasks`。这样 host 可以直接从 `run_snapshot.codex_plan.tasks`
刷新 Codex 原生任务面板，不必额外猜测是否还需要再调用一次 `imm-work status`。

复用约束：

- `codex_plan` 必须仍由 `imm-work status` / State Ledger 派生，coordinator 只透传快照。
- `ready_for_review` 只能展示为 `in_review`；不能把执行证据成功等同为 QA `pass`。
- `closed` 只能由 `imm-review pass` 后展示为 `completed`。
- snapshot 字段必须是 additive，旧调用方忽略它时不影响原有 autowork 行为。

## 可复用前提

- 计划步骤有稳定标识，例如 `U1` / `U2`。
- 本地 workflow 能可靠区分 completed steps 和 active step。
- Codex 任务面板只是协作界面，不承担审计或状态持久化职责。

## 验证依据

- `.imm/specs/codex-plan-sync.spec.md` 定义了单向快照和非目标。
- `.imm/imm-work.py status` 已输出 `codex_plan.tasks`，并从当前 active plan 与 `.imm/memory/current_iteration.json` 派生状态。
- `skills/imm-work/SKILL.md` 要求 Codex 使用 `update_plan` 同步 `codex_plan.tasks`，同时禁止把 Codex task display 当成可写状态源。
- `README.md` 说明 `codex_plan.tasks` 用于 Codex 原生任务面板，真实状态仍来自 `.imm` 文件。
- `python3 .imm/imm-plan.py docs/plans/2026-05-07-006-feat-codex-plan-sync-plan.md --json`、`python3 .imm/imm-work.py status`、`python3 -m py_compile .imm/imm-work.py` 和 focused `rg` 检查均通过。
- 2026-05-26 验证: `build_codex_plan` 的 6 状态断言测试确认全部 V2 账本状态映射正确（closed/replanning/rework_needed/ready_for_review/executing/pending → 对应展示字符串），无状态漂移。
- 2026-06-08 验证: `imm-autowork` 的 `run_snapshot` 追加只读 `codex_plan.tasks`。`tests/test_imm_autowork.py` 证明 execution evidence 后返回 `in_review`，QA `pass` 后返回 `completed`，budget stop 后保留已完成 Step 与 pending next Step；`tests/test_skill_contracts.py` 锁定 `run_snapshot.codex_plan.tasks` 的 host contract。`python3 -m unittest tests.test_imm_autowork tests.test_immune_brain_mcp_runtime tests.test_immune_brain_plugin_package tests.test_skill_contracts` 共 194 tests 通过，计划校验通过。

## 约束与建议

- 不要在 task row 中记录 QA 通过与否之外的推断；状态必须从本地 workflow state 派生。
- 如果需要反向同步，必须单独设计冲突处理、权限边界和审计记录。
- 用户可见输出应优先展示 `codex_plan.tasks` 的状态和 next skill，而不是暴露完整 state history。

## reusability_critique_notes

- Falsifiability: 如果 coordinator 不会在一次调用内改变 workflow 状态，或者 host 有可靠的强制 post-status hook，直接返回 final display snapshot 的收益会下降。
- Evidence trail: 证据来自 closed Step U1、QA pass、194 条 focused/unit/package/contract tests、source/dist parity，以及最终 `imm-autowork --json` 返回 completed task status。
- Architecture entropy resistance: 这是对既有 `Codex Plan Task Snapshot` 模式的 refinement，追加到本文件即可；不需要新增 workflow engine、driver skill、MCP tool 或 ADR。

---
*沉淀日期: 2026-05-07 | 来源: Codex native plan sync 全步骤验收*
