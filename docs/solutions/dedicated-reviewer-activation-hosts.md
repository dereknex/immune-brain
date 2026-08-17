> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Dedicated Reviewer Activation Hosts

**领域**: Agent workflow / project-specific reviewer runtime
**描述**: 当 project-specific reviewer 已经有 docs-first contract，但还停留在 README/spec/test 命名层时，下一刀应先交付一个独立的本地 activation host，例如单独的 skill surface。不要把 reviewer activation 偷藏进现有 authority role，也不要为了第一个 runtime slice 直接做 registry 或多 reviewer dispatch。

**reusability**: high
**next_reuse_scenarios**: [`ai-eval-planner`、`docs-verifier`、`release-readiness-checker` 这类 project-specific reviewer/agent 需要从 contract 进入可激活功能层, 某个 reviewer 已有 fallback 与 manual runtime validation 但还没有独立宿主, 团队想先闭环单个 reviewer runtime slice 而不是上 reviewer framework`]

## 场景

- 某个 project-specific reviewer 已经有 standalone contract、fallback 和 focused regression。
- 仓库里还没有 dedicated reviewer skill / manifest / host surface，导致 reviewer 仍只是“被命名能力”。
- 团队想把它推进到可激活功能层，但不想把第一刀扩成 registry、dispatcher 或多 reviewer rollout。
- 系统已经有 `imm-*` authority roles，需要避免 reviewer activation 污染已有 scope / plan / execution / QA 边界。

## 方案模板

1. **先补独立宿主，再谈 runtime 平台**: 首版先新增单独的 reviewer host surface，例如 `skills/<reviewer>/SKILL.md`。
2. **宿主只表达 reviewer 自身契约**: 明确 trigger surface、required inputs、输出焦点、只读 advisory 边界和 fallback，不把其他 reviewer 规则顺手塞进来。
3. **保持 trigger-only posture**: reviewer 只在明确命中对应变化面时激活，不能借 runtime slice 变成默认 gate。
4. **fallback 保留在 repo contract 层**: README 或等价治理文档要明确 dedicated path 缺失时的回退路径，而且要写清这只是基础替代，不是等价完整替代。
5. **自动化只证明本地契约，不冒充平台能力**: 用 focused regression 守住 skill surface、边界、fallback 和 manual validation 文本；不能自动化的 runtime activation 留在人工检查里。

## 可复用前提

- reviewer 已有 docs-first contract，不需要从零发明字段词汇。
- 现有系统有基础 fallback 路径，例如 `scope-reviewer`、`imm-code-review` 或同类通用审查链。
- 当前目标是让单个 reviewer 进入可激活状态，而不是一次做 reviewer framework。
- 本地仓库至少有一个稳定的 contract regression 入口。

## 验证依据

- `skills/prompt-contract-reviewer/SKILL.md` 现在提供了独立 activation host，明确 trigger surface、required inputs、advisory-only output focus，以及 `No tools, no code edits, no plan writes, no test edits, and no workflow-state mutation.` 边界。
- [README.md](README.md) 现在明确 `prompt-contract-reviewer` 通过本地独立 skill surface 参与审查，并在 unavailable 时回退到 `scope-reviewer` + `imm-code-review`。
- [.imm/specs/prompt-contract-reviewer-runtime.spec.md](docs/specs/prompt-contract-reviewer-runtime.spec.md) 现在把最小 activation host、trigger-only posture 和 reviewer available / unavailable 的 manual validation path 写成规格。
- `tests/test_skill_contracts.py` 现在机械检查新 skill 的 trigger surface、只读边界、fallback 路径，以及 runtime spec 的 activation 场景。
- `python3 -m unittest tests.test_skill_contracts` 通过，当前共 `19` 个测试，说明这条 runtime slice 已从“文档中被提到”进入“本地可回归的激活契约”。
- [2026-05-09-003-feat-prompt-contract-reviewer-runtime-slice-plan.md](docs/plans/2026-05-09-003-feat-prompt-contract-reviewer-runtime-slice-plan.md) 的 U1-U3 已全部 pass，分别闭环 dedicated host、trigger-only repo routing 和 verifiable path。

## 约束与建议

- 不要把 activation host 偷放进 `imm-code-review`、`imm-preplan-review` 或其他 authority role 里；这样会模糊边界并抬高后续拆分成本。
- 不要因为要“真实可用”就直接上 registry；单 reviewer runtime slice 的最小真相通常只是独立宿主 + fallback + regression。
- 不要把 focused regression 说成 end-to-end runtime orchestration proof；本地只证明契约，不证明平台。
- 如果下一步开始要求多个 project-specific reviewers 共享派发、组合策略或统一 capability detection，先回到 `imm-preplan-review` / `imm-planner` 重锁 scope。

---
*沉淀日期: 2026-05-09 | 来源: prompt-contract-reviewer runtime slice U1-U3 全步骤验收*
