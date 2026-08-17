# Spec: imm-party hygiene review follow-ups

**任务 ID**: IMM-PARTY-004
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 `imm-code-review` 在 `imm-party` contract/context hygiene 切片后发现的 3 个剩余问题：

- `party_packet` 仍混入 guard 字段，单层 advisory handoff 没有真正收口；
- delegation context contract 仍残留旧的 per-role summary 表述；
- shared guard baseline 仍停留在 spec 宣称层，没有收敛成 runtime reference + test contract。

本轮只做 review follow-up 修复，不重开更大的 prompt-governance、repo-wide guard dedup
或通用 skill metadata 方案。

## 2. 问题背景

`IMM-PARTY-003` 已经把 `imm-party` runtime surface 压缩了一轮，但 code review 又暴露出
3 个具体缺口：

1. runtime skill 里的 `party_packet` schema 仍携带 `allowed / blocked / workflow_guard`；
2. sub-agent 条件段落仍写着 “relevant context summary under 400 words”，与新的
   `shared_context_summary + focus_delta` 契约并存；
3. spec 声称要引用 shared guard baseline，但 runtime skill 仍完整展开 party-specific
   guard 文案，测试也没有真正守住 “baseline reference + delta”。

这些问题不会扩大 authority boundary，但会直接削弱本轮“减重、减重复、降 token”的目标。

## 3. 功能需求

### R1. True single-layer handoff

- `party_packet` runtime schema 只保留 advisory handoff payload：
  - `problem`
  - `roles_consulted`
  - `agreements`
  - `disagreements`
  - `risks`
  - `scope_posture`
  - `recommended_next_skill`
- `allowed / blocked / workflow_guard` 保留为 skill 的 Codex-facing outer contract，
  不能继续作为 `party_packet` payload 字段。

### R2. Fully aligned delegation context wording

- `imm-party` runtime skill 不得再出现会让读者理解为“每个角色各带一份完整 context
  summary”的表述。
- delegation contract 必须统一成：
  - one shared `shared_context_summary` per round
  - one per-role `focus_delta`
- paired spec / solution wording 必须与 runtime skill 对齐，不允许新旧说法并存。

### R3. Baseline reference plus party-specific delta

- `imm-party` 的 Codex-facing contract 必须显式引用 repo-wide shared guard baseline，
  而不是继续完整重述同一层解释。
- runtime skill 只保留 `imm-party` 特有 delta：
  - advisory-only boundary
  - handoff target stays `imm-preplan-review` / `imm-planner`
  - no direct execution / QA authority
- focused contract tests 必须验证：
  - baseline reference exists
  - party-specific delta remains explicit
  - full duplicate guard narration does not creep back into the slice

## 4. 验收标准

- [ ] `party_packet` runtime schema 不再包含 `allowed / blocked / workflow_guard`。
- [ ] `imm-party` runtime skill 不再保留 per-role `context summary` 的旧表达。
- [ ] delegation contract 在 runtime skill 与 paired spec 中统一为
      `shared_context_summary + focus_delta`。
- [ ] `imm-party` 的 Codex-facing guard 改成 shared baseline reference + party-specific
      delta，而不是完整重复解释。
- [ ] focused contract tests 覆盖 single-layer payload、delegation wording cleanup、
      baseline-reference contract。
- [ ] 本轮不扩展到 repo-wide guard rewrite、frontmatter/metadata engine、或全量 skill
      测试框架迁移。

## 5. 非目标

- 不实现 repo-wide 通用 guard registry。
- 不重写所有 `imm-*` skills 的 Codex-facing contract 写法。
- 不把 `Contract anchors` 整体迁移到新的文件格式或 metadata engine。
- 不扩展 `imm-party` 的 role roster、delegation runtime、或 upstream comparison policy。

## 6. 依赖项

- 依赖 [imm-party-contract-and-context-hygiene.spec.md](docs/specs/imm-party-contract-and-context-hygiene.spec.md)
  的首轮 runtime hygiene 目标与非目标边界。
- 依赖 [imm-party-subagent-delegation.spec.md](docs/specs/imm-party-subagent-delegation.spec.md)
  的 delegation / fallback 基础契约。
- 依赖 [advisory-roundtable-layer.md](docs/solutions/advisory-roundtable-layer.md)
  的 advisory handoff 边界。
