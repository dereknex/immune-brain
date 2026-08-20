# Spec: PR fix target discovery and remote context contract

**任务 ID**: IMM-PR-FIX-001
**负责人**: Planner
**状态**: Proposed

## 1. 目标

让 `imm-pr-fix` 明确覆盖完整的 GitHub PR 修复闭环：当用户未显式提供
PR URL、PR 编号或 branch 时，先用当前 git branch 反查唯一 PR，再读取
PR 页面、远端 check 结果和 review feedback，基于这些远端事实做最小修复，
验证后推送代码，并在 PR 上回复或解决已处理的反馈。

## 2. 背景

现有 `imm-pr-fix` 已说明可处理 merge conflict、review feedback 和 CI
failure，也已经要求先读取远端 PR / checks / feedback；但它仍把“没有
PR URL、编号或 branch”视为立即停止条件。实际使用时，用户通常已经位于
目标 PR 的 head branch，希望 skill 默认从当前 branch 反查 PR，而不是先
手工补 PR 编号。

## 3. 功能需求

- **远端上下文读取**：
  - 必须从 PR URL、PR number 或 branch 定位目标 PR。
  - 当用户未提供 PR URL、PR number 或 branch 时，必须先读取当前 git
    branch，并把它作为默认 lookup key 去 GitHub 反查目标 PR。
  - 当前 branch 只可作为 lookup key，不能在未完成远端匹配前被视为已确认
    的 PR target。
  - 若当前 branch 不可得、处于 detached HEAD、匹配不到 PR、或匹配出多个
    PR，必须停止并要求用户提供显式目标。
  - 必须读取 PR 页面元数据、base/head 分支、merge 状态、review threads、
    unresolved comments、status/check runs 和失败日志摘要。
  - 如果没有可定位 PR，必须停止并要求用户提供 PR URL、number 或 branch。
- **阻塞项归并**：
  - 必须把阻塞项归并为 conflict、feedback、CI 三类。
  - 必须优先处理 correctness、安全/稳定性、测试失败，再处理可读性反馈。
  - 模糊 feedback 必须询问或标记未处理，不能猜测实现。
- **修复与反馈闭环**：
  - 只允许修改与明确 blocker 直接相关的文件。
  - 修复后必须运行针对性验证，再运行仓库要求的相关检查。
  - 验证通过后必须 push 当前 PR 分支。
  - 必须在 PR 上回复或解决已处理的 review feedback，并说明未处理项。

## 4. 验收标准

- [ ] `skills/imm-pr-fix/SKILL.md` 要求读取 GitHub PR 页面、远端 checks、
      review threads 和失败日志摘要。
- [ ] `skills/imm-pr-fix/SKILL.md` 明确未提供目标时默认通过当前 branch 反查 PR，
      但不会把当前 branch 直接当作已确认目标。
- [ ] `skills/imm-pr-fix/SKILL.md` 明确 detached HEAD、零匹配、多匹配等情况
      必须停止并要求显式目标。
- [ ] `skills/imm-pr-fix/SKILL.md` 明确修复后要 push，并回复或解决已处理 feedback。
- [ ] `skills/imm-pr-fix/SKILL.md` 的输出报告包含远端来源、已回复 feedback、
      push 结果、验证命令和剩余风险。

## 5. 非目标

- 不新增 GitHub 自动化脚本。
- 不改变其它 `imm-*` skill 的权限边界。
- 不做“当前 branch 自动选最新 PR”之类的非唯一推断。
- 不规定唯一的 GitHub 工具；可以使用 `gh`、GitHub connector 或浏览器，
  但输出必须说明来源和验证证据。
