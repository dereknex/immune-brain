> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Repo-agnostic Managed Copy Markers

**领域**: Installer contract / managed local installs / checkout portability
**描述**: 当安装产物会长期落在 `~/.agents`、`~/.local/bin`、`~/.immune-brain` 这类全局位置时，`--check` 与 `--uninstall` 的受管身份识别不能绑定到某个 checkout 的绝对路径。应改用稳定的 family/kind/name marker 识别“这是不是我管理的 copy 安装”，并只把原始 `source` 路径当作兼容回退线索，而不是当前真源。

**reusability**: high
**next_reuse_scenarios**: [`全局安装脚本需要在第二个 checkout 中继续 check/uninstall 已存在安装`, `copy install 需要脱离源仓库继续存活`, `某个 installer 目前通过 source=/abs/path 判断“是不是自己装的”`, `未来要把更多 runtime payload 安装到用户 home 目录下`]

## 场景

- 安装器会把 skill、CLI wrapper 或 runtime payload 复制到用户 home 下的全局位置。
- 用户之后可能从另一个同仓库 checkout、另一个 worktree，甚至删除原 checkout 后继续运行 `--check` 或 `--uninstall`。
- 旧实现常把 marker 写成 `source=/path/to/original/repo/...`，然后在识别时要求它和“当前正在执行的 repo 路径”精确相等。
- 这种设计在首次安装时看起来没问题，但一旦换 checkout，旧安装就会被误判成“不受管”，导致 check 失败、uninstall 失效，或要求用户手工清理本来应该受管的产物。

## 方案模板

1. **先区分“身份字段”和“来源字段”**: `family`、`kind`、`skill_name` 这类字段用于判断“它是不是同一类受管安装”；`source` 只用于兼容历史 marker 或辅助排查。
2. **对每类产物写稳定 marker**: 例如 skill copy 写 `family=agent-skills`、`kind=skill`、`skill_name=<name>`；CLI runtime 写 `family=agent-skills`、`kind=cli-runtime`。
3. **wrapper 与 payload 都要能自描述**: shell wrapper 这类文本入口可以在注释里写 `imm-install-family`、`imm-install-runtime-root`，再用 runtime root 反查真实受管 payload，而不是反查当前 repo 中的 launcher 路径。
4. **兼容逻辑只做回退，不当真源**: 老 marker 仍可接受 `source` basename 等有限回退，避免升级时把既有安装全部判坏；但新逻辑不能再要求 `source == 当前 checkout`。
5. **测试必须跨 checkout 验证**: 至少补两条 focused regression，验证“从第二个 checkout 执行 `--check` 成功”和“从第二个 checkout 执行 `--uninstall` 成功”。

## 可复用前提

- 安装产物位于仓库外的全局目录，生命周期长于单个 checkout。
- 系统存在“受管安装”和“非受管安装”的区分，需要保留安全边界，不能无条件覆盖或删除未知文件。
- 当前问题是身份识别耦合了 checkout 绝对路径，而不是 payload 本身缺失。

## 验证依据

- `scripts/install-local.sh` 现在为 skill copy marker 写入 `family=agent-skills`、`kind=skill`、`skill_name=<name>`，并为 CLI runtime marker 写入 `family=agent-skills`、`kind=cli-runtime`，同时保留 legacy `source=` 兼容字段。
- 同一文件中的 CLI wrapper 检查逻辑已改为优先读取 `imm-install-family` 与 `imm-install-runtime-root`，再通过 runtime root 校验受管 runtime，而不是要求 wrapper 来源路径等于当前 checkout 的 `scripts/imm-cli-launcher`。
- `tests/test_install_local.py` 新增 `test_copy_install_can_be_checked_from_second_checkout` 与 `test_copy_install_can_be_uninstalled_from_second_checkout`，直接验证跨 checkout 的 `--check` / `--uninstall` 仍成功。
- [2026-05-10-041-fix-install-local-copy-default-plan.md](docs/plans/2026-05-10-041-fix-install-local-copy-default-plan.md) 的 `U7` 已以这两条 focused regression 通过并闭合，说明该模式不是推测，而是当前安装契约的真实修复边界。

## 约束与建议

- 不要把 repo-agnostic 识别做成“任何同名目录都算受管安装”；仍要保留 family/kind/name 或 runtime-root 这类明确签名。
- 不要为了兼容历史安装而继续把绝对 `source` 路径当 primary truth；那会把旧 bug 永久保留下来。
- 如果未来安装器支持多个产品家族共存，`family` 应是第一层隔离键，避免不同 installer 误认彼此产物。
- 只有当 payload 自身会变化到无法靠 marker 识别时，才考虑更强的 manifest 或 versioned metadata；不要在当前边界内过度设计。

---
*沉淀日期: 2026-05-10 | 来源: install-local copy default slice + U7 cross-checkout managed-copy follow-up*
