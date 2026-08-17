origin: user request and .imm/specs/legacy-installer-copy-default.spec.md
date: 2026-05-10
summary: 把 legacy-installer 默认安装方式切换为 managed copy，并修复当前 copy 模式仍依赖源仓库运行时的问题。

# Task
- Summary: 收敛本地安装契约，默认安装为 copy，避免 symlink 带来的路径误判，并让 copy-installed CLI 真正脱离源仓库工作区。
- Origin: 用户要求“改为 copy 的安装方式，同时修复已经存在的问题”；后续 `imm-code-review` 给出 same-boundary `append_to_plan` follow-up，指出 managed copy 身份仍绑死到原始 checkout 绝对路径。
- Research: 已检查 `scripts/legacy-installer.sh`、`scripts/legacy-cli-launcher`、`README.md` 与 `tests/test_install_local.py`。结论：仓库已支持 `--copy`，但默认仍是 symlink；更关键的是 copy-installed CLI wrapper 仍硬编码回 `${REPO_ROOT}/.imm/${COMMAND_NAME}.py`，所以当前 copy 只是复制入口壳子，不是独立安装。后续 review 进一步确认：当前 marker 校验仍要求 `source=${REPO_ROOT}` 精确匹配，因此换一个 checkout 后执行 `--check` / `--uninstall` 会把已有安装误判为不受管安装。
- Decisions:
  1. 默认安装模式改为 managed copy，并移除 symlink 安装入口，避免双契约并存。
  2. copy 模式必须安装 CLI 所需的最小运行时载体，不能继续反向依赖源仓库 `.imm/*.py`。
  3. 帮助文案、README 与测试断言统一以 copy 作为唯一成功路径。
  4. managed copy 的识别规则必须对后续 checkout 保持 repo-agnostic，避免把全局安装绑定到单一 checkout 绝对路径。
- Assumptions:
  - 复制 CLI 最小运行时载体的范围可以限定在 `imm-plan`、`imm-work`、`imm-review`、`imm-heal`、`imm-dehydrate`、`imm-finish` 所需文件，不必引入完整仓库镜像。
  - 当前用户关心的是本地安装语义与可运行性，不要求本轮设计新的外部分发形态。

## Steps

### Step 1
- Step ID: U1
- Result: 新增 `.imm/specs/legacy-installer-copy-default.spec.md`。
- Verification: `.imm/specs/legacy-installer-copy-default.spec.md` 存在，且包含目标、需求、验收标准、依赖项、非目标。
- Depends on: none

### Step 2
- Step ID: U2
- Result: skills 默认安装模式为 managed copy。
- Verification: 运行 `python3 -m unittest tests.test_install_local.InstallLocalTests.test_install_local_creates_expected_agents_skill_copies` 通过，且默认 skill 安装断言不再依赖 symlink。
- Test scenarios: Covers U2.C1
- Depends on: 1

### Step 3
- Step ID: U3
- Result: CLI wrappers 默认安装模式为 managed copy。
- Verification: 运行 `python3 -m unittest tests.test_install_local.InstallLocalTests.test_install_local_installs_callable_cli_wrappers` 通过，且默认 CLI 安装断言不再依赖 symlink。
- Test scenarios: Covers U3.C1
- Depends on: 2

### Step 4
- Step ID: U4
- Result: `scripts/legacy-installer.sh` 不再提供 symlink 安装入口。
- Verification: 运行 `zsh scripts/legacy-installer.sh --help` 不再出现 symlink 安装选项，且相关测试断言默认/唯一安装模式为 copy。
- Test scenarios: Covers U4.C1
- Depends on: 2, 3

### Step 5
- Step ID: U5
- Result: copy-installed CLI 不再依赖源仓库 `.imm/*.py` 路径。
- Verification: 运行 `python3 -m unittest tests.test_install_local.InstallLocalTests.test_default_copy_install_survives_source_launcher_removal tests.test_install_local.InstallLocalTests.test_copy_mode_installs_checkable_and_uninstallable_copies` 通过。
- Test scenarios: Covers U5.C1
- Depends on: 2, 3, 4

### Step 6
- Step ID: U6
- Result: README 与 `scripts/legacy-installer.sh --help` 改为以 copy 为默认叙述。
- Verification: `rg -n "默认安装|symlink|copy|--copy" README.md scripts/legacy-installer.sh tests/test_install_local.py` 输出与新契约一致，且 `python3 -m unittest tests.test_install_local.InstallLocalTests.test_install_local_keeps_executor_and_qa_as_role_skills` 通过。
- Test scenarios: Covers U6.C1
- Depends on: 2, 3, 4, 5

### Step 7
- Step ID: U7
- Result: managed copy 身份不再依赖原始 checkout 绝对路径。
- Verification: 运行 `python3 -m unittest tests.test_install_local.InstallLocalTests.test_copy_install_can_be_checked_from_second_checkout tests.test_install_local.InstallLocalTests.test_copy_install_can_be_uninstalled_from_second_checkout` 通过。
- Test scenarios: Covers U7.C1
- Depends on: 2, 3, 5

## Notes
- 每个 step 只承诺一个可验证结果；若 copy 运行时载体拆分超出当前边界，应返回 replan，而不是顺手引入完整打包系统。
- 若显式 symlink 兼容入口会和现有用户环境冲突，需保留清晰错误提示，避免覆盖非受管安装。
- 本次 follow-up 来源于 same-boundary `origin_review`，采用 `append_to_plan` 追加 repair step，而不是新开 follow-up slice。
