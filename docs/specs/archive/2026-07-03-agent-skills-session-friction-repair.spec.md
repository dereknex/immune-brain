---
date: 2026-07-03
topic: agent-skills-session-friction-repair
status: draft
origin:
  - user request: 通过 pi session 分析 agent-skills 存在的问题并确保修复
  - session: /Users/derek/.pi/agent/sessions/--Users-derek-workspaces-refine--/2026-07-03T09-45-25-801Z_019f275e-6629-7db3-adfc-639aba56300a.jsonl
  - docs/reference/planning-quality-gate.md
  - CONTEXT.md
---
# Agent Skills Session Friction 修复 Spec

## 1. 背景

一次 refine 项目的 pi session 暴露出 Immune-Brain / agent-skills 的系统性摩擦：agent 能完成业务改动，但在 Plan 校验、MCP fallback、CLI 参数、QA / review gate、host task 工具和 destructive edit 规则上反复绕路。这些不是 refine 业务问题，而是 agent-skills 的契约、runtime 与 host 适配没有统一。

本 Spec 将这些问题收敛为一个 executable repair slice，目标是让下一次相同 workflow 能被 runtime 和 skill 合同直接引导，而不是靠 agent 临场猜测。

## 2. 问题清单

| ID | 问题 | session 证据 | 目标状态 |
|---|---|---|---|
| FR-001 | MCP-first 与实际 Pi MCP 可用性不一致 | `MCP server "immune-brain" not available` 后才 fallback CLI | skill / docs 明确 MCP preflight 与 CLI fallback，不重复尝试失效路径 |
| FR-002 | `Depends on` 只接受数字但 Step ID 是 `U1` | `Depends on contains a non-numeric step reference: U1` | parser 接受 `U1` 并归一到 step number，或错误提示给出明确修复 |
| FR-003 | 中文 `Result` 被顿号等标点误伤 | `Result contains multi-result marker '、'` | validator 保留 outcome 约束，但降低中文自然语言误伤 |
| FR-004 | `record-execution` help / schema / flags 不统一 | `--help` 触发业务校验，stdin JSON 多次失败 | CLI help 优先返回 usage；flags 与 JSON evidence 都可用；schema 输出一致 |
| FR-005 | QA 与 review gate 权威不一致 | checkpoint 显示 `awaiting_qa_decision` 且 `review_status: not_required`，skill 又要求 material change code review | runtime snapshot 明确 next authority、allowed actions 与 review gate 评估阶段 |
| FR-006 | material code review gate 触发边界不清 | 大规模 runtime 删除后 agent 仍不确定是否应 code review | gate 规则由 runtime 单一权威输出，skill 不再添加隐藏规则 |
| FR-007 | host task 工具泄漏 | `Tool TaskUpdate not found` | Pi skill 合同只引用当前 host 的 `todo`，共享文档使用 host abstraction |
| FR-008 | destructive edit 防护不足 | 函数块和 publish 块被重复插入 | executor / imm-work 合同强制 destructive edit protocol 与 post-edit checks |
| FR-009 | workflow 临时文件无收口策略 | `.pi/tasks/...json` 出现在 untracked | loop / work 收口要求列出 untracked 并区分 host 临时文件与 durable state |
| FR-010 | 安装文档容易让用户误以为 skills 安装即 MCP 可用 | README 已说明但 session 仍踩坑 | active skill contract 与 README/user manual 都提供一致 preflight/fallback 文案 |

## 3. 当前可执行范围

本 slice 修复 runtime、skill 合同、docs 和 focused tests。范围包括：

- `plugins/immune-brain/runtime/imm_core.ts`
- `plugins/immune-brain/runtime/immune_brain_runtime.ts`
- `plugins/immune-brain/dist/*.md`
- `plugins/immune-brain/skills/*/SKILL.md`
- `README.md`
- `docs/user_manual.md`
- focused tests under `tests/`

不做以下事项：

- 不引入新的 workflow authority 或新的 default QA pass。
- 不改变 State Ledger 持久化 schema，除非现有 review metadata 已支持所需字段。
- 不要求所有历史 archive 文档重写。
- 不修改 refine 项目 session 中的业务改动。

## 4. 目标设计

### 4.1 Runtime contract

- `parseDependsOn` 接受数字和合法 Step ID，例如 `U1`。内部统一归一为 step number，并保留对未知 ID、未来 step、循环/缺失依赖的校验。
- `validatePlan` 对中文自然标点不再直接判定多 outcome。仍可阻止明显 action list 或多 outcome 结果。
- `record-execution` 支持：
  - `--help` / `-h` 返回 usage，不触发 evidence 校验。
  - flags 输入：`--changed-files "a,b" --verification-result "..."`。
  - JSON 输入：`--evidence-json '{...}'` 或 stdin JSON。
  - MCP/direct tool schema 接受 `changed_files` string 或 array，并写入 State Ledger 为 `string[]`。
- `imm-autowork` snapshot 增加或稳定输出：
  - `recommended_authority`
  - `required_input`
  - `allowed_actions`
  - `review_status`
  - `pending_review_gate`
  - `required_review_gates`
  - `review_gate_reason`
- Review gate 触发由 runtime 唯一判断。skill 只能解释 snapshot，不自行追加隐藏 gate。

### 4.2 Skill contract

- `imm-loop`：强调它协调 authority，不直接 QA pass；当 snapshot 指向 `imm-qa` 时，应交给 QA authority，而不是停在自我辩论。
- `imm-qa`：说明自动化 evidence 足够时可以记录 QA pass；如果 material review gate 未闭合，则不能把 workflow 视为完成。
- `imm-work` / `imm-executor`：加入 destructive edit protocol：先 read 精确区域，再用唯一 oldText 删除或替换，edit 后必须局部验证，禁止锚点前置插入伪装删除。
- Pi host 合同：任务追踪使用 `todo`，不引用 `TaskUpdate` / `TaskCreate` 作为当前 Pi 工具。
- 收口合同：loop/work 报告前列出 tracked 与 untracked，明确 `.pi/tasks` 类文件默认不提交。

### 4.3 Documentation contract

- README 与 user manual 明确：Pi skills 安装不等于 MCP server 已启用；需要 `pi-mcp-adapter` 与 MCP config。
- 文档提供 MCP 不可用的标准 fallback：一次失败后立即切换 CLI，或运行 doctor/preflight。
- record-execution usage 在 README、user manual、skill docs 中一致。

## 5. 验收标准

- 新增/更新 focused tests 覆盖 FR-001 到 FR-010。
- `plugins/immune-brain/bin/imm-plan <plan> --json` 通过。
- `bun test` focused suite 通过。
- 负向文本断言确认 active Pi-facing skill/docs 不再建议当前 host 不存在的 `TaskUpdate`。
- 负向文本断言确认 destructive edit protocol 出现在 executor/work 合同。
- CLI tests 证明 `record-execution --help` 不再触发 evidence 校验。

## 6. 风险与回滚

- 风险：放宽 plan parser 可能让真实多 outcome plan 漏过。缓解：只放宽中文标点误伤，不取消 action/result 校验，并加入 regression tests。
- 风险：record-execution 同时支持多输入模式可能产生不一致。缓解：所有输入归一到同一个 evidence parser。
- 风险：review gate 规则过强会打断轻量 workflow。缓解：runtime snapshot 给出 reason，并允许 reviewer gate pass 记录复用。
- 回滚：回滚本 Spec、对应 Plan、runtime、skill/docs 与 focused tests 即可。不需要迁移 `.imm/memory/`。
