---
title: Rejected Rigid Patch Generation in Reviewer Subagents
reusability: high
key_files:
  - skills/imm-code-review/SKILL.md
  - .imm/imm_core/code_review_subagents.py
rejected: true
rejection_reason: Forcing restricted (no tools, advisory-only) sub-reviewers to provide exact code patches causes context attachment gaps and collision risks. A test-driven verification approach allows the Executor to resolve findings with global context while constrained to the specific criteria.
---

# Rejected Pattern: Rigid Patch Generation in Reviewer Subagents

**领域**: Agent workflow / Code Review / Subagent Contract
**描述**: 曾经考虑过强制子审查员 (sub-reviewers) 在 findings 中输出 `suggested_patch`（具体的代码修改补丁），以减少 Review 轮次。这一方案最终被**否决**。

## 为什么被拒绝？

1. **上下文感知的物理限制 (Context Attachment Gap)**：
   子审查员在分发时只能看到受到限制的 `focus_delta`（上下文片段）和摘要信息。由于缺乏访问外部文件（如类型定义、远程依赖）的权限（`no tools`），强行要求它们给出全局准确的代码补丁往往会产出“管中窥豹”的错误代码，Executor 盲目应用会导致编译失败。
2. **多视角冲突难以自动合成 (Collision Risk)**：
   来自不同视角的审查员（如 Security、Performance）如果对同一行代码提供不同的补丁，仲裁脚本难以进行代码级别的合并。
3. **削弱 Executor 角色 (Degradation of Role)**：
   这会将 Executor 降级为单纯的“打字机”。Executor 应当利用其具备全量代码库访问和测试运行权限的优势，根据审查员的问题自行推导和应用修复。

## 替代方案 (Adopted Solution)

- **Test-Driven Verification Criteria**: 要求审查员提供明确的 `verification_criteria`（例如失败的测试用例、预期的输入/输出断言），而不是直接的代码补丁。
- **Executor 职责收敛**: Executor 在 Rework 期间保有修改全局代码的权力，但其唯一目标是使代码通过 Reviewer 提出的 `verification_criteria`，禁止进行其他无关的重构。
- **本地前置校验 (Pre-QA Hook)**: 在 Executor 将任务流转至 Review 阶段之前，必须确保本地的基线测试通过。

---
*记录日期: 2026-05-19 | 来源: Reviewer Feedback Optimization 方案讨论*
