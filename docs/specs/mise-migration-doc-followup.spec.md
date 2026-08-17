# Spec: mise migration documentation follow-up

**任务 ID**: IMM-MISE-002
**负责人**: Planner
**状态**: Proposed

## 1. 目标

闭合 `imm-code-review` 对 mise 迁移切片提出的文档与验收缺口：消除 `upstreams/` 以外仍残留的 `make legacy-installer` / `make list-skills` 等主入口表述；修正仍引用已删除 Makefile 的规格文案；用 **扩展正则** 或等价方式定义可复现的「无残留」验收命令，避免普通 `grep` 把 `|` 当字面量导致假阴性。

## 2. 需求

### R1. 第一方路径无 Makefile 时代安装主入口示例
- 在 `upstreams/` 以外的已跟踪内容中，不得再出现作为推荐安装入口的 `make test`、`make legacy-installer`、`make list-skills`、`make heal`、`make unlegacy-installer`、`make check-install` 等示例（历史计划正文、`.imm/specs/`、必要时含 `docs/plans/2026-05-12-072` 内对旧验收命令的描述一并纠正为正确语义）。
- 与 `legacy-installer.sh --list` 等价的说明应使用 `mise run list-skills` 或明确写出与 `mise` task 的对应关系。

### R2. 规格与历史计划对齐当前仓库形态
- `.imm/specs/readme-installed-skills-sync.spec.md` 中不得再要求或并列 `make list-skills`；不得再写「不修改 `Makefile`」作为约束（根目录 Makefile 已移除）。
- `docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md` 中 Verification 行改为 `mise run` / `mise run check-install` 等与当前文档一致的主入口表述。

### R3. 可选：验证依据表述不丢失 `--list` 等价性
- `docs/solutions/advisory-roundtable-layer.md` 可在单行内同时指向 `mise run list-skills` 与 `zsh scripts/legacy-installer.sh --list` 的等价关系，避免读者误以为只有 mise 才能列出。

## 3. 验收标准

- [ ] `git grep -nE 'make[[:space:]]+(test|legacy-installer|list-skills|heal|uninstall|check-install)' -- ':(exclude)upstreams'` 退出码为 1 且无输出（表示无匹配）。
- [ ] `.imm/specs/readme-installed-skills-sync.spec.md` 已更新为 `mise run list-skills` 叙事且 R2 不再绑定已删除的 Makefile。
- [ ] `docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md` 的 Verification 行不再使用 `make list-skills`。

## 4. 依赖项

- [docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md](docs/plans/2026-05-07-001-feat-immune-brain-party-advisory-plan.md)
- [.imm/specs/readme-installed-skills-sync.spec.md](docs/specs/readme-installed-skills-sync.spec.md)
- [docs/plans/2026-05-12-072-feat-mise-task-runner-migration-plan.md](docs/plans/2026-05-12-072-feat-mise-task-runner-migration-plan.md)
- [docs/solutions/advisory-roundtable-layer.md](docs/solutions/advisory-roundtable-layer.md)

## 5. 非目标

- 不修改 `mise.toml` 或 `scripts/legacy-installer.sh` 行为。
- 不清扫 `upstreams/` 子模块。
- 不以此为契机修复无关的 `test_workflow_loop` 等既有失败用例。
