> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Workflow-entrypoint Telemetry Bridging

**领域**: Agent workflow / telemetry / runtime hooks
**描述**: 当系统已经有 raw telemetry schema 与手动 `record` 命令，但
`usage_events.jsonl` 仍长期为空时，首要修复通常不是扩 schema，而是把 telemetry
bridge 接到真实 workflow entrypoints，并显式定义 exact metadata 与 estimated
fallback 的边界。

**reusability**: high
**next_reuse_scenarios**: [`某个 system-facing signal 已有 schema 但长期无数据, 需要先确认真实执行入口是否接线`, `需要把手动-only observability 命令接回 repo-local workflow 生命周期`, `未来为更多 imm-* entrypoints 增加 telemetry / metrics hooks 时复用 exact-vs-estimated contract`, `要验证写入失败不会阻塞 workflow 主路径时复用同类 focused regression 套件`]

## 场景

- 仓库已经有类似 `.imm/imm-telemetry.py record` 的原始记录入口。
- 文档、spec 或用户直觉都把“telemetry 没数据”误解成记录逻辑有 bug。
- 真实可执行面并不在 `SKILL.md`，而在 repo-local workflow entrypoints，例如
  `imm-work`、`imm-review`、`imm-finish`。
- 系统并不直接拥有 provider usage truth，因此不应该静默伪造 exact token 数据。

## 方案模板

1. **先定位真实执行面**: 先区分 prompt contract 与 execution surface。对 Immune-Brain
   来说，真实挂点是 repo-local workflow entrypoints，而不是 `SKILL.md` 文本。
2. **把手动 telemetry 抽成 shared helper**: 不要在每个入口复制 `record` 参数拼装逻辑；
   抽一个 workflow transition helper，统一 exact / estimated 的事件构造。
3. **exact contract 必须显式命名**: 只有当完整 runtime metadata 存在时才写
   `source=exact`。本轮采用固定环境变量 contract，如 `IMM_TELEMETRY_MODEL`、
   `IMM_TELEMETRY_PROMPT_TOKENS`、`IMM_TELEMETRY_LATENCY_MS` 等。
4. **缺 exact metadata 时默认 estimated，而不是继续空文件**: 如果本切片目标是让真实
   workflow 开始沉淀事件，那么默认 no-op 只会把“长期空 trace”问题保留下来。
5. **只在真实 transition 上挂 hook**: 例如 `imm-work activate`、`imm-review apply_review`
   和 `imm-finish finish_closure`。不要为了“多记一点”而在旁路 helper 或纯展示命令上乱挂。
6. **写入失败必须降级，不得阻塞主路径**: telemetry 失败时允许丢事件，但不能阻塞 step
   activation、QA closure 或 finish closure。
7. **用 focused regressions 锁住 3 类 truth**: estimated path、exact path、failure
   isolation。不要只验证 happy path 写文件成功。

## 可复用前提

- 已经存在稳定的 workflow 主链和 repo-local entrypoints。
- telemetry 本身是次要信号，不能反过来成为 workflow 的阻塞依赖。
- 团队接受“先记录 workflow 活动趋势，再逐步扩真实 usage truth”的演进顺序。
- 当前系统至少能从本地状态推导出 step/result/evidence 文本与 wall-clock duration。

## 验证依据

- [docs/plans/2026-05-10-039-feat-workflow-entrypoint-telemetry-record-plan.md](docs/plans/2026-05-10-039-feat-workflow-entrypoint-telemetry-record-plan.md)
  把切片拆成文档契约、`imm-work`、`imm-review`、`imm-finish` 与 failure-isolation 五个结果。
- [.imm/specs/workflow-entrypoint-telemetry-record.spec.md](docs/specs/workflow-entrypoint-telemetry-record.spec.md)
  明确了真实 entrypoints、exact env contract 与 `estimated` fallback。
- `.imm/imm-telemetry.py`
  新增 workflow transition helper，并支持 exact-env / estimated 两条路径。
- `.imm/imm-work.py`,
  `.imm/imm-review.py`,
  `.imm/imm-finish.py`
  已分别在真实 transition 上接入 telemetry，而不是停留在手动命令。
- `tests/test_workflow_loop.py`
  覆盖 `imm-work` / `imm-review` / `imm-finish` 的 estimated path、exact path、以及
  telemetry failure does not block 的回归。
- `tests/test_telemetry_trace.py`
  继续守住底层 raw schema 与 trace 写入行为。

## 约束与建议

- 不要把“`usage_events.jsonl` 空”直接等价成“需要新的 telemetry schema”。
- 不要把 exact 和 estimated 混成一套不透明数据；source 必须可区分。
- 不要把 telemetry hook 接到 `status`、README 示例或别的非 transition 位置，避免噪音事件。
- 如果更完整的 workflow suite 有无关旧失败，可以在 QA evidence 中显式标明边界，但不要让它
  否定当前 focused telemetry slice 的 closure。
- 如果后续要记录真实 provider usage，优先扩 runtime handoff contract，不要回退成
  prompt contract 猜测。

---
*沉淀日期: 2026-05-10 | 来源: workflow-entrypoint telemetry record U1-U5 全步骤验收*
