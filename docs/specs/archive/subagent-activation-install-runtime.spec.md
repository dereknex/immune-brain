# Spec: subagent activation install runtime repair

**任务 ID**: IMM-SUBAGENT-INSTALL-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 subagent activation 在安装版 runtime 中无法正常启用的问题：已安装 skill 能读到共享 dispatch reference，已安装 runtime 能读到 trigger catalog，并提供可验证的 activation plan 调用路径。同时对齐 Codex dispatch 文档与当前 `spawn_agent` 工具 schema，避免 host skill 按不存在的参数构造调用。

本规格延续现有 host-bound 设计：`Activation Plan` 仍只负责确定候选 subagents，不直接调度；`Delegation Packet` 仍由 host skill 构造；child reviewer 仍为 advisory-only。

## 2. 问题背景

当前源码树内的 `.imm/activation_plan.py` 与 `docs/reference/subagent-trigger-catalog.yaml` 能通过 golden tests，但本机安装形态暴露两个断点：

- `plugin skill registry/<skill>/SKILL.md` 中的 `../../docs/reference/...` 指向 `~/.agents/docs/reference/...`，而 `legacy-installer.sh` 没有安装该目录。
- `~/.immune-brain/runtime/agent-skills/.imm/activation_plan.py` 的 `DEFAULT_CATALOG` 指向 runtime root 下的 `docs/reference/subagent-trigger-catalog.yaml`，而 runtime copy 只包含 `.imm/*.py` 和 templates。

另外，`docs/reference/subagent-dispatch-protocol.md` 的 Codex 调用示例仍写成抽象的 `role` / `prompt` / `read_only` 形状，与当前可用 `spawn_agent` schema 不一致。

## 3. 功能需求

### R1. Managed install includes subagent reference artifacts

- `scripts/legacy-installer.sh` 必须把 `docs/reference/` 中 subagent activation 必需的 reference artifacts 安装到 skill 可解析的位置。
- `scripts/legacy-installer.sh` 必须把同一批 reference artifacts 安装到 CLI runtime root，使 runtime copy 的 `.imm/activation_plan.py` 能在离开源码 checkout 后读取 catalog。
- `--check` 必须验证这些 reference artifacts 存在，不能只检查 skill directories、`BASELINE.md` 和 CLI wrappers。

必需 reference artifacts 首版至少包括：

- `docs/reference/subagent-dispatch-protocol.md`
- `docs/reference/subagent-trigger-catalog.yaml`
- `docs/reference/automatic-subagent-activation-policy.md`

### R2. Activation planning is callable from managed runtime

- 安装后的环境必须有稳定调用路径生成 `Activation Plan`，用于 `imm-code-review` Phase 2。
- 推荐新增一个窄 CLI wrapper，例如 `imm-activation-plan`，只封装 `.imm/activation_plan.py` 的 deterministic builder。
- CLI 输出必须保持 side-effect free：不写 `.imm/memory/`，不调度 subagent，不调用网络。
- CLI 至少支持 `changed_paths` 和 `task_summary` 这两个现有 deterministic inputs。

### R3. Codex dispatch guidance matches available tool schema

- `docs/reference/subagent-dispatch-protocol.md` 的 Codex 分支必须使用当前 `spawn_agent` schema vocabulary，例如 `agent_type`、`message`、可选 `fork_context`。
- 不得把 `read_only` 写成 Codex tool 参数；readonly 约束应作为 `Delegation Packet` 的 `tool_policy` 与 prompt boundary 表达。
- Host skill 的 dispatch wording 不能要求使用不存在的 Codex 参数。

### R4. Existing authority boundaries remain unchanged

- 不引入 shared subagent registry。
- 不引入 background scheduler。
- 不让 `Activation Plan` 直接 dispatch。
- 不改变 `imm-work` / `imm-plan` 的核心状态机。
- 不允许 child reviewer 写计划、写实现或关闭 QA。

## 4. 验收标准

- [ ] 临时 HOME 安装后，`~/.agents/docs/reference/subagent-dispatch-protocol.md` 存在。
- [ ] 临时 HOME 安装后，`~/.immune-brain/runtime/agent-skills/docs/reference/subagent-trigger-catalog.yaml` 存在。
- [ ] 临时 HOME 安装后，managed activation CLI 或等价调用能对 `app/auth/session.py` 输出 `security-reviewer` candidate。
- [ ] `zsh scripts/legacy-installer.sh --check` 能检查 reference artifacts，缺失时失败。
- [ ] `docs/reference/subagent-dispatch-protocol.md` 的 Codex 示例不再使用不存在的 `read_only` tool 参数。
- [ ] `python3 -m unittest tests.test_install_local tests.test_activation_plan tests.test_skill_contracts` 通过。

## 5. 非目标

- 不实现通用 subagent registry。
- 不实现 LLM intent router。
- 不实现跨会话 queue、scheduler 或 webhook。
- 不让 `imm-work` 自动 fan-out。
- 不把 `imm-party` 或 `imm-ui-review` 接入 trigger catalog。

## 6. 依赖项

- [first-wave-subagent-runtime-dispatch.spec.md](first-wave-subagent-runtime-dispatch.spec.md)
- [automatic-subagent-activation.spec.md](automatic-subagent-activation.spec.md)
- [subagent-dispatch-protocol.md](../../docs/reference/subagent-dispatch-protocol.md)
- [subagent-trigger-catalog.yaml](../../docs/reference/subagent-trigger-catalog.yaml)
