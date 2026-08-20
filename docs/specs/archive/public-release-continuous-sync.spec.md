# Spec: Public Release Continuous Sync

**任务 ID**: IMM-RELEASE-004
**负责人**: Planner
**状态**: Proposed
**取代**: 无

## 1. 目标

重构公共仓库同步脚本 `scripts/sync-to-public.sh`，使其支持“持续/增量同步”，而不需要每次重置整个目录。在目标目录已存在时，默认进行增量覆盖同步；若用户显式指定 `--force` 进行完全重置清空，则安全清空目标目录下除 `.git` 目录外的所有文件，完整保留版本控制历史（Git commits, branch & remote configs）和本地 Git 配置。

## 2. 问题背景

目前的 `scripts/sync-to-public.sh` 具有以下两个设计缺陷：
1. **强制的 `--force` 限制**：当输出目录已存在时，脚本强制要求用户带上 `--force` 参数，否则直接报错退出。这阻止了默认的简易同步操作。
2. **毁灭性的重置行为**：如果使用 `--force`，脚本会执行 `rm -rf "$OUTPUT_DIR"` 将整个目录彻底抹除，其中包括了公开仓库的 `.git/` 版本控制目录。这导致在此目录上进行“同步 -> 增量 commit -> 推送”的持续集成与发布工作流程被彻底打断，每次同步后都必须重新进行 `git init` 与配置 remote。

为了支持持续同步与增量发布，我们必须在保障安全性的前提下，实现目标发布目录的无损持续同步。

## 3. 功能需求

### R1. 支持默认无阻碍增量同步
- 当输出目录 `$OUTPUT_DIR` 已经存在，并且包含安全标识文件 `$MARKER_FILE` (`.public-release-artifact`) 时：
  - 即使不指定 `--force` 选项，也允许脚本直接执行同步（增量覆盖白名单文件与公共模版文件），不再报错退出。
  - 此时，目标目录中的其他文件（包括 `.git` 目录及其他非同步文件）应保持原样，不被删除。

### R2. 重新定义 `--force` 动作为保留 `.git` 的干净清理
- 当指定了 `--force` 选项时，执行以下“安全清理”动作：
  - 不再执行 `rm -rf "$OUTPUT_DIR"`。
  - 而是执行兼容的清理命令，安全清空 `$OUTPUT_DIR` 中**除了 `.git/` 文件夹之外**的所有文件和子目录。
  - 清理完毕后，再次创建 `$MARKER_FILE` 并进行完整复制。
  - 具体清理的兼容 bash 实现推荐使用：
    ```bash
    find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 ! -name ".git" -exec rm -rf {} +
    ```
    此命令在 macOS (BSD) 和 Linux (GNU) 系统中均具备卓越的兼容性与原子清理性能。

### R3. 保持防呆安全性校验
- 如果目标目录 `$OUTPUT_DIR` 已经存在，但**不包含**安全标识文件 `$MARKER_FILE`：
  - 无论是带 `--force` 还是不带 `--force`，都必须继续予以**拒绝**，并报错提示 `Missing marker file`，以防误删或误写到非发布性质的本地关键目录。
- 拒绝向源仓库自身（`$REPO_ROOT`）或系统根目录进行同步的限制依然保持不变。

## 4. 验收标准

- [ ] **安全校验验证**：在 `/tmp/unsafe-dir` 下创建一个不含 `.public-release-artifact` 的已有目录，运行脚本时应拒绝写入。
- [ ] **默认增量同步验证**：在 `/tmp/test-pub-sync`（包含标识文件）下，不加 `--force` 运行脚本，能成功覆盖已有文件，且不报错。
- [ ] **保留 Git 重置验证**：
  - 在目标目录初始化一个 Git 仓库（包含 `.git/` 文件夹），在此目录下创建一个不在同步白名单内的多余文件 `dummy.txt`。
  - 带 `--force` 运行同步脚本，验证：
    1. 同步能够成功完成。
    2. `.git/` 文件夹及其中的分支、提交记录完美保留。
    3. `dummy.txt` 已经被彻底清除，不存在文件残留。
- [ ] **回归测试**：运行 `python3 -m unittest tests.test_immune_brain_plugin_package` 依然全部通过。

## 5. 非目标

- 不集成或自动执行任何 `git add/commit/push` 操作。
- 不修改现有的 `KEEP_PATHS`、`EXCLUDE_PATHS` 等同步白名单。
