# Spec: role-entrypoint contract repair

**任务 ID**: IMM-WORKFLOW-008
**负责人**: Planner
**状态**: Draft

## 1. 目标

修复 Immune-Brain 当前 workflow contract 中对 `imm-executor` / `imm-qa` 的角色语义与 CLI 入口语义混淆问题，让 `imm-work` 继续作为默认 CLI driver，同时让 machine-readable 状态、用户提示和安装文档都能明确区分“谁拥有权限”和“实际应调用什么入口”。

## 2. 问题背景

当前实现中，`scripts/legacy-installer.sh` 与 `scripts/legacy-cli-launcher` 只安装/识别
`imm-plan`、`imm-work`、`imm-review`、`imm-heal`、`imm-dehydrate`、`imm-finish`
六个 CLI 命令；但 `.imm/imm-work.py` 的状态输出会返回 `next_skill = imm-executor`
或 `imm-qa`，README 也同时把它们描述成 skill 名、角色边界和“下一步”语义。
这会让调用方或用户自然误解为本地应该存在同名 shell 命令，从而在自动推进或手工排障时得到“未安装/不可调用”的错误结论。

## 3. 功能需求

- **R1: 角色与入口分离**
  - `imm-work` 的 machine-readable 状态必须能区分 authority role 与实际恢复入口。
  - 当当前 step 进入执行或 QA 语义时，状态返回不得只给出 `imm-executor` 或
    `imm-qa` 这样的角色名，而应同时提供明确的继续入口，例如 `imm-work continue`
    或等价字段。
  - `stop_condition` 与相关 Codex-facing 文案不得再暗示用户应直接调用一个默认并不存在的 shell 命令。
- **R2: 文档与安装说明收口**
  - README、安装说明和 workflow 文案必须明确：`imm-executor`、`imm-qa` 是 skill / authority role，默认 CLI 单入口仍是 `imm-work`。
  - 安装脚本帮助文本与 README 中的可执行命令清单必须与 `legacy-cli-launcher` 的真实支持集合一致。
- **R3: 保持既有权限边界**
  - 不合并 `imm-work`、`imm-executor`、`imm-qa` 的 authority boundary。
  - 不默认新增 `imm-executor` / `imm-qa` CLI wrapper 作为本次修复的成功条件。
  - 若必须引入兼容 shim 才能维持既有自动推进链路，应停止当前实现并回到 preplan/planner 重新审视 scope。

## 4. 验收标准

- [ ] 当前 step 需要执行或 QA 时，machine-readable 状态同时提供角色信息与实际继续入口，不再让调用方只能从 `next_skill` 猜测命令名。
- [ ] README、安装说明和 workflow 帮助文本不再暗示 `imm-executor` / `imm-qa` 是默认 shell 命令。
- [ ] `imm-work` 仍是计划后的默认 CLI continue entry，且 `imm-executor` / `imm-qa` 仍只代表权限语义。
- [ ] 本次修复不以新增 `imm-executor` / `imm-qa` CLI wrapper 为验收前提。

## 5. 非目标

- 不实现新的 full-plan autowork。
- 不重写历史计划文件。
- 不把 role/skill 名统一重命名为另一套术语。
- 不默认新增兼容 shell 命令来掩盖 contract 歧义。

## 6. 依赖项

- 依赖 `.imm/specs/current-step-driver.spec.md` 中的 current-step continue contract。
- 依赖 `.imm/specs/skill-contract-lint.spec.md` 中对 skill contract 与 workflow guard 的一致性要求。
- 依赖当前 `scripts/legacy-installer.sh`、`scripts/legacy-cli-launcher`、`README.md` 与 `.imm/imm-work.py` 的真实行为作为修复基线。
