> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Canonical Runtime State Paths

**领域**: Agent workflow / runtime state management
**描述**: 当多个 workflow 工具共享同一份运行态文件时，必须先定义 canonical 路径，再决定是否保留 legacy 兼容读取。不要让不同工具各自推导自己的默认状态路径，否则闭环会在跨工具切换时无声断开。若该文件表示“当前活跃工作”，finish 成功后还必须先把摘要写入 durable memory，再立即 reset active runtime state，避免把“最近一次任务痕迹”继续伪装成 current。

**reusability**: high
**next_reuse_scenarios**: [`imm-work` / `imm-review` / `imm-dehydrate` 这类共享 runtime state 的工具链, 运行态文件从旧目录迁移到新目录, 需要同时兼顾历史兼容与单一 source of truth, 给 finish/dehydrate 这类闭环工具增加 durable memory 维护、归档或轮转逻辑]

## 场景

- workflow 的状态由多个小工具共同读写，例如 `imm-work`、`imm-review`、`imm-dehydrate`、`imm-finish`。
- 仓库曾经存在旧路径和新路径并存，或不同工具默认拼接出的路径不一致。
- 某个工具单独运行看起来正常，但一旦切到下一个工具，active step、review closure 或 dehydrate 会因为读到另一份状态文件而失联。
- 用户侧感知会表现为流程反复、QA 找不到 active step、finish/dehydrate 失效，且日志容易暴露大量内部补救过程。
- 即使所有工具都统一到同一路径，只要这份文件同时承担“当前运行态”和“最近一次任务历史”，finish 之后的下一轮仍会被旧状态污染。

## 方案模板

1. **先定义 canonical 路径**: 为共享运行态文件指定唯一默认位置，例如 `.imm/memory/current_iteration.json`。
2. **所有读写工具统一到 canonical**: `work`、`review`、`dehydrate`、`finish` 等入口都默认读写同一位置。
3. **仅在读取阶段保留 legacy 兼容**: 如果历史状态可能仍在旧路径，读取时允许 fallback；一旦保存，就回写到 canonical，并清理 legacy 重复文件。
4. **active runtime 与 durable snapshot 分离**: `current_iteration` 只表示当前活跃迭代；finish 成功时先把摘要与必要上下文写入 `state.json` / `MEMORY.md`，再 reset active runtime state。
5. **兼容逻辑收敛为有限修复**: 只自动修复可恢复的路径漂移或旧路径遗留，不要把兼容层扩成长期双写，或长期把“最后一次任务”继续暴露为 current。
6. **durable memory 维护也必须走 canonical helper**: 如果闭环工具要压缩、归档或重写 `MEMORY.md`，默认目标应从同一个 runtime path helper 推导，例如 `.imm/memory/MEMORY.md`，而不是临时创造根目录 `MEMORY.md`。测试这类默认路径时，用临时 `IMMUNE_PROJECT_ROOT` 隔离项目根，并在测试 `setUp` 中重置可变模块级路径，避免 focused regression 误改真实 durable memory。
7. **回归验证按修复 slice 收窄**: 至少覆盖 `work + review`，并在可能时覆盖 `dehydrate/finish`，但只验证本轮 touched contract；不要把无关 health gate leftovers 当成 closure 前置条件。

## 可复用前提

- workflow 工具之间通过本地文件交换状态，而不是只靠进程内内存。
- 路径兼容是迁移遗留，不是产品长期需求。
- 系统希望保留自动恢复能力，但不接受多个真实 source of truth 长期并存。
- `current_iteration` 的语义是“当前活跃工作”，不是“最近一次完成记录”。

## 验证依据

- `imm-work.py` 现在把 canonical 路径设为 `.imm/memory/current_iteration.json`，并在读取时兼容 legacy 状态，保存时回写 canonical。
- `imm-review.py` 已同步同一套 canonical/legacy 规则，避免 QA 找不到当前 step。
- `imm-finish.py` 现在复用同一套 loader/self-heal，并在 finish 成功后 reset `current_iteration`，避免旧 active state 持续污染下一轮。
- `imm-dehydrate.py` 已切到同一 canonical `memory/` 目录，并在 finish 前保留 durable snapshot。
- `test_imm_work.py` 与 `test_imm_review.py` 覆盖 canonical/legacy 迁移、兼容读取与 healed-state 一致性。
- `test_workflow_loop.py` 新增 healed-status-vs-finish 对齐与 finish-after-dehydrate reset regression，证明 `work -> review -> finish -> dehydrate` 的闭环既能保留摘要，又不会残留伪活动状态。
- 后续 memory lifecycle 修复中，`imm-finish.py` 的历史轮转默认目标改为 `runtime_paths()["summary"]`，归档路径相对 `runtime_paths()["project_root"]` 解析；`test_workflow_loop.py` 同时覆盖显式临时 memory 与默认 runtime memory 解析，避免再次分裂出根目录 `MEMORY.md`。

## 约束与建议

- 不要把“兼容 legacy 读取”误做成长期双写；双写只会让 source of truth 再次分裂。
- 如果一个工具的默认路径和其他工具不一致，这不是局部 bug，而是 workflow contract 漂移。
- 如果 runtime 文件承担的是 active state，就不要在 finish 之后继续把最后一次任务结果留在里面；历史应进 durable memory，active state 应清空。
- 如果维护的是 durable memory，也不要让测试或 helper 默认写到仓库根目录；根目录同名文件通常是 source-of-truth 漂移的早期信号。
- 这类修复应优先沉淀成跨工具 contract 和 focused regression，而不是只补单个入口的热修。
- 若整文件级回归被无关历史债务卡住，应先把本轮验收收窄到 touched contract，而不是顺手扩成另一个 repair slice。
- 文档里明确 canonical 路径，比在出错时打印大量恢复日志更有效。

## Pattern: Bounded Hot State Ledger Tail + JSONL Archive

> **Partially implemented.** The tail bound and the JSONL archive are live again
> in `state_ledger.ts` after the TypeScript port had dropped them. The paired
> `state.json` snapshot step is still missing, so ignore the `dehydrate`
> half of the template below. One lesson the restoration added: put the bound at
> the lowest write primitive, since the obvious entry point turned out to carry
> one call site against twelve for the one beneath it.

**领域**: Agent workflow / runtime state management / auditability
**描述**: 当 `current_iteration.json` 既要保留活跃运行态，又会承载长生命周期的历史时，不要让 hot state 无限增长。做法是：热文件只保留近端 history 尾部（例如 50 条），把更早记录以 JSONL 形式归档到 `.imm/memory/current_iteration_history.jsonl`，并在 `dehydrate` 与恢复入口上用同一边界策略。  
同时，`runtime_status=idle` + `reset_reason=intentional_reset` 作为 finish 有意清空的标记，避免 `state.json.current_iteration` 恢复“刚完成却应保持空闲”的意外重放。

**reusability**: high
**next_reuse_scenarios**: [`current_iteration.json` 被 closure 重复写入但无须新持久化方案, `dehydrate 频繁读取导致 state 快速膨胀`, `希望保留 full audit 但不牺牲 active 文件体积`, `需要区分 accidental 空态与 intentional reset`]

## 场景

- active state 和 closed-step 历史共用一份 JSON，长期运行后体积增长导致 dehydrate/rehydrate 成本上升。
- finish 后的 `state.json.current_iteration` 被误恢复，导致已 intentional reset 的会话又变成 active。
- 希望保留完整审计能力，但不想引入额外数据库或第三方持久化。

## 方案模板

1. 在 `current_iteration_state` 中新增 `HISTORY_TAIL_LIMIT` 与 `compact_current_iteration_history`，保存前截断 `history` 到近端 `N` 条，并把历史余量以 JSONL 归档（含 `archived_at`、`plan_path`、`plan_signature`、`history`）。
2. 将 compact 后的 state 回传给 dehydrate 与持久化路径：`dehydrate` 先读一次 `current_iteration`，按统一历史边界 compact，再将 compacted 对象写回当前文件，再写入 `state.json`。
3. 在恢复逻辑里增加空态区分：未标记的 accidental empty 可回放 `state.json` snapshot，带 `runtime_status=idle` + `reset_reason=intentional_reset` 的 intentional reset 不再回放。
4. 任何涉及运行时状态文件的边界修复，都同步到 `plugins/immune-brain/dist` 并在 package parity 测试里锁定。
5. 用 focused regression 固定：多轮 dehydrate 不应重复归档已归档历史，历史长度在 hot 文件保持上界。

### 方案验证依据

- [current-iteration-efficiency.spec.md](docs/specs/current-iteration-efficiency.spec.md) 记录了 intentional reset 与 hot-state size 的三项要求 R1-R3。
- [2026-06-01-001-fix-current-iteration-efficiency-plan.md](docs/plans/2026-06-01-001-fix-current-iteration-efficiency-plan.md) 对 U1-U3 给出闭环步骤与验证方式。
- `.imm/imm_core/current_iteration_state.py` 新增 history compact、`intentional_idle_current_iteration` 与恢复门控。
- `.imm/imm-dehydrate.py` 在 dehydrate 前 compact hot ledger，并在有归档变更时重写 `current_iteration`。
- `tests/test_current_iteration_state.py` 与 `tests/test_workflow_loop.py` 覆盖 intentional reset 不重放、history 归档与 dehydrate 双次执行幂等。
- `tests/test_immune_brain_plugin_package.py` 锁定 touched runtime 的 plugin parity。

### reusability_critique_notes

- Falsifiability: 如果项目需要严格保留完整 history 在 hot state 内，或历史查询必须 O(1) 读取全量，会不适用该模式；应改成外置审计系统。
- Evidence trail: 证据来自已完成 plan/spec、runtime 修改和 focused 测试，且修复点覆盖 intentional reset 与 dehydrate 二次执行回归。
- Architecture entropy resistance: 追加到 `canonical-runtime-state-paths` hub，保持在运行态路径与容量治理主轴，不新增第三方架构。

### 约束与建议

- 不要只压缩快照而不归档，容易把审计从 active 运行态“黑洞化”。
- 不要把 `state.json.current_iteration` 当成完整历史权威；它是 snapshot，完整历史应从归档文件追加回放。
- 不要把 JSONL 视为替代性真源；真源仍是 canonical `current_iteration.json` 的 active state + 归档链路。

---
*沉淀日期: 2026-06-01 | 来源: `docs/plans/2026-06-01-001-fix-current-iteration-efficiency-plan.md` 闭环修复与复验*

---
*沉淀日期: 2026-05-08 | 来源: session flow and output simplification 闭环后的 dehydrate path 修复；current iteration closure contract repair*
