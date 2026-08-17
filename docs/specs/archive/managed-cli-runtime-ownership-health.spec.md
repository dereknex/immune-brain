# Spec: managed CLI runtime ownership and health separation

**任务 ID**: IMM-SUBAGENT-INSTALL-003
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修复 installer 对 managed CLI runtime 的 ownership 与 health 混用问题：缺少 `.imm/activation_plan.py` 的 runtime 必须在 `--check` 中被判定为不健康，但仍应被识别为 installer 拥有的 runtime，从而允许重新安装自动修复，或允许卸载自动清理。

本规格延续上一轮 `Activation Plan` CLI health check repair，不改变 `Activation Plan` candidate 选择逻辑，不改变 CLI wrapper 形状，不改变 reference artifact ownership。

## 2. 问题背景

上一轮修复把 `.imm/activation_plan.py` 加入 `is_managed_cli_runtime_copy`，让 `legacy-installer.sh --check` 能发现缺失的 activation runtime script。这关闭了健康检查漏检，但也把文件完整性检查放进了同一个 ownership 判定函数。

该函数同时被安装和卸载路径用来判断 runtime 是否安全替换或删除。结果是：一个带有 managed marker、family、kind 的 runtime 只要缺少 `.imm/activation_plan.py`，就会被当成“不是受管 runtime”，导致 reinstall 和 uninstall 都要求用户手动清理。这个行为会阻塞 installer 自修复。

## 3. 功能需求

### R1. Ownership check is marker-based

- installer 必须能通过 marker / family / kind 判断 runtime 是否属于本仓库 managed install。
- 缺少 `.imm/activation_plan.py` 不应让 ownership 判断失败。
- install / uninstall 的替换和清理路径必须使用 ownership 判断，而不是 health 判断。

### R2. Health check remains strict

- `legacy-installer.sh --check` 必须继续验证 `.imm/activation_plan.py`、`imm-plan.py`、`imm-work.py`、`imm-review.py` 等 runtime 运行依赖。
- 缺少 `.imm/activation_plan.py` 时，`--check` 必须返回非零。

### R3. Repair-path regression tests cover damaged managed runtime

- `tests/test_install_local.py` 必须覆盖损坏 runtime 的 reinstall 修复路径：安装后移除 `.imm/activation_plan.py`，再次运行 install 后 `--check` 通过且 script 恢复。
- `tests/test_install_local.py` 必须覆盖损坏 runtime 的 uninstall 清理路径：安装后移除 `.imm/activation_plan.py`，`--uninstall` 仍能移除 managed CLI runtime 和 wrappers。

## 4. 验收标准

- [ ] 临时 HOME 安装后，移除 runtime `.imm/activation_plan.py` 会让 `zsh scripts/legacy-installer.sh --check` 失败。
- [ ] 同一损坏状态下，再次运行 `zsh scripts/legacy-installer.sh` 会自动替换 runtime 并恢复 `.imm/activation_plan.py`。
- [ ] 同一损坏状态下，运行 `zsh scripts/legacy-installer.sh --uninstall` 会清理 managed CLI runtime 与 wrappers。
- [ ] `python3 -m unittest tests.test_install_local` 通过。

## 5. 非目标

- 不修改 `docs/reference/subagent-trigger-catalog.yaml`。
- 不修改 Codex `spawn_agent` dispatch 文档。
- 不改变 `imm-activation-plan` CLI 参数或 JSON 输出。
- 不改变 `imm-work` / `imm-plan` / `imm-review` 状态机。

## 6. 依赖项

- [activation-plan-cli-health-check.spec.md](activation-plan-cli-health-check.spec.md)
- [2026-05-12-075-fix-activation-plan-cli-health-check-plan.md](../../docs/plans/2026-05-12-075-fix-activation-plan-cli-health-check-plan.md)
