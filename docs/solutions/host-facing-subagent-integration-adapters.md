---
reusability: high
next_reuse_scenarios:
  - subagent helper has tests but is not reachable from a host-facing path
  - telemetry should be recorded without making pure planning helpers side-effectful by default
  - review synthesis needs to merge child findings into a parent review result
  - reviewer output preserves findings but the aggregate result may incorrectly pass
rejected: true
rejection_reason: Remote telemetry backends, dashboards, shared reviewer registries, and real dispatch were explicit non-goals for this slice; the verified solution kept integration local and host-facing.
---

> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Host-Facing Subagent Integration Adapters

**领域**: Agent workflow / subagent dispatch telemetry / review synthesis
**描述**: 当 subagent helper 已有测试但只停留在 standalone 函数时，需要补一个 host-facing adapter，把 helper 接到真实可调用路径；同时保留纯 helper 的默认无副作用语义。review synthesis 还必须让 aggregate `result` 跟 findings 的可执行状态一致，不能在保留 child findings 的同时返回 pass。

## 场景

- `activation_plan` 能算出 split / solo，但 host review path 没有默认记录 dispatch telemetry。
- telemetry helper 存在，但普通 plan builder 被要求保持 side-effect free。
- child reviewer arbitration helper 能处理冲突，但 parent host 没有统一 synthesis adapter。
- code review 发现 synthesis adapter 虽然保留 findings，却把有 actionable findings 的结果标成 pass。

## 方案模板

1. **保留纯核心函数**: 让原有 builder 默认不写文件、不调度 subagent、不依赖外部 runtime；测试和 CLI 仍可直接调用它。
2. **增加 host-facing wrapper**: 新增明确命名的 host path，例如 `build_host_activation_plan(...)`，在 wrapper 内开启 telemetry 或其他 host side effect。
3. **把 side effect 做成可替换参数**: telemetry 路径、execution status 等通过参数注入；测试使用临时路径，避免污染仓库。
4. **让 synthesis adapter 调用同一个 arbitration helper**: parent host 不复制冲突排序逻辑，只消费 `arbitrate_child_findings(...)` 的结果。
5. **把 aggregate result 映射成三态**:
   - unresolved grouped conflict -> `blocked by unresolved reviewer conflict`
   - 有 synthesized findings -> `needs fixes with synthesized findings`
   - 没有 findings -> `passes`
6. **为 pass 语义写反向测试**: 除了测试冲突升级，也要测试“有 findings 不能 pass”和“空 findings 才 pass”。

## 可复用前提

- 当前系统的 host skill 主要是 documentation-driven，不是长期运行的 service。
- 本轮目标是把 helper 接入可执行 host-facing path，而不是实现真实 `spawn_agent` / Task dispatch。
- telemetry 可以落到本地 JSONL，不需要远端收集或 dashboard。
- child findings 已有足够字段供 parent synthesis 判断，例如 `priority_lens`、`source_child`、`recommended_action` 和可选 `conflict_group`。

## 验证依据

- `.imm/activation_plan.py` 保留 `build_activation_plan(...)` 默认无 telemetry，同时新增 `build_host_activation_plan(...)` 走记录路径。
- `tests/test_activation_plan.py` 覆盖 host activation split 与 solo fallback 两种 telemetry 事件，测试写入临时 JSONL。
- `.imm/review_arbitration.py` 让 `build_host_review_synthesis(...)` 复用 `arbitrate_child_findings(...)`，并区分 blocked / needs fixes / passes。
- `tests/test_imm_review.py` 覆盖 security-over-performance 冲突、same-priority unresolved、无 `conflict_group` 保留 findings、host synthesis 有 findings 时 needs fixes、空 findings 时 passes。
- `python3 -m unittest tests.test_activation_plan tests.test_telemetry_trace tests.test_imm_review` 通过 71 条测试。
- `tail -c 1 .imm/memory/current_iteration.json | od -An -t x1` 返回 `0a`，本轮 follow-up 后 runtime JSON 保持 POSIX newline 结尾。

## 约束与建议

- 不要为了“接入 host path”把纯 builder 默认改成写文件；用 wrapper 保持旧调用安全。
- 不要把 local telemetry integration 顺手扩展成 remote metrics、dashboard 或 scheduler。
- 不要把 arbitration helper 的优先级逻辑复制到 host skill 文档或第二个函数里；host adapter 应消费 helper 输出。
- 不要让 review result 的 pass 只表示“没有 unresolved conflict”。如果还有 actionable findings，aggregate result 应推动修复。
- 如果未来要把 `follow_up` 持久化进 runtime state，需要另开计划；当前修复只证明会话态 follow-up 可以被手动消费并验证。

---
*沉淀日期: 2026-05-14 | 来源: 2026-05-14-084-fix-subagent-telemetry-arbitration-integration-plan*
