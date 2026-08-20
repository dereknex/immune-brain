> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.

# Spec: README installed skills sync

**任务 ID**: IMM-README-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

修正 `README.md` 中“当前会安装”段落与本地安装器真实行为不一致的问题，避免用户误判
哪些 skills 会被安装到 `plugin skill registry/`。

首版只处理 README 安装说明与 `zsh scripts/legacy-installer.sh --list` 的结果对齐；不修改
安装脚本的收集逻辑，不新增安装策略配置，也不扩散到无关文档清理。

## 2. 问题背景

当前仓库的安装脚本会动态扫描 `skills/*/SKILL.md` 来收集要安装的 skills，而 README 仍保留
一段静态清单，只列出了较早的一组 skills。

这造成两个直接问题：

- 用户阅读 README 时，会误以为 `ai-eval-planner`、`prompt-contract-reviewer`、`imm-init`
  等 skills 不会被安装。
- 这次刚完成的 `ai-eval-planner` runtime slice 会在当前仓库内可用，但在用户理解的安装路径上
  看起来仍像是“未暴露”。

本任务的目标不是重新设计安装器，而是让 README 不再提供与真实安装行为冲突的静态信息。

## 3. 功能需求

### R1. README installation guidance must match runtime reality

- README 中关于“当前会安装”的说明，必须与 `zsh scripts/legacy-installer.sh --list` 的真实行为保持一致。
- 文案可以采用以下两种收敛方式之一：
  - 同步为完整且当前准确的安装清单；或
  - 删除静态枚举，明确以 `mise run list-skills` / `zsh scripts/legacy-installer.sh --list` 输出为准。
- 首版优先选择更不易再次漂移的表述。

### R2. Scope stays documentation-only

- 本任务只允许修改 README 安装说明相关段落。
- 不修改 `scripts/legacy-installer.sh`、仓库根目录 `mise.toml`、skill 目录结构或安装流程。
- 不顺手扩写 skill 能力介绍、workflow 教程或其他与本问题无关的 README 段落。

### R3. Verification path

- 必须存在一个可复现的对齐检查：
  - 读取 README 安装说明对应段落；以及
  - 运行 `zsh scripts/legacy-installer.sh --list`。
- 验证目标是：README 不再与脚本输出冲突，也不再暗示过期的静态安装集合。

## 4. 验收标准

- [ ] README 安装说明不再与 `legacy-installer.sh` 的动态 skill 收集行为冲突。
- [ ] `ai-eval-planner` 等当前可安装 skill 不会再被 README 静态清单遗漏或误导性排除。
- [ ] 变更范围仅限 README 安装说明相关段落。
- [ ] 存在直接的人工或命令式验证路径，证明 README 与 `--list` 输出已经对齐。

## 5. 非目标

- 不修改安装脚本的动态发现逻辑。
- 不增加新的 CLI 包装器或安装模式。
- 不把 README 全量改写成自动生成文档。
- 不处理 `.imm/memory/current_iteration.json` 的提交策略或其他运行态问题。

## 6. 依赖项

- 依赖 [README.md](README.md) 当前安装说明段落作为修复目标。
- 依赖 `scripts/legacy-installer.sh`
  中基于 `skills/*/SKILL.md` 的动态收集逻辑作为真实行为来源。

