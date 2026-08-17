> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Conditional-risk Reviewer Activation Hosts

**领域**: Agent workflow / conditional-risk reviewer runtime
**描述**: 当 conditional-risk reviewer 已经有 docs-first contract，但仍停留在 roster/spec 命名层时，首版应先补独立的本地 activation host，让它成为可显式触发的 read-only reviewer；不要因为它跨项目高复用，就直接膨胀成 registry、shared dispatch 或默认 gate。

**reusability**: high
**next_reuse_scenarios**: [`新的 conditional-risk reviewer` 需要从 docs-first contract 进入可激活功能层, 某条 risk reviewer 已有 trigger/fallback/manual validation 但还没有 skill host, 团队要补齐 risk reviewer runtime truth 而不想上 shared reviewer platform`]

## 场景

- 某条 conditional-risk reviewer 已有 standalone contract、trigger surface、fallback 和 manual validation。
- README 或治理文档已经把它列进 conditional-risk roster，但仓库里还没有独立的 `skills/<reviewer>/SKILL.md`。
- 团队希望这条 reviewer 真正可激活，而不是继续停留在“文档里提到过”的状态。
- 当前仍要保持 `advisory`、read-only、trigger-only、non-default，不把 risk reviewer 变成默认 gate。

## 方案模板

1. **沿用单 reviewer host 模式，不引入 shared runtime**: 先为单条 reviewer 新增独立 skill host 和对应 runtime spec。
2. **host 只描述该风险面的触发与输出**: skill surface 只写这一条 reviewer 的 trigger surface、required inputs、output focus、fallback 和 manual validation，不顺手吸收其他 risk reviewer。
3. **把 non-default posture 写进 skill、spec 和 README**: 只在显式命中风险变化面时激活；unavailable 时明确 fallback，而不是静默伪装成已有 dedicated reviewer。
4. **用 focused regression 固定 runtime truth**: 机械检查 skill surface、只读边界、fallback、manual validation，以及 repo 是否只对已落地 host 做 activation claim。
5. **把 broader roster 留在 scope 外**: 当只补某两条 conditional-risk reviewer 时，要同时证明其余 roster 项仍未承诺 runtime host，避免 README truth 漂移成“全部都能激活”。

## 可复用前提

- conditional-risk reviewer 已有 docs-first contract，不需要先发明 manifest vocabulary。
- 现有系统已经有基础 fallback 审查路径，例如 `imm-code-review`、planner notes 或 executor notes。
- 当前目标是让少量 risk reviewer 进入可激活状态，而不是做统一的 reviewer framework。
- repo 有稳定的 contract regression 入口，可以承载 activation truth 的 focused tests。

## 验证依据

- `skills/security-reviewer/SKILL.md` 与 [security-reviewer-runtime.spec.md](docs/specs/security-reviewer-runtime.spec.md) 现在把 `security-reviewer` 推进成独立 activation host，明确 trigger-only、advisory-only 和 unavailable fallback。
- `skills/api-contract-reviewer/SKILL.md` 与 [api-contract-reviewer-runtime.spec.md](docs/specs/api-contract-reviewer-runtime.spec.md) 现在把 `api-contract-reviewer` 推进成独立 activation host，并保持相同的只读 / 非默认边界。
- `skills/data-integrity-reviewer/SKILL.md` 与 [data-integrity-reviewer-runtime.spec.md](docs/specs/data-integrity-reviewer-runtime.spec.md) 现在把 `data-integrity-reviewer` 推进成独立 activation host，并保持 trigger-only、advisory-only 和 unavailable fallback。
- `skills/reliability-reviewer/SKILL.md` 与 [reliability-reviewer-runtime.spec.md](docs/specs/reliability-reviewer-runtime.spec.md) 现在把 `reliability-reviewer` 推进成独立 activation host，并保持 trigger-only、advisory-only 和 unavailable fallback。
- [README.md](README.md) 现在对 `security-reviewer`、`data-integrity-reviewer`、`api-contract-reviewer` 与 `reliability-reviewer` 都写明“显式触发 + 独立 skill surface + unavailable fallback”，而不是把它们升级成默认 gate。
- `tests/test_skill_contracts.py` 现在机械检查四条 conditional-risk reviewer 的 runtime host，同时把 `release-readiness-checker` 与 `debug-investigator` 的 project-specific activation truth 交给各自的 runtime-host assertions，而不是继续把它们写成未激活状态。
- `python3 -m unittest tests.test_skill_contracts` 通过，当前共 `38` 个测试，说明这次收口不只是多了一个 skill 文件，而是把 conditional-risk runtime truth 固定成了可回归契约。
- [2026-05-09-024-feat-data-integrity-reviewer-slice-plan.md](docs/plans/2026-05-09-024-feat-data-integrity-reviewer-slice-plan.md) 的 U1-U3 已全部 pass，分别闭环 `data-integrity-reviewer` runtime spec、dedicated host 与 repo-level truth verification。
- [2026-05-09-023-feat-activate-remaining-first-batch-runtime-slices-plan.md](docs/plans/2026-05-09-023-feat-activate-remaining-first-batch-runtime-slices-plan.md) 的 U1-U3 已全部 pass，分别闭环 `security-reviewer` host、`api-contract-reviewer` host 与 batch-level truth verification。

## 约束与建议

- 不要因为 conditional-risk reviewer 跨项目复用高，就跳过单 reviewer host，直接做 shared registry；这样最容易把一步 runtime slice 变成平台工程。
- 不要把 unavailable fallback 写成 dedicated reviewer 的完整替代；它只是基础审查链的收敛路径。
- 不要只测“skill 文件存在”；还要测 README claim 和 broader roster 的 out-of-scope truth，否则 runtime 能力清单会再次漂移。
- 如果后续要补新的 conditional-risk reviewer，优先复用这套单 reviewer host + runtime truth regression 模式，而不是重新设计第二套 runtime contract。

---
*沉淀日期: 2026-05-09 | 来源: remaining first-batch runtime activation U1-U3 全步骤验收 + data-integrity reviewer runtime slice U1-U3 全步骤验收 + remaining subagents rollout U1-U4 + solution truth drift follow-up U1*
