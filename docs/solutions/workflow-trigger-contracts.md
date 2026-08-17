# Pattern: Observable Workflow Trigger Contracts

**领域**: Agent workflow / skill contracts
**描述**: 当一个 skill 声称能触发 Codex UI 同步、developer insights 写入或
sub-agent delegation 时，契约必须同时说明触发条件、fallback 和可验证证据，
不能只停留在角色说明或设计文档里。

**reusability**: high
**next_reuse_scenarios**: [`workflow 默认入口已迁移到 CLI / skill 命令, 仍保留项目内脚本兼容路径, 需要避免文档或测试把 fallback 重新写成默认入口`, `任何 trigger contract 既有 happy path 又有 legacy fallback, 需要同时守住默认入口与 fallback-only 语义`]

## 场景

- workflow 能力跨越本地 `.imm` 状态、Codex 原生 UI、全局用户级 inbox 或
  sub-agent delegation。
- 设计文档已经描述能力，但用户实际运行时看不到状态刷新、记录写入或 agent 激活。
- 能力需要保持安全边界，例如只读 Codex task sync、opt-in dev insights、
  explicit-request-only sub-agents。
- 后续维护者需要用 focused tests 或命令证据确认能力仍然接在线上路径上。

## 方案模板

1. **把触发点写进 skill 契约**: 明确什么时候必须触发、什么时候 fallback、
   fallback 要如何告知用户。
2. **绑定真实入口**: 如果能力依赖 finish path、status snapshot 或 delegation
   mechanism，就让角色规则指向该入口，而不是指向旁路命令。
3. **保持单向状态边界**: UI 同步只能从本地 source of truth 派生；不要让展示层
   反写 workflow state。
4. **用 focused regression 固化触发**: 给每个触发点补最小测试或命令检查，避免
   未来只保留文档描述。
5. **显式记录 fallback**: 当环境不支持、成本不合适或用户未显式请求时，输出应说明
   为什么没有触发，而不是静默模拟成功。
6. **默认入口与兼容入口分层**: 如果系统已经迁移到新的 CLI / skill 默认入口，
   contract 必须把旧脚本路径降级为 compatibility fallback，并让 focused
   regression 同时守住“默认走新入口”与“旧入口仅 fallback”这两个语义。

## 可复用前提

- 能力的价值来自“被触发后可观察”，例如 Codex task display 更新、inbox 追加、
  sub-agent 被派生或明确 fallback。
- 存在稳定 source of truth，例如 `.imm/memory/current_iteration.json`、finish
  closure path 或 skill contract。
- 首版目标是修复触发缺口，而不是引入完整调度平台、后台任务或长期 agent memory。

## 验证依据

- `skills/imm-autowork/SKILL.md` 要求 autowork 状态变化后读取 `imm-work status`，
  并把 `codex_plan.tasks` 同步到 Codex 原生 `update_plan` 展示。
- `skills/imm-compounder/SKILL.md` 改为默认通过 `imm-finish` 闭环，并仅在
  `imm-finish` 不可用时回退到 `python3 .imm/imm-finish.py`，让 context
  dehydration 和 opt-in `dev_insights` inbox 记录继续共用同一条 finish path。
- `skills/imm-party/SKILL.md` 要求显式 independent-agent 请求在支持环境中使用
  sub-agent delegation，并在 fallback 时说明原因。
- `tests/test_skill_contracts.py` 覆盖 autowork Codex sync、compounder finish path、
  compounder fallback-only 语义，以及 party explicit sub-agent activation 三个契约。
- Focused regression 覆盖 dev insights 开启、配置开启和关闭三种写入行为，并且
  `docs/plans/2026-05-07-013-feat-workflow-trigger-repair-plan.md` 通过 plan validator。

## 约束与建议

- 不要把 trigger contract 扩展成自动调度平台；先保证显式触发可观察。
- 对跨系统能力优先测试 contract 和入口，而不是测试 UI 或平台内部实现。
- 当默认入口已经迁移时，不要让 legacy 脚本路径继续出现在 happy path 文案里；
  这会把“兼容保底”重新污染成“推荐入口”。
- 如果某个触发只能人工验证，也要把人工验证步骤写入 plan 或 QA evidence。
- 当 focused tests 通过但宽测试存在无关旧失败时，必须在 QA notes 中记录边界，
  避免把旧债误判为当前修复失败。

---
*沉淀日期: 2026-05-07 | 来源: workflow trigger repair 全步骤验收*
