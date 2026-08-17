---
title: "Unified Local Installation Refactor"
type: feature
status: active
date: 2026-05-15
---

# Iteration Plan: Unified Local Installation Refactor

## Task

- Summary: 将多个零散的安装相关 Spec 合并为统一的安装逻辑。重构 `scripts/legacy-installer.sh` 以支持多目标自动探测安装，移除死代码（symlink 模式），并简化 `mise.toml` 任务。
- Origin: User request "合并默认安装和cluade安装" and three Proposed specs (`claude-code-install.spec.md`, `legacy-installer-copy-default.spec.md`, `legacy-installer-script-refactor.spec.md`).
- Spec: `.imm/specs/unified-local-install.spec.md`

## Research

- `scripts/legacy-installer.sh` 目前通过 `CLAUDE_INSTALL` 标志位硬性切换 `TARGET_DIR`，不支持单次运行多目标。
- `mise.toml` 中存在大量重复的任务定义（`legacy-installer` vs `install-claude`）。
- 脚本中存在 `INSTALL_MODE` 等已不再使用的 symlink 逻辑残留，代码库正在向纯 copy 模式演进。
- `CONTEXT.md` 强调受管副本（Managed Copy）作为分发核心，减少仓库污染。

## Decisions

- 使用 `TARGET_DIRS` 数组代替单一 `TARGET_DIR`，支持在一次运行中处理多个目标。
- 自动探测：若 `~/.claude` 存在，则自动将其加入安装目标。
- 移除 `--copy` 标志，因为它不再区分行为（已经是唯一支持的模式）。
- 合并重复的目录/文件准备函数和标记验证逻辑。

## Assumptions

- 用户本机安装了 ZSH（脚本使用 `zsh` shebang）。
- 移除 symlink 模式不会对现有活跃开发造成负面影响（已确认 copy 模式为当前推荐标准）。
- `~/.claude` 的存在是安装 Claude 技能的一个强信号。

---

### Step 1

- Step ID: U1
- Result: Consolidated specification replaces fragmented proposed specs
- Verification: `ls .imm/specs/` shows `unified-local-install.spec.md` without `claude-code-install.spec.md`, `legacy-installer-copy-default.spec.md`, or `legacy-installer-script-refactor.spec.md`.
- Depends on: None
- failure_behavior: If specs are missing, subsequent steps lack a source of truth for refactoring logic.
- security_considerations: None.

### Step 2

- Step ID: U2
- Result: Unified installation infrastructure replaces legacy symlink code
- Verification: `scripts/legacy-installer.sh --help` does not mention `--copy`; `grep 'INSTALL_MODE\|trim()' scripts/legacy-installer.sh` is empty; function `prepare_target_for_install` handles both files and directories.
- Depends on: 1
- Execution note: characterization-first
- failure_behavior: If infrastructure is broken, installation will fail or target incorrect paths.
- security_considerations: None.

### Step 3

- Step ID: U3
- Result: Multi-target auto-detection populates all applicable skill paths
- Verification: `scripts/legacy-installer.sh --check` reports status for both Codex and Claude paths (if they exist); `mise run legacy-installer` successfully populates both targets.
- Depends on: 2
- failure_behavior: Auto-detection failure might skip valid targets or install to non-existent ones.
- security_considerations: None.

### Step 4

- Step ID: U4
- Result: Unified installation surfaces are simplified
- Verification: `mise.toml` tasks are simplified; README `0. 安装到本地 Codex` 章节 contains multi-target instructions; `mise run test` passes.
- Depends on: 3
- failure_behavior: Documentation drift or task failures will confuse users.
- security_considerations: None.

## Test scenarios

- `scripts/legacy-installer.sh` correctly identifies and installs to both `plugin skill registry` and `~/.claude/skills` if they exist.
- `scripts/legacy-installer.sh --uninstall` removes products from all active targets.
- `--check` accurately reports health for both targets independently.
- `mise run legacy-installer` works without needing additional flags for Claude if detection succeeds.
