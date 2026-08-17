---
title: Opt-in Agent-Local Developer Insights Inbox
reusability: high
next_reuse_scenarios:
  - adding an optional workflow-improvement record to a closure command
  - separating project workflow authority from user-level developer feedback
  - ordering an authoritative commit before best-effort external delivery
key_files:
  - plugins/immune-brain/runtime/immune_brain_runtime.ts
  - plugins/immune-brain/runtime/imm_core.ts
  - tests/finish-dehydrate-runtime.test.ts
  - docs/reference/immune-brain-config.md
---

# Pattern: Opt-in Agent-Local Developer Insights Inbox

**领域**: Agent workflow / developer tooling
**描述**: 当要为 Immune-Brain 系统开发者跨项目收集 workflow 改进素材时，应使用所选 coding agent 的本机用户级、默认关闭 inbox，而不是写入项目 State Ledger 或退役的共享全局根目录。

## 场景

- 洞察的使用者是系统开发者，而不是某个单一项目的最终用户。
- 需要跨多个仓库持续收集 workflow friction、改进建议和上下文线索。
- 记录应保留为后续人工复盘素材，但不能被误当成正式 `docs/solutions/` 沉淀。
- 需要避免把敏感原文、完整对话或代码 diff 默认落进跨项目日志。

## 方案模板

1. **使用 agent-local 路径**: 默认 inbox 位于所选 agent root 的 `insights/workflow-improvement-inbox.md`；例如 Pi 使用 `~/.pi/agent/immune-brain/`。不要读取退役的 `~/.immune-brain/`。
2. **显式选择 host，默认关闭**: record-aware closure 使用 `imm-finish "<summary>" "<next steps>" --coding-agent <id>`，也可用 `IMMUNE_BRAIN_CODING_AGENT`。`IMM_DEV_INSIGHTS=1|0` 覆盖所选 agent config 的 `[dev_insights] enabled`；其他 host marker 不能用于猜测 agent。
3. **保留 reset-only 兼容和 Plan 边界**: 无参数 `imm-finish` 只完成 authoritative reset，不读取 config，也不创建 inbox 路径。跨 Plan sync 必须清除上一 Plan 的 `intentional_reset` marker；same-Plan revalidation 保留 marker，继续拒绝重复 finish。
4. **保持项目记忆边界清晰**: `.imm/memory/` 只存项目 workflow authority；summary、next steps 和 inbox delivery 状态都不进入 State Ledger。
5. **先提交 authority，再 best-effort delivery**: 所有 CLI、closure、host、config 和 path validation 必须在 mutation 前完成；lock-time CAS reset 成功后才允许一次 bounded append。Append 失败只返回不泄露内容的 warning，不回滚 closure。
6. **只记录结构化洞察**: 记录 date、project、workflow、context、friction、evidence、suggested improvement、severity 和 status；不记录 raw prompt、transcript、diff、provider metadata、token usage、环境 dump 或 ledger serialization。
7. **明确首版非目标**: 接受 reset 与 append 之间的 crash gap，不为 optional insight 引入 outbox、retry ledger、telemetry 或后台分析器。

## 可复用前提

- 采集目标是系统级 workflow 改进，而不是单个项目的业务数据。
- 使用场景跨项目、跨仓库，需要单一聚合入口。
- 记录内容允许是轻量、结构化、面向后续人工分析的素材。
- 团队能接受显式 opt-in，而不是默认开启的背景采集。

## 验证依据

- `docs/specs/2026-07-28-imm-finish-dev-insights-contract.spec.md` 固定双模式 CLI、agent-local ownership、隐私边界和 CAS-before-append 顺序。
- `plugins/immune-brain/runtime/immune_brain_runtime.ts` 实现严格参数/终态验证、显式 coding-agent 选择、authoritative reset 和 warning-only append failure。
- `plugins/immune-brain/runtime/imm_core.ts` 复用 agent-local config parser，并为 `[dev_insights]` 提供 typed config surface。
- `tests/finish-dehydrate-runtime.test.ts` 覆盖 no-arg 零 config/inbox、host/env precedence、retired-root 忽略、invalid/malformed fail-closed、duplicate/concurrent finish、cross-Plan reset marker 清理、CAS、append failure 和 State Ledger privacy。
- `tests/plugin-package-runtime.test.ts` 通过 plugin-local `bin/imm-finish` 验证真实 wrapper argument forwarding。
- 2026-07-28 closure verification 通过 82 个 focused/blast-radius tests、811 assertions、primary LSP、dist sync、两份 Plan validator、三轮独立 QA 和 fresh exact-signature `imm-code-review`。

## 约束与建议

- 不要把 inbox 当成正式知识库；只有经过验证的经验才进入 `docs/solutions/`。
- Custom inbox path 只接受 absolute 或 `~`-prefixed 值；不能从 summary/next-steps 派生路径。
- 新建的本地目录和文件使用 restrictive permissions；现有目标的权限和跨进程 append 原子性不由本模式扩大承诺。
- 若未来需要 guaranteed delivery，应单独设计 outbox/receipt/retry authority，不能让 optional inbox 反向控制 workflow closure。

## reusability_critique_notes

- **Falsifiability**: 如果 insight 成为项目交付 authority，或必须保证 exactly-once delivery，则“CAS 后 best-effort append”不再适用，需要新的持久化和重试模型。
- **Evidence trail audit**: 证据覆盖双模式兼容、配置 precedence、路径和隐私 validation、stale CAS、append failure、真实 wrapper、QA 与 code review；没有证明网络 inbox、分布式 writer 或 crash 后自动恢复。
- **Architecture entropy resistance**: 更新既有 developer-insights Learning，替换退役 Python/global-root 事实；不新增 ADR、State Ledger schema、outbox 或第二个 solution 文件。

---
*更新日期: 2026-07-28 | 来源: imm-finish dev-insights contract Plan 001 + review follow-up round 9*
