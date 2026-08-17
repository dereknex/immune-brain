> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Runtime Payload vs Outer Contract Split

**领域**: Agent workflow / skill contracts / prompt hygiene
**描述**: 当一个 workflow skill 既要输出运行时 handoff payload，又要满足
Codex-facing 的 guard contract 时，不要把两层字段混在同一个 payload 里，也不要在每个
skill 里重复整套共享 guard 叙述。更稳的收口方式是：runtime payload 只保留下游真正消费
的业务字段，outer contract 复用 repo-wide baseline，再只内联当前 role 的特有 delta。

- `reusability: high`
- `next_reuse_scenarios: ["压缩其他 imm-* skill 的 runtime prompt", "把 shared guard baseline 推广到更多 role", "为 reviewer/advisory skill 收口 handoff payload", "把 focused contract tests 从长句锁定改成结构化 contract 守卫"]`

## 场景

- 一个 skill 同时承载 handoff payload、输出 guard、边界说明和测试锚点，文本开始变重。
- 已经存在 repo-wide 的输出/guard 基线，但 skill 仍在内联重复解释。
- 目标是降低 token 和上下文复制，而不是重做整个 workflow authority。
- contract tests 已经足够稳定，可以守住“字段分层”而不是继续锁整段长句。

## 方案模板

1. **先分 handoff payload 和 outer contract**: 运行时 payload 只保留下游真正消费的字段；`Allowed / Blocked / Workflow guard` 这类 guard 留在 outer contract，不要塞回 payload。
2. **共享上下文与角色增量分层**: 如果 skill 会给多个 advisory/reviewer voice 提供上下文，优先一份 `shared_context_summary` 加每角色 `focus_delta`，不要保留旧的 per-role full summary 表述。
3. **共享 guard 只引用基线**: 在 skill 里显式引用 repo-wide baseline，然后只补当前 role 的特有 delta，例如 advisory-only boundary、handoff target、no direct execution authority。
4. **paired spec / solution 必须同步**: runtime skill、paired spec 和 solution doc 不能保留新旧两套说法，否则实际使用时会回到旧 contract。
5. **focused tests 守字段分层，不守整段话术**: 用结构化断言确认 payload 字段、baseline reference 和 role-specific delta 存在；避免再用长句逐字锁文案。

## 可复用前提

- 系统已有 repo-wide 输出基线或共享 guard 约定。
- 下游消费者能明确区分“真正 payload”与“Codex-facing outer contract”。
- 当前目标是 prompt hygiene / contract hygiene，而不是 authority redesign。
- 本地已有 focused tests 能机械检查文本 contract。

## 验证依据

- [docs/plans/2026-05-09-022-fix-imm-party-hygiene-review-followups-plan.md](docs/plans/2026-05-09-022-fix-imm-party-hygiene-review-followups-plan.md)
  把 follow-up 收敛成 3 个独立 outcome：single-layer payload、shared-context wording cleanup、baseline reference plus role-specific delta。
- [skills/imm-party/SKILL.md](skills/imm-party/SKILL.md)
  现在把 `party_packet` 收窄为 advisory payload，只在 Codex-facing 段引用
  [README.md](README.md) 的 repo-wide baseline，并只内联 `imm-party` 特有 delta。
- [.imm/specs/imm-party-subagent-delegation.spec.md](docs/specs/imm-party-subagent-delegation.spec.md)
  与 [bounded-advisory-delegation-packets.md](docs/solutions/bounded-advisory-delegation-packets.md)
  已统一为 `shared_context_summary + focus_delta`，不再保留 per-role full summary wording。
- `tests/test_skill_contracts.py`
  新增 focused checks，分别守住 single-layer handoff、shared-context wording cleanup、以及 baseline-reference plus role delta。
- `python3 -m unittest tests.test_skill_contracts`
  在 follow-up 闭环后通过，共 `30` 个 skill contract tests。

## 约束与建议

- 不要把“共享 baseline”误做成“删掉所有 skill-local delta”；当前 role 的特有边界仍应明确可读。
- 不要为了减 token 把 payload 和 outer contract 混成一句模糊说明；字段层次要更清楚，而不是更糊。
- 如果某个 skill 还没有稳定的 repo-wide baseline，可先保持 skill-local 明确性；只有在共享基线已经成形时，引用式收口才会真正减重。
- 如果后续要把这套模式推广到更多 skill，优先先扩 focused tests，再扩文本收口，避免出现“文案先缩了，测试和下游消费还按旧层次理解”的回退。

---
*沉淀日期: 2026-05-09 | 来源: imm-party hygiene review follow-up U1-U3 全步骤验收*
