---
title: Project-specific Reviewer Contract Slices
reusability: high
key_files:
  - docs/reference/design-contract-review-checklist.md
  - plugins/immune-brain/dist/imm-ui-review.md
  - tests/test_skill_contracts.py
  - docs/specs/ui-review-design-contract-alignment.spec.md
  - docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md
next_reuse_scenarios:
  - 需要把 reviewer 绑定到 repo-local contract 文件，而不是默认风格模板
  - 需要新增只读 reviewer，但缺少专门 runtime，先用 contract + focused regression 收敛边界
  - 需要明确“缺失项目契约时只提醒、不自动补文件”的 reviewer slice
---

> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Project-specific Reviewer Contract Slices

**领域**: Agent workflow / project-specific reviewers
**描述**: 当某个 reviewer 只对特定项目类型有价值时，先把它收敛成独立的 docs-first contract slice，写清显式 trigger、只读 advisory 边界、fallback 和验证路径。不要因为它“看起来重要”就直接把它做成默认 gate、条件风险层通用 reviewer，或通用 registry 的一部分。

**reusability**: high
**next_reuse_scenarios**: [`AI/agent` 项目要新增 `release-readiness-checker`、`ai-eval-planner`、`docs-verifier` 这类 project-specific reviewer, 某个 reviewer 已在 roster/README 里出现但还没有 standalone contract, 团队想先让 reviewer 从“名字”变成“可验证能力”而不扩成多 reviewer rollout`]

## 场景

- 某个 reviewer 只对特定项目类型或交付方式成立，而不是跨项目默认适用。
- 系统已经有 core workflow 和 authority boundary，不需要再发明新的执行链。
- reviewer 已经在 roster、README 或 spec 里被点名，但还停留在名称层，没有独立 contract。
- 团队想先闭环一个可验证的 reviewer slice，而不是同时启动 registry、自动 dispatcher 或多 reviewer rollout。

## 方案模板

1. **先证明它确实是 project-specific**: 先写清它依赖什么项目特征或交付面，不要把它误塞回 conditional-risk 层。
2. **用 standalone contract 替代 roster prose**: 至少单独定义 `id`、`trigger`、`invocation_stage`、`authority_class`、`write_boundary`、`input_schema`、`output_schema` 和 `failure_mode`。
3. **默认保持 advisory + read-only**: 首版只做只读 reviewer，不授予 plan writes、code edits、test edits 或 workflow-state mutation。
4. **把 trigger 写成显式变化面**: 只在相关 diff、任务内容或交付面明确命中时触发，不因为“这个项目通常有这类风险”而默认常驻。
5. **先写 fallback，再谈 dedicated reviewer**: 如果当前环境没有 dedicated reviewer 路径，就回退到已有基础审查链，并明确这只是基础替代，不是等价完整替代。
6. **验证 reviewer 存在，而不是假装 runtime 已完成**: 用 focused regression 守住 contract 文本；如果 repo 里不能自动化证明真实 delegation，就补人工 runtime 验证路径。

## 可复用前提

- 系统已有基础的 scope / code review 路径，可作为 fallback。
- 当前目标是收敛一个 reviewer contract，而不是一口气上线 reviewer framework。
- repo 已有能承载 focused textual regression 的测试入口，或者至少能接受 manual runtime validation。
- reviewer 的价值来自项目特征，而不是所有项目共享的风险面。

## 验证依据

- [.imm/specs/prompt-contract-reviewer.spec.md](docs/specs/prompt-contract-reviewer.spec.md) 现在把 `prompt-contract-reviewer` 写成 standalone manifest-style contract，并明确 trigger surface、`authority_class: advisory`、只读 write boundary 和 fallback。
- [README.md](README.md) 现在明确 `prompt-contract-reviewer` 属于 project-specific 层，只在显式 trigger 时加入；没有 dedicated reviewer 路径时回退到 `scope-reviewer` + `imm-code-review` 的基础一致性审查。
- `tests/test_skill_contracts.py` 现在机械检查 prompt / tool contract / instruction / structured output / safety boundary、advisory authority、read-only boundary、fallback 文本和 `Codex runtime` 验证入口。
- [2026-05-09-002-feat-prompt-contract-reviewer-slice-plan.md](docs/plans/2026-05-09-002-feat-prompt-contract-reviewer-slice-plan.md) 的 U1-U3 已全部 pass，分别闭环 standalone contract、explicit fallback 与 verifiable path。
- `python3 -m unittest tests.test_skill_contracts` 通过，说明这条 reviewer slice 至少已经从 roster prose 进入本地可回归 contract。

## 补充实例: Repo-local Design Contract Reviewer

当 reviewer 依赖的是项目自己提供的设计契约，而不是平台预置设计语言时，contract slice 还要再补三条：

1. **项目文件优先于 reviewer 偏好**: 如果仓库里存在 `DESIGN.md`，它就是 UI review 的上位约束；reviewer 只能据此审查，不能用默认风格覆盖它。
2. **缺失契约只提醒，不代写**: `DESIGN.md` 不存在时，reviewer 只能报告缺失并建议补齐，不能自动初始化、写入 fallback 文件，或偷偷把 generic style guide 当替代契约。
3. **通用 anti-slop 只能是风格中性纪律**: checklist 可以约束层级、可读性、信息密度和 emphasis，但不能把 “clean SaaS” 之类默认视觉语言伪装成质量规则。

### 补充验证依据

- [docs/reference/design-contract-review-checklist.md](docs/reference/design-contract-review-checklist.md) 把 `DESIGN.md` precedence、missing-contract reminder-only、style-neutral anti-slop checklist 固化为 review source。
- [plugins/immune-brain/dist/imm-ui-review.md](plugins/immune-brain/dist/imm-ui-review.md) 明确 `imm-ui-review` 只读、优先读取 `DESIGN.md`，缺失时只提醒，不做文件生成。
- `tests/test_skill_contracts.py` 增加 focused regression，防止回漂到“自动生成 `DESIGN.md`”或“默认 SaaS 风格 fallback”。
- [docs/specs/ui-review-design-contract-alignment.spec.md](docs/specs/ui-review-design-contract-alignment.spec.md) 与 [docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md](docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md) 已收敛到 read-only reviewer 边界。
- `python3 -m unittest tests.test_skill_contracts`、`python3 .imm/imm-plan.py docs/plans/2026-05-25-001-feat-ui-review-design-contract-alignment-plan.md --json` 与 `rg -n "design-contract-review-checklist.md|DESIGN.md|read-only|missing design contract" plugins/immune-brain/dist/imm-ui-review.md tests/test_skill_contracts.py` 均通过。

## 约束与建议

- 不要把 project-specific reviewer 因为“也是 reviewer”就塞回 conditional-risk 层；关键区别是触发来源。
- 不要先做 registry 再补 contract；顺序反了会把 reviewer 名单固化成默认流程。
- 不要把 fallback 写成 dedicated reviewer 的完整替代；它只负责基础一致性审查。
- 不要把文本 regression 误写成 runtime delegation proof；自动化证明不到的部分要老实放进人工验证路径。
- 不要把 repo-local contract 缺失时的临时提醒，升级成 reviewer 代写项目设计文件；那已经越过 read-only reviewer 边界。
- 不要把 anti-slop checklist 写成默认品牌或默认产品审美；quality guard 和 style authority 不是一回事。
- 如果下一步开始依赖多个 project-specific reviewer 的统一派发或组合策略，先回到 `imm-preplan-review` / `imm-planner` 重新锁 scope。

---
*沉淀日期: 2026-05-25 | 来源: prompt-contract-reviewer slice + imm-ui-review design-contract alignment 闭环*
