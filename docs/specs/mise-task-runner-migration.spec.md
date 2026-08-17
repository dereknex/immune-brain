> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: mise task-runner migration

**任务 ID**: IMM-MISE-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

用 mise 统一管理开发环境工具与所有可运行任务，移除根目录 Makefile，并将仓库内所有文档与规格中「make」的主入口引用替换为「mise run」，使贡献者只需记忆一个工具链入口。

## 2. 需求

### R1. mise.toml 覆盖全部操作入口
- 根目录新建 `mise.toml`，`[tasks]` 节覆盖 Makefile 的全部 7 个目标（`test`、`legacy-installer`、`legacy-installer-copy`、`unlegacy-installer`、`check-install`、`list-skills`、`heal`），并补充 README 中出现但未在 Makefile 中列出的 `enable-dev-insights` 变体，共 8 个任务。
- `mise run <task>` 的实际行为与被替换的 `make <target>` 或 `zsh scripts/legacy-installer.sh <flag>` 完全等价，底层仍调用相同的脚本与命令。
- 每个 task 提供 `description`，使 `mise tasks` 输出可读。

### R2. 根目录 Makefile 移除
- 删除根目录 `Makefile`；仓库不再提供 make 入口。

### R3. 文档与规格统一推 mise 入口
- `README.md` 所有主工作流说明只写 `mise run <task>` 形式；末尾可附简短「无 mise 时的等价 shell 命令」逃生舱，但不再并列为主路径。
- `docs/solutions/` 和 `.imm/specs/` 中把 `make <target>` 作为示例或主入口的表述，替换为 `mise run <task>`。
- `.imm/memory/MEMORY.md` 如有 `make` 主入口描述，一并更新。

## 3. 验收标准

- [ ] `mise tasks` 输出包含：`test`、`legacy-installer`、`legacy-installer-copy`、`unlegacy-installer`、`check-install`、`list-skills`、`heal`、`enable-dev-insights`（共 8 项）。
- [ ] `python3 -m unittest discover -s tests` 通过（即 `mise run test` 等价命令返回 0）。
- [ ] 根目录 `Makefile` 不存在（`ls Makefile` 返回非零）。
- [ ] 仓库内（排除 `upstreams/`）无以 `make <target>` 作为主入口的文档表述（`rg` 在 tracked .md 文件中返回无匹配）。
- [ ] `README.md` 主路径只推 `mise run <task>` 形式。

## 4. 依赖项

- `Makefile`
- [README.md](README.md)
- `scripts/legacy-installer.sh`
- `docs/solutions/live-install-list-source-of-truth.md`
- [docs/solutions/advisory-roundtable-layer.md](docs/solutions/advisory-roundtable-layer.md)
- [docs/solutions/imm-workspace-pollution-migration-path.md](docs/solutions/imm-workspace-pollution-migration-path.md)
- [docs/solutions/imm-workspace-pollution-control-pattern.md](docs/solutions/imm-workspace-pollution-control-pattern.md)
- `.imm/specs/legacy-installer-copy-default.spec.md`
- [.imm/memory/MEMORY.md](.imm/memory/MEMORY.md)

## 5. 非目标

- 不修改 `scripts/legacy-installer.sh` 本体逻辑。
- 不修改 `upstreams/` 子模块内容。
- 不为 mise 安装提供 CI 流水线。
- 不引入 mise 管理的 Python 版本固定（避免引入非必要噪声）。
