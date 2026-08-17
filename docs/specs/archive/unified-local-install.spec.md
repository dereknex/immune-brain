# Spec: Unified Local Installation

**任务 ID**: IMM-INSTALL-UNIFIED-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标
将本地安装脚本 `scripts/legacy-installer.sh` 重构为统一的、多目标的受管副本（managed copy）安装程序。合并之前分散的关于 Claude Code 支持、copy-mode 默认化以及脚本重构的规格需求，消除技术债务并简化用户操作。

## 2. 需求

### R1. 多目标自动安装
- 脚本默认尝试安装到两个目标：
    - `DEFAULT_TARGET`: `plugin skill registry/` (Codex/General)
    - `CLAUDE_TARGET`: `~/.claude/skills/` (Claude Code)
- **自动探测**：如果目标父目录存在，则默认执行安装。可以通过环境变量或标志位显式跳过或指定。
- 逻辑：
    - 始终安装到 `DEFAULT_TARGET`（如果不存在则创建）。
    - 仅当 `~/.claude` 存在时，默认安装到 `CLAUDE_TARGET`；或通过 `--claude` 显式强制安装。

### R2. 强制 Managed Copy 模式
- 彻底移除 `INSTALL_MODE=symlink` 相关逻辑。
- 移除 `--copy` 标志，因为 copy 已经是唯一且默认的行为。
- 保持对遗留 symlink 的检测，在 `--check` 时报告并引导用户重新安装以迁移到 copy。

### R3. 脚本重构与去重
- **函数合并**：合并 `prepare_target_for_install` 以统一处理目录（skills）和文件（CLI wrappers）的预清理。
- **标记验证抽象**：提取 `is_managed_skill_copy`、`is_owned_cli_runtime_copy` 等函数中重复的标记解析逻辑（mode=copy, family, kind 校验）。
- **清理**：移除单次使用的 `trim()` 函数，修复制表符缩进，统一使用空格。

### R4. 统一 Mise 任务
- 简化 `mise.toml`：
    - `legacy-installer`: 执行统一安装（自动探测所有目标）。
    - `check-install`: 检查所有受支持目标的安装状态。
    - `unlegacy-installer`: 卸载所有受支持目标的安装。
- 保留 `--claude` 专有任务仅作为快捷方式或向后兼容。

### R5. BASELINE.md 全覆盖
- 确保 `BASELINE.md` 被正确复制到所有安装目标的根目录下（`plugin skill registry/BASELINE.md` 和 `~/.claude/skills/BASELINE.md`）。

## 3. 验收标准
- [ ] 执行 `mise run legacy-installer` 后，`plugin skill registry/` 和 `~/.claude/skills/`（若后者目录存在）均包含完整的技能副本和标记文件。
- [ ] `scripts/legacy-installer.sh` 中不再包含 `INSTALL_MODE` 变量或 `ln -sfn` 命令。
- [ ] `scripts/legacy-installer.sh --check` 正确报告所有已安装目标的健康状态。
- [ ] `scripts/legacy-installer.sh --uninstall` 清理所有目标的产物。
- [ ] 所有测试通过：`python3 -m unittest discover -s tests`。
- [ ] README.md 更新为统一安装说明。

## 4. 依赖项
- `scripts/legacy-installer.sh`
- `mise.toml`
- `README.md`
- `tests/test_install_local.py`

## 5. 非目标
- 不改变技能内部的契约（SKILL.md 内容）。
- 不为 Claude Code 安装 CLI 运行时（维持技能副本唯一契约）。
