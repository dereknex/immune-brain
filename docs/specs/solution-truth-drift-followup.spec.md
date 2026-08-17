> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: solution truth drift follow-up

**任务 ID**: IMM-SOL-TRUTH-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 subagent rollout 完成后遗留的 solution 文档 truth drift，使 `docs/solutions/` 中被后续
`imm-brainstorm` / `imm-planner` 复用的模式文档不再陈述过期的 runtime 激活边界。

本切片只处理文档事实同步，不重新设计 reviewer roster，不新增 runtime host，不改测试逻辑，
也不扩成 shared runtime / registry 讨论。

## 2. 问题背景

最近一轮 remaining-subagents rollout 已把 `reliability-reviewer`、`release-readiness-checker`
与 `debug-investigator` 推进到本地独立 skill surface + explicit trigger + fallback 模式；
`README.md`、`tests/test_skill_contracts.py` 与 `MEMORY.md` 已同步到这个新 truth。

但至少一份 solution 文档仍停留在旧状态：它还写着 `reliability-reviewer`、
`release-readiness-checker`、`debug-investigator` 未被激活，且引用的回归测试数量仍是旧值。
这会把后续 research / planning 重新拉回过期边界，形成“README 与 solution 文档彼此矛盾”的知识源漂移。

## 3. 功能需求

### R1. Narrow repair boundary

- 只修复已确认存在 truth drift 的 solution 文档。
- 若相邻 solution 文档也直接复述了过期 rollout truth，可一并同步；若没有直接漂移，不要顺手重写。
- 不回头改已通过的 reviewer spec、runtime spec、skill host 或 workflow state。

### R2. Truth alignment

- solution 文档不得继续陈述：
  - `reliability-reviewer` 未激活；
  - `release-readiness-checker` 未激活；
  - `debug-investigator` 未激活；
  - 旧的 skill-contract regression 数量。
- solution 文档应明确：
  - 当前 repo 中已命名 reviewer slices 的 runtime-host truth；
  - 该模式文档自身覆盖的层级边界；
  - 若某些 reviewer 已超出该文档原始覆盖面，必须写成“另见相邻 pattern”，而不是继续写错现状。

### R3. Verification path

- 至少通过以下方式验证：
  - `imm-plan <plan-path> --json` 通过；
  - 文档 diff 能证明过期 truth 已被移除；
  - `python3 -m unittest tests.test_skill_contracts` 仍通过，保证 solution 文档引用的 repo truth 没再和回归入口分叉。

## 4. 验收标准

- [ ] 至少一份存在漂移的 solution 文档被修正为当前 truth。
- [ ] 文档不再声称 remaining reviewers 未激活。
- [ ] 文档中的回归数量或 runtime claim 不再落后于当前 repo。
- [ ] 修复范围保持在 solution / memory / plan 文档层，不扩回 reviewer 功能实现。

## 5. 非目标

- 不新增 reviewer。
- 不改现有 reviewer host 或 runtime contract。
- 不调整 `README.md` 已完成的路由 truth，除非为解决直接矛盾所必需。
- 不引入新的 solution taxonomy 或 shared runtime 平台抽象。

## 6. 依赖项

- 依赖 [docs/solutions/conditional-risk-reviewer-activation-hosts.md](docs/solutions/conditional-risk-reviewer-activation-hosts.md)
  作为已确认存在 truth drift 的目标。
- 依赖 [README.md](README.md) 与
  `tests/test_skill_contracts.py`
  作为当前 repo truth 的主证据。
