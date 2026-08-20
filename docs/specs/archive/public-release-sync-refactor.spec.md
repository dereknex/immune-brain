# Spec: Public Release Sync Refactor

**任务 ID**: IMM-RELEASE-003
**负责人**: Planner
**状态**: Proposed
**取代**: IMM-RELEASE-002

## 1. 目标

重构公共仓库同步机制，以贯彻“自包含插件（Plugin）”新方案。公共仓库应当纯净化，只包含插件本身、IDE 插件市场配置文件以及真正面向最终用户的使用说明文档，彻底物理隔绝核心系统的内部实现细节（如根目录的私有 `.imm/` 运行时源码、架构设计 Specs 和 Protocols）。插件包内部的 `plugins/immune-brain/dist/docs/...` 属于自包含运行时资产，不等同于根目录私有设计文档。

## 2. 问题背景

在新方案中，插件的独立运行时及相关技能指令（Skills）已经高度内聚打包在 `plugins/immune-brain/dist/` 和 `plugins/immune-brain/skills/` 中。用户项目只需安装该插件，便可在本地回退并正常运行所有 MCP 工具，无需将开发仓库根目录下的私有 `.imm/` 开发核心同步到公共仓库。
此外，现有的同步配置仍硬编码同步了描述自动子agent激活、分发协议等系统内部机密设计的 spec 和协议参考文档。同时，`public-release/templates/README.md` 中的验证路径已经过时（指向了已被过滤的路径），必须一并予以修正。

## 3. 功能需求

### R1. 彻底移除根目录私有核心 `.imm/` 的同步
- 从 `scripts/sync-to-public.sh` 的 `KEEP_PATHS` 中删除 `".imm/"`。
- 确保公共发行版完全通过 `plugins/immune-brain/dist/.imm/` 自包含运行时提供工具链运行支持。

### R2. 物理隔绝内部设计 Specs & Protocols
- 清空或删除 `scripts/sync-to-public.sh` 中的 `PUBLIC_SPEC_PATHS` 变量，不再公开任何根目录 `docs/specs/...` 下的设计规格文件。
- 从 `PUBLIC_REFERENCE_PATHS` 中移除内部开发参考文章：
  - `docs/reference/automatic-subagent-activation-policy.md`
  - `docs/reference/subagent-dispatch-protocol.md`
  - `docs/reference/subagent-trigger-catalog.yaml`

### R3. 提供清晰且完备的用户参考说明
- 在 `PUBLIC_REFERENCE_PATHS` 中添加面向用户的技能指南与配置说明文档：
  - `docs/reference/immune-brain-skills-guide.md`
  - `docs/reference/immune-brain-config.md`
  - `docs/reference/workflow-and-subagents.md`

### R4. 更新公共 README 模版验证路径 (R4.1 & R4.2)
- 在 `public-release/templates/README.md` 中：
  - **R4.1** 将过时的命令 `python3 plugins/immune-brain/scripts/immune_brain_runtime.py list-tools` 修正为正确的插件打包入口：
    ```bash
    python3 plugins/immune-brain/dist/immune_brain_runtime.py list-tools
    ```
  - **R4.2** 将已在根目录被剔除的 `.imm/imm-heal.py` 验证路径，修正为指向插件内置的运行时入口：
    ```bash
    python3 plugins/immune-brain/dist/.imm/imm-heal.py
    ```

## 4. 验收标准

- [ ] 执行同步脚本的 `--dry-run` 模式后，输出的保留文件列表中：
  - 不包含外部根目录的 `.imm/` 及其子路径。
  - 不包含任何根目录 `docs/specs/...` 下的 spec 文件。
  - 不包含 `automatic-subagent-activation-policy.md`、`subagent-dispatch-protocol.md`、`subagent-trigger-catalog.yaml` 等内部开发参考文章。
  - 包含 `docs/reference/immune-brain-skills-guide.md`、`docs/reference/immune-brain-config.md`、`docs/reference/workflow-and-subagents.md`。
- [ ] 实际运行 `scripts/sync-to-public.sh --force` 并在临时目录生成发布产物后，通过文件树比对（File Tree Check）确认以上白名单与黑名单精确生效。
- [ ] `public-release/templates/README.md` 与 `public-release/templates/mise.toml` 内的所有验证命令更新正确，不含已被删除的 `.imm/imm-heal.py` 或者是 `plugins/immune-brain/scripts/...` 的链接与死链。

## 5. 非目标

- 不重新打包或编译插件。
- 不影响主仓库内部的开发、测试与自愈系统运行逻辑。

## 6. 验证路径

### V1. 同步结果干跑验证 (Dry Run Verification)
- 场景：执行 `bash scripts/sync-to-public.sh --dry-run`
- 期望：输出日志中精确显示 Kept paths 和 Excluded paths，外部根目录 `.imm/` 为 dropped，而用户指南为 kept。

### V2. 文件树最终校验 (File Tree Verification)
- 场景：在临时目录 `/tmp/test-pub-release` 下生成发行产物。
- 期望：生成的 README.md 文件与 `public-release/templates/README.md` 模板内容完全对齐且验证命令全部指向正确。
