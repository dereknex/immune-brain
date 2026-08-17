> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: System-Facing Evolution Evidence Packet Foundation

**领域**: Agent workflow / skill evolution / telemetry / upstream methodology
**描述**: 当系统要持续改进自身的 `skills` 或 `subagents` 时，首刀应先补齐
system-facing 的 `evolution packet` 证据层，而不是把分析角色塞进 target-project
`imm-brainstorm`，也不要提前做自动改 skill 或自动建计划。

- `reusability: high`
- `next_reuse_scenarios: ["新增 system-facing Evolution-Analyst 入口", "扩 raw telemetry schema 后补 success/ROI 指标", "把 upstream methodology 变化纳入后续人工复盘", "为 skill/subagent 优化建立统一 evidence packet 输入"]`

## 场景

- 系统已经有 project-facing 的 `imm-brainstorm`、`imm-preplan-review`、`imm-planner`
  等 workflow gate。
- 仓库已经能收集 `dev insights`、记录 raw telemetry，或维护 `upstreams/` 参考来源。
- 团队希望基于日常记录、成本信号和上游变化改进系统自身，而不是某个目标项目的交付方案。
- 未来可能需要 analyst / strategist 角色，但当前还没有足够稳定的 system-facing 证据输入。

## 方案模板

1. **先把 evidence packet 做完整**: 至少先收敛 `dev insights report`、`telemetry summary`、
   `upstream diff summary` 三类输入，再讨论分析角色或自动化闭环。
2. **明确 system-facing 边界**: 这类输入服务的是 Immune-Brain 自身演进，不是目标项目
   的 framing；不要把它们挂到 `imm-brainstorm` 下面。
3. **summary 只输出 schema 已支持的指标**: telemetry 首版只做确定性 token / latency 聚合，
   不要在缺少 outcome/progress 字段时伪造 success、ROI 或“值不值得”的结论。
4. **upstream sync 先做 deterministic local summary**: 优先读取本地 `git submodule`
   状态和 commit subjects，先覆盖 changed / unchanged / missing / uninitialized 边界，
   不要一开始引入 LLM 摘要或远程依赖。
5. **degraded-input 必须显式可见**: `telemetry summary` 或 `upstream diff summary` 缺失时，
   要保留 degraded state，而不是伪装成完整分析上下文。
6. **把 analyst 延后为独立 system-facing 入口**: 等 evidence packet 稳定后，再决定是否增加
   `Evolution-Analyst`；它应是独立入口，不是 `imm-brainstorm` 的变体。

## 可复用前提

- 系统已经有 project-facing workflow gate，不需要再把“自我演进分析”混进目标项目的 scope 判断。
- 现有 telemetry schema 还不足以支撑 success / ROI 级判断。
- 团队接受“先做 deterministic evidence，再做更高层 analyst”的迭代顺序。
- `upstreams/` 已作为参考来源存在，且本地 git 状态可被读取。

## 验证依据

- [.imm/specs/skill-evolution-framework.spec.md](docs/specs/skill-evolution-framework.spec.md)
  现已把范围收窄为 evidence packet foundation，并明确 future analyst 不属于
  `imm-brainstorm`。
- [docs/plans/2026-05-10-038-feat-skill-evolution-framework-plan.md](docs/plans/2026-05-10-038-feat-skill-evolution-framework-plan.md)
  将实现拆成 3 个独立 outcome：telemetry summarize、upstream sync、README packet boundary。
- `.imm/imm-telemetry.py`
  新增 `summarize` 子命令，只输出当前 raw schema 支撑的稳定 token / latency 聚合。
- `.imm/imm-upstream-sync.py`
  新增本地 deterministic submodule 摘要入口，覆盖 changed / unchanged / missing /
  uninitialized 状态。
- [README.md](README.md)
  已明确 `evolution packet` 是 system-facing 输入，保留 degraded-input 边界，并说明未来
  analyst 不能放进 `imm-brainstorm`。
- `tests/test_telemetry_trace.py`,
  `tests/test_upstream_sync.py`,
  `tests/test_skill_contracts.py`
  分别覆盖 summary 聚合、upstream sync 边界，以及 README 的 system-facing contract。

## 约束与建议

- 不要把 `imm-brainstorm` 扩成“系统自我演进分析中心”；它仍然只服务目标项目 framing。
- 不要在 evidence packet 还没稳定之前就引入自动建计划、自动改 `SKILL.md`、自动 subagent
  选择或 ROI 结论。
- 如果后续确实要判断 `subagent_cost_mismatch`、`high_cost_low_progress` 或
  `skill_success_rate`，先单独扩 raw telemetry schema，再重新规划。
- 如果 upstream 变化需要更高层解释，先保留 deterministic diff summary，把解释层单独放进
  未来 system-facing analyst，而不是反向污染 sync 命令本身。

---
*沉淀日期: 2026-05-10 | 来源: skill evolution evidence packet foundation U1-U3 全步骤验收*
