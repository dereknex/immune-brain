> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Default-Debug Workflow Output Split

**领域**: Agent workflow / user-facing output contract
**描述**: 当 workflow 同时需要满足“用户快速拿结果”和“系统保留可调试状态”两类需求时，默认输出与调试输出必须显式分流。成功路径保持极简，只有在失败、阻塞或用户明确要求时才展开内部状态与详细过程。

**reusability**: high
**next_reuse_scenarios**: [`imm-work` / `imm-qa` 这类多阶段 workflow, 内部状态丰富但默认不应暴露给用户, 需要同时兼顾正常协作和排障调试]

## 场景

- workflow 内部存在 `next_action`、history、driver state、role 名、raw JSON 等机器可消费状态。
- 用户正常协作时只关心“现在结果是什么、凭什么成立、下一步怎么继续”。
- 如果成功路径默认暴露所有中间动作，用户会感受到流程反复、解释过多、像在陪系统调试。
- 但完全删除内部状态又会损失排障能力，因此需要保留一条显式 debug 展开路径。

## 方案模板

1. **定义两档输出**: `default` 给正常协作；`debug` 只在显式请求复核、调试、查状态时展开。
2. **成功路径极简**: 默认只输出结论、最短必要证据、下一步，不回显 role 名、packet 字段、history、raw JSON。
3. **失败路径展开**: `rework` / `replan` / 阻塞态才展开 gap、阻断影响、恢复动作与更详细证据。
4. **角色文案与入口文案分离**: 可以保留内部 authority role，但默认用户文案优先说“继续通过 `imm-work`”或直接说下一结果。
5. **把约束写进 skill contract 和 repo-facing docs**: 不能只靠回答风格记忆，必须同时更新 skill 文档与 README。
6. **用 focused regression 锁住密度边界**: 至少有一条契约测试检查 `default/debug` 分流存在，避免后续又逐步回到 verbose 成功路径。

## 可复用前提

- workflow 已经有稳定的内部状态结构，且这些字段不适合每次都展示给用户。
- 成功路径可以用少量证据闭环，不需要每次重放完整审计轨迹。
- 团队接受“默认少说、按需展开”的协作方式，而不是把每次运行都当成调试会话。

## 验证依据

- [imm-work/SKILL.md](skills/imm-work/SKILL.md) 明确成功 continue 路径不默认暴露 `next_skill`、role 名、history 或 raw state，并优先用 `imm-work` 作为继续入口文案。
- [imm-qa/SKILL.md](skills/imm-qa/SKILL.md) 现在显式定义 `default` / `debug` 分流：`pass` 默认只保留一条结论和一条证据，失败或显式 debug 才展开 packet/state 细节。
- [README.md](README.md) 同步了 QA 的 terse-pass 规则，确保 repo-facing 说明与 skill 契约一致。
- `test_skill_contracts.py` 锁住 `imm-qa` 的 `default/debug` 分流契约。
- 本轮 workflow plan [2026-05-08-003-feat-session-flow-output-simplification-plan.md](docs/plans/2026-05-08-003-feat-session-flow-output-simplification-plan.md) 已完成 3 个 step，并通过 `imm-review pass` 闭合。

## 约束与建议

- 不要把“成功路径少说”误解成“证据变弱”；真正弱的是没有 debug 路径或没有 focused regression。
- 如果某条成功输出仍需要解释多个内部状态，说明 step 可能过大，或者 contract 还没收敛好。
- 文档、skill 契约、回归测试必须一起改；只改其中一层，很快会再次漂回 verbose。
- 当 workflow 既要给人读又要给机器读时，把机器状态保留为内部 artifact，不要默认复制到用户回复里。

---
*沉淀日期: 2026-05-08 | 来源: session flow and output simplification 计划闭环*
