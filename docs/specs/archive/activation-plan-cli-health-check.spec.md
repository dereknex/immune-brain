# Spec: activation plan CLI health check repair

**任务 ID**: IMM-SUBAGENT-INSTALL-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 managed install 健康检查的漏检：`imm-activation-plan` 已成为正式 CLI wrapper 后，`legacy-installer.sh --check` 必须确认 runtime copy 中存在它实际执行的 `.imm/activation_plan.py`。如果该文件缺失，安装检查必须失败，而不是继续报告可用。

本规格只覆盖健康检查与回归测试，不改变 `Activation Plan` 的 candidate 选择逻辑、不改变 reference artifact 安装策略、不改变 Codex subagent dispatch 协议。

## 2. 问题背景

上一轮 subagent activation runtime 修复已经新增 `imm-activation-plan` wrapper。该 wrapper 执行 runtime root 下的 `.imm/activation_plan.py`，但 managed CLI runtime 判定函数仍只检查旧的 `imm-plan.py`、`imm-work.py`、`imm-review.py` 等核心文件。

这会造成一个危险误报：runtime copy 中缺失 `.imm/activation_plan.py` 时，`legacy-installer.sh --check` 仍可能通过，随后用户调用 `imm-activation-plan` 才失败。这个行为复现了原问题的类型：安装健康检查没有覆盖 activation planning 的真实运行依赖。

## 3. 功能需求

### R1. Managed CLI runtime check covers activation planning

- `scripts/legacy-installer.sh` 的 managed CLI runtime 检查必须验证 `.imm/activation_plan.py` 存在于 runtime root。
- 如果 `.imm/activation_plan.py` 缺失，`legacy-installer.sh --check` 必须失败。
- 该检查应与现有 managed runtime marker / `.imm` 文件检查保持同一风格。

### R2. Regression test protects the failure mode

- `tests/test_install_local.py` 必须覆盖安装后 runtime `.imm/activation_plan.py` 缺失的场景。
- 该测试必须证明 `legacy-installer.sh --check` 返回非零，并报告 CLI runtime 缺失或不可用。
- 该测试不需要真实 dispatch subagent，也不需要改变 activation trigger catalog。

## 4. 验收标准

- [ ] 临时 HOME 安装后，删除或模拟缺失 runtime `.imm/activation_plan.py` 会让 `zsh scripts/legacy-installer.sh --check` 失败。
- [ ] 完整安装后，`zsh scripts/legacy-installer.sh --check` 仍通过。
- [ ] `python3 -m unittest tests.test_install_local` 通过。
- [ ] 变更不触碰 `Activation Plan` candidate 选择语义。

## 5. 非目标

- 不修改 `docs/reference/subagent-trigger-catalog.yaml`。
- 不修改 Codex `spawn_agent` dispatch 文档。
- 不新增 subagent registry、scheduler 或 background dispatcher。
- 不改变 `imm-work` / `imm-plan` / `imm-review` 状态机。

## 6. 依赖项

- [subagent-activation-install-runtime.spec.md](subagent-activation-install-runtime.spec.md)
- [2026-05-12-074-fix-subagent-activation-install-runtime-plan.md](../../docs/plans/2026-05-12-074-fix-subagent-activation-install-runtime-plan.md)
