# Spec: compound finish entry contract

**任务 ID**: IMM-WORKFLOW-OPS-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 `imm-compounder` 当前对 finish/dehydrate 闭环入口的默认契约，让推荐路径与
仓库既有的 workflow 入口迁移约定一致：默认通过 `imm-finish` CLI 闭环，只在
该入口不可用时才回退到项目内 `.imm/imm-finish.py` 兼容路径，并明确说明是否因此
跳过了 dev insights 记录。

## 2. 问题背景

当前 `skills/imm-compounder/SKILL.md` 仍要求执行
`python3 .imm/imm-finish.py "<summary>" "<next steps>"`，而仓库其他入口与沉淀文档
已经把推荐执行路径迁移到用户级 `imm-*` CLI。这样一来，当 skill 被安装到只保留
`.imm/memory`、`.imm/specs` 等项目状态目录的目标仓库时，用户会看到
“`.imm/imm-finish.py` 当前不存在，所以这轮没有额外的 finish/dehydrate 记录。”
之类的提示，即使真正的问题只是 contract 仍默认指向旧入口。

## 3. 功能需求

### R1. 默认 finish 入口与迁移约定一致

- `imm-compounder` 必须把 `imm-finish "<summary>" "<next steps>"` 作为默认闭环入口。
- contract 不得再把 `.imm/imm-finish.py` 写成默认 happy path。
- `imm-dehydrate` 仍不得作为默认替代入口，因为 dev insights 记录仍依赖 finish path。

### R2. fallback 语义显式且收敛

- 仅当 `imm-finish` 在当前环境中不可用时，contract 才能提到项目内
  `.imm/imm-finish.py` 兼容路径。
- fallback 文案必须说明：这是兼容路径，不是推荐入口。
- 如果 fallback 或环境缺口会导致 dev insights 未记录，contract 必须要求显式告知。

### R3. 契约回归与文档一致

- focused contract regression 必须守卫默认入口和 fallback 语义，避免以后再次回写旧路径。
- 与 workflow trigger / 入口迁移相关的沉淀文档如果仍把旧路径描述成默认入口，需要同步收口。
- 本轮不修改 `.imm/imm-finish.py`、`.imm/imm-dehydrate.py`、`scripts/legacy-cli-launcher`
  或安装机制。

## 4. 验收标准

- [ ] `skills/imm-compounder/SKILL.md` 将 `imm-finish` 写成默认闭环入口。
- [ ] `skills/imm-compounder/SKILL.md` 只把 `.imm/imm-finish.py` 作为环境缺口下的兼容 fallback。
- [ ] `tests/test_skill_contracts.py` 或等价 focused regression 能识别上述默认入口与 fallback 语义。
- [ ] 相关沉淀文档不再把 `python3 .imm/imm-finish.py` 描述成推荐入口。
- [ ] 本轮范围不扩展到 finish/dehydrate runtime 实现、PATH 自动修复或 installer 改造。

## 5. 非目标

- 不重写 `imm-finish.py` / `imm-dehydrate.py` 的内部逻辑。
- 不新增 `imm-finish` 以外的新默认 CLI wrapper。
- 不回溯修改所有历史计划或历史任务记录。
- 不处理与本次问题无关的 runtime state path 或 sandbox 权限问题。

## 6. 依赖项

- 依赖 [README.md](README.md) 中现有的 CLI 入口约定。
- 依赖 [Pattern: Immune-Brain Workflow Entry Migration](docs/solutions/imm-workspace-pollution-migration-path.md) 的迁移与回退边界。
- 依赖 [Pattern: Observable Workflow Trigger Contracts](docs/solutions/workflow-trigger-contracts.md) 对“真实入口 + focused regression + 显式 fallback”的约束。
