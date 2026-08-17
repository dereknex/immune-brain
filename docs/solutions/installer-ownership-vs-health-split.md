> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Installer Ownership vs Health Split

**领域**: Installer contract / self-repair / managed runtime health
**描述**: 安装器同时支持 `install`、`--check`、`--uninstall` 时，必须把“这个产物是不是我拥有的 managed install”和“这个产物是否健康可运行”拆成两个判断。Ownership 判断要足够宽，允许修复或清理损坏的受管产物；health 判断要足够严，能让 `--check` 报出缺失运行依赖。

**reusability**: high
**next_reuse_scenarios**: [`安装器需要自动修复缺文件的 managed runtime`, `--check 新增严格文件完整性验证`, `--uninstall 需要清理部分损坏但仍带受管 marker 的安装产物`, `copy-installed CLI wrapper 依赖一个共享 runtime payload`, `健康检查函数被复用于 install/uninstall ownership 判断`]

## 场景

- 安装器会把 CLI wrapper、runtime payload、reference artifacts 等复制到用户 home 下。
- `--check` 需要确认运行依赖都存在，例如 `.imm/activation_plan.py`。
- `install` 和 `--uninstall` 也需要判断已有目录是否属于当前 installer，避免覆盖或删除未知文件。
- 如果同一个函数既检查 marker 又检查所有运行文件，那么一个缺文件的受管 runtime 会被误判成“非受管”，导致 reinstall / uninstall 都要求用户手动删除。

## 方案模板

1. **先定义 ownership 判断**: 只检查稳定 marker、family、kind、runtime root 等身份字段。它回答“这个目录是不是我的受管产物”。
2. **再定义 health 判断**: 先调用 ownership 判断，再检查运行所需文件、reference artifacts、可执行 wrapper 等。它回答“这个安装现在能不能正常运行”。
3. **不同路径使用不同判断**:
   - `install` / `--uninstall` 用 ownership 判断，允许自动替换或清理损坏的受管产物。
   - `--check` 用 health 判断，缺文件必须失败。
   - wrapper 自身是否受管，也应优先验证 wrapper marker 和 runtime ownership，而不是 runtime health。
4. **回归测试必须覆盖修复路径**: 不能只测 `--check` 失败；还要测同一个损坏状态下 reinstall 能恢复、uninstall 能清理。

## 可复用前提

- 安装产物有明确的 managed marker 或等价身份签名。
- 系统有安全边界，不能无条件删除未知目录。
- 缺失运行文件是一种可修复的受管安装损坏，而不是用户手工创建的未知目录。

## 验证依据

- `scripts/install-local.sh` 拆出了 marker-based `is_owned_cli_runtime_copy`，并保留 strict `is_managed_cli_runtime_copy` 作为 health gate。
- 同一文件中，`prepare_cli_runtime_for_install` 与 `uninstall_cli_runtime` 改用 ownership 判断；`check_cli_install` 继续使用 health 判断。
- `tests/test_install_local.py` 覆盖了三条关键路径：缺失 runtime `.imm/activation_plan.py` 时 `--check` 失败；再次 install 会恢复该脚本；`--uninstall` 能清理这个损坏但受管的 runtime。
- [2026-05-12-076-fix-managed-cli-runtime-ownership-health-plan.md](../plans/2026-05-12-076-fix-managed-cli-runtime-ownership-health-plan.md) 的 U1 已通过 `zsh -n scripts/install-local.sh && python3 -m unittest tests.test_install_local`，其中安装器测试共 16 条通过。

## 约束与建议

- 不要让 ownership 判断检查 payload 完整性；否则自修复路径会在最需要工作时失效。
- 不要让 health 判断变宽；`--check` 的价值就是暴露真实缺口。
- 如果未来 runtime payload 增加更多必需文件，优先扩展 health 判断和 repair-path regression，而不是扩大 ownership 判断。
- 如果无法用 marker 明确证明 ownership，宁可拒绝覆盖或删除；这个模式不是“见到同名目录就自动清理”。

---
*沉淀日期: 2026-05-12 | 来源: activation plan CLI health check + managed CLI runtime ownership repair 闭环*
