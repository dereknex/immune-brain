# Spec: Public Release Engine Sync

**任务 ID**: IMM-RELEASE-002
**负责人**: Planner
**状态**: Proposed
**取代**: IMM-RELEASE-001

## 1. 目标

建立一套纯文件级复制机制，将 Immune-Brain 的 plugin-first 安装内容、用户使用说明和部署脚本同步到公开目录，同时严格物理隔绝内部项目的私有数据。

## 2. 问题背景

IMM-RELEASE-001 采用 `git-filter-repo` 进行历史提取同步。经 brainstorm 修订（BR-DEC-1），改为纯文件级 `cp`：同步脚本只复制白名单文件到目标目录，不操作 git，不保留历史。输出为干净的文件树，用户自行决定是否初始化为 git 仓库。

## 3. 功能需求

### R1. 路径白名单与物理隔离

同步机制仅包含以下路径，其余全部排除：

**安装内容：**
- `plugins/immune-brain/`（host plugin manifests、Skills、MCP config、runtime adapter、Claude `bin/` wrappers）
- `.agents/plugins/marketplace.json`
- `.claude-plugin/marketplace.json`
- `.cursor-plugin/marketplace.json`
- `.imm/`（排除 `.imm/memory/`、`.imm/imm-upstream-sync.py`、`__pycache__/`）

**用户使用说明：**
- `README.md`（public template 覆盖）
- `CONTRIBUTING.md`（public template 覆盖）
- `SECURITY.md`（public template 覆盖）
- `docs/reference/automatic-subagent-activation-policy.md`
- `docs/reference/subagent-dispatch-protocol.md`
- `docs/reference/subagent-trigger-catalog.yaml`
- `docs/specs/automatic-subagent-activation.spec.md`
- `docs/specs/cross-host-plugin-runtime.spec.md`

**部署脚本：**
- `mise.toml`（public template 覆盖）

**排除项：**
- `upstreams/`
- `docs/brainstorms/`、`docs/plans/`、`docs/solutions/`
- `.imm/memory/`、`.imm/imm-upstream-sync.py`
- `tests/`、`IMMUNE.md`、`CONTEXT.md`、`HANDOFF.md`
- `scripts/`（包括 `scripts/legacy-installer.sh`、`scripts/legacy-cli-launcher`、`scripts/sync-to-public.sh`、`scripts/check-impeccable-prereq.sh`）

### R2. 纯文件级复制

- 同步脚本使用 `cp` 进行文件复制，不调用任何 git 命令（`git clone`、`git filter-repo`、`git init`、`git commit` 等均不使用）。
- 输出为纯文件目录，不含 `.git` 目录。
- 支持 `--dry-run` 预览将要复制和排除的文件列表。
- 目标目录已存在时，脚本报错退出；通过 `--force` 可清空并重建（仅当目标目录包含同步产物标记文件时允许）。
- 拒绝向源仓库内部路径写入。

### R3. Plugin-local runtime compatibility

- 公开版通过 `plugins/immune-brain/.mcp.json` 暴露 Codex / Cursor runtime tools。
- Claude Code 可使用 `plugins/immune-brain/bin/imm-*` wrappers。
- 公开版不再以全局 `imm-*` shell wrapper 安装作为默认用户路径。

### R4. 文档脱敏

- 公开版文档只说明 host-native plugin 安装、plugin-local runtime tools 与常用 skill 入口。
- 使用 `public-release/templates/` 下的专用模板覆盖内部版本文档。

### R5. 零辅助工具原则

- 公开版不包含任何自动拉取上游子模块的脚本。

## 4. 验收标准

- [ ] 执行同步脚本后，输出目录不含 `upstreams/`、`docs/solutions/`、`docs/plans/`、`docs/brainstorms/`、`tests/`、`.imm/memory/`
- [ ] 输出目录不含 `IMMUNE.md`、`CONTEXT.md`、`HANDOFF.md`
- [ ] 输出目录不含 `.git` 目录
- [ ] 输出目录包含 `plugins/immune-brain/`、host marketplace metadata、`.imm/`（不含 `memory/`）
- [ ] 输出目录不含 `scripts/legacy-installer.sh` 或 `scripts/legacy-cli-launcher`
- [ ] 输出目录包含 `README.md`、`CONTRIBUTING.md`、`SECURITY.md`、`mise.toml`
- [ ] `--dry-run` 正确列出 kept/dropped 文件及 template 映射
- [ ] 不安全的目标目录（源仓库内部路径）被拒绝
- [ ] 不安全的 `--force`（目标目录无产物标记文件）被拒绝

## 5. 非目标

- 不在公开目录中提供 `upstreams/` 的镜像或自动下载器。
- 不处理远程公开仓库推送权限与 CI/CD 自动化。
- 不保留 git 历史。
- 不修改内部仓库的日常开发流程。

## 6. 依赖项

- 无外部工具依赖，仅需 `bash` + `cp`。

## 7. 验证路径

### V1. 同步完整性验证

- 场景：运行 `scripts/sync-to-public.sh --output-dir /tmp/test-public`
- 期望：输出目录仅含白名单文件，无 `.git`，无排除项

### V2. 安装可用性验证

- 场景：在输出目录运行 `mise run check-plugin` 与 `mise run list-runtime-tools`
- 期望：plugin metadata 与 MCP runtime config 可解析，runtime tools 可列出
