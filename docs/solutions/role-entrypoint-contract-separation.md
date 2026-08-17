> Note: retired Python file paths appear as inline code and refer to the pre-TypeScript-migration runtime.

# Pattern: Role-Entrypoint Contract Separation

**领域**: Agent workflow / CLI contract
**描述**: 当 workflow 同时存在 authority role、skill 名和 shell entrypoint 时，必须显式区分“谁拥有权限”和“实际该调用什么入口”，避免调用方把 role 名误判为可执行命令。

**reusability**: high
**next_reuse_scenarios**: [`status`/`next_action` 需要给调度器消费, skill 名与 CLI 名不完全一致, workflow 通过单入口协调多角色语义]

## 场景

- 状态机需要输出下一步角色，例如 `imm-executor` 或 `imm-qa`。
- 系统实际只暴露一个默认 CLI continue entry，例如 `imm-work`。
- 文档同时提到 skill 名、权限边界和 workflow 下一步，容易让用户或自动化层把 role 名当成 shell 命令。
- 入口混淆会导致错误的安装判断，例如“某个 role 未安装/不可调用”，即使真实问题只是 contract 表达不清。

## 方案模板

1. **区分 role 与 entrypoint**: 在 machine-readable 状态里同时输出权限角色和恢复入口，例如 `authority_role` 与 `continue_entry`。
2. **保留 role 边界**: `imm-work`、`imm-executor`、`imm-qa` 继续保持各自 authority boundary，不因为入口收口而合并职责。
3. **文档与帮助文本同步收口**: README、安装说明和 workflow 文案必须明确哪些是默认 CLI wrapper，哪些只是 skill / role 名。
4. **双侧回归守卫**: 一侧测试状态输出是否暴露 role/entrypoint 区分；另一侧测试默认安装命令集合是否仍与文档一致。
5. **不要用兼容 shim 掩盖 contract 漂移**: 如果真实问题是语义混淆，优先修状态与文档，而不是先补同名命令。

## 可复用前提

- workflow 存在结构化状态输出，且调用方会消费 `next_action` 或等价字段。
- 默认 CLI 入口少于内部 role/skill 数量，或两者命名不一一对应。
- 系统已经把 authority boundary 当成稳定约束，不能为了入口方便而合并角色。

## 验证依据

- `imm-work.py` 现在在 `next_action` 与 `codex_status` 中同时暴露 `authority_role`、`continue_entry` 和 `next_role`，不再只依赖 `next_skill` 推断命令。
- [README.md](README.md) 与 `install-local.sh` 现在明确默认只安装 6 个 CLI wrapper，`imm-executor` / `imm-qa` 作为 skill 与 role 通过 `imm-work` 语义进入。
- `test_imm_work.py` 锁住 executor / QA 路径的 role-versus-entrypoint 状态字段。
- `test_install_local.py` 锁住默认 wrapper 集合，并确认不会默认安装 `imm-executor` / `imm-qa` 命令。
- 本轮 workflow plan [2026-05-08-001-fix-role-entrypoint-contract-plan.md](docs/plans/2026-05-08-001-fix-role-entrypoint-contract-plan.md) 已完成 3 个 step，并通过 `imm-review pass` 闭合。

## 约束与建议

- 不要把 `next_skill` 直接当成 shell 命令名；它更适合表达 authority role 或下一语义。
- 如果系统对外只有单入口，帮助文本必须列出真实安装的命令集合，避免让用户靠 README 文意猜测。
- 文档修正和状态修正要一起做；只修其中一侧，回归会很快重新出现。
- 这类模式优先沉淀为 contract 和 focused regression，不需要一开始就扩成完整 workflow harness。

---
*沉淀日期: 2026-05-08 | 来源: role-entrypoint contract repair 计划闭环*
