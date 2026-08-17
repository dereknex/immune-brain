> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Skill Contract Truth Guards For Baseline Refactors

**领域**: Agent workflow / skill contracts / regression guards  
**描述**: 当一轮 skill baseline 或 prompt slimming 同时改动 narrative contract、artifact schema、以及 shared reference 路径时，不要只依赖人工 review 去兜底。更稳的收口方式是把“共享 truth”拆成几条 focused contract guards：schema enum、safety ordering、repo-local reference path，各自由同一个轻量测试入口直接断言。

- `reusability: high`
- `next_reuse_scenarios: ["压缩其他 imm-* skill 文本时防止 schema 漂移", "把新的 shared baseline 文件推广到更多角色时防止引用路径回归", "给 reviewer / advisory family 新增 route 枚举时同步 narrative 与 artifact", "在 prompt slimming 后守住 security-first 之类的决策优先级"]`

## 场景

- 一轮减重或 baseline 化同时改动了多个 skill 的共享说明，但真正消费这些 contract 的下游仍依赖少数关键字段。
- prose 已经引入了新 truth，例如 `append_to_plan`，但 artifact schema 仍停留在旧 enum。
- shared baseline 文件被抽到统一位置后，多个 skill 的引用路径容易批量写错。
- focused contract tests 还在锁旧长句，无法直接指出“是 schema 漂了、优先级丢了，还是 link path 错了”。

## 方案模板

1. **先列出决策级 truth，而不是笼统说“对齐 contract”**: 把回归拆成最小的 shared truths，例如 route enum、冲突优先级、planner fallback、baseline reference path。
2. **同一个 truth 要覆盖 narrative 和 artifact**: 如果 prose 引入了 `append_to_plan`，artifact schema 与 follow-up handoff 也必须显式允许它。
3. **shared baseline link 单独守路径**: 对引用式 baseline，直接测试 `../BASELINE.md` 这类 repo-local path，而不是只检查“提到了 BASELINE”。
4. **安全优先级不要在 slimming 时被意外删掉**: 像 `security > performance > compatibility > readability` 这种仲裁顺序属于决策 contract，应该被 focused tests 直接锁住。
5. **把回归守卫放回现有 focused 入口**: 若仓库已有 `tests/test_skill_contracts.py`，优先在原入口补结构化断言，而不是创建新的平行 harness。

## 可复用前提

- 仓库已经有一个稳定的 contract-test 入口，可以承接 focused 断言。
- 共享 truth 主要存在于 skill 文本而非复杂 runtime 行为中。
- 当前 follow-up 的目标是修 prompt / contract drift，而不是改 authority、scheduler、或 runtime state machine。
- review 已经把问题定位到少数高信号 truths，适合转成直接测试。

## 验证依据

- [2026-05-10-037-fix-skill-baseline-followup-contract-regressions-plan.md](docs/plans/2026-05-10-037-fix-skill-baseline-followup-contract-regressions-plan.md) 把 follow-up 收敛成单步 contract-alignment slice，明确只修 reviewer schema、`imm-work` arbitration truth、baseline link path 与 focused guards。
- [imm-code-review](skills/imm-code-review/SKILL.md) 与 [imm-ui-review](skills/imm-ui-review/SKILL.md) 现在都把 `recommended_route` 明确写成 `direct_fix | append_to_plan | new_slice | defer`，不再出现 prose 与 artifact schema 脱节。
- [imm-work](skills/imm-work/SKILL.md) 现在重新锁定 `security > performance > compatibility > readability`，并要求冲突仍无法收敛时回到 `imm-planner`。
- `tests/test_skill_contracts.py` 新增 focused assertions，分别守 reviewer route schema、`imm-work` 的 security-first fallback，以及 baselined skills 的 repo-local `BASELINE.md` 引用路径。
- `python3 -m unittest tests.test_skill_contracts` 通过，且 `rg -n "\\[BASELINE\\.md\\]\\(\\.\\./skills/BASELINE\\.md\\)" skills/*/SKILL.md` 无匹配，说明当前 shared truth 已机械闭环。

## 约束与建议

- 不要把这类 follow-up 扩成“全面重审所有 skill contract”；只锁 review 已经证明会改变决策的 truths。
- 不要只修 prose 而不修 schema；reviewer / planner 的 handoff 常常消费的是 artifact 表达而不是说明文字。
- 不要把 repo-local path guard 混进泛语义断言；路径是最适合直接精确检查的一类回归面。
- 如果后续 drift 已经跨到 runtime 行为，再单开新的 slice；不要把 runtime harness 强行塞进一次 prompt-contract hotfix。

---
*沉淀日期: 2026-05-10 | 来源: 037 skill baseline follow-up contract regression repair and focused closure*
