# PR fix remote context contract

**领域**: Agent workflow / GitHub PR repair contract
**描述**: 当 PR repair skill 需要在用户未显式提供 PR 目标时继续推进，默认可以
先用当前 branch 做 lookup，但 branch 只是一把查找钥匙，真正的 source of
truth 仍然必须是远端 GitHub PR metadata。

**reusability**: high
**next_reuse_scenarios**: [`repair skill 负责 merge conflict / review feedback / CI blocker, 用户通常已经位于 PR head branch, 希望系统默认找到 PR 而不是先手工补编号`, `workflow 想给用户“当前 branch 自动找 PR”的便捷入口, 但不能放宽为本地 branch 名直接等于已确认 PR`, `需要给 branch-based PR discovery 增加 focused regression, 防止后续文案回退成“找不到编号就停”或“当前 branch 就是 PR”两种极端`]

## Reusable premise

`imm-pr-fix` repair work should treat the GitHub PR as the source of truth, not
the local branch or a user-provided summary. A PR repair skill needs to read
remote PR metadata, check runs, review threads, and failure logs before editing,
then push and close out handled feedback after validation.

## When to apply

- A skill or workflow claims responsibility for PR blocker repair.
- The blocker may be caused by merge conflicts, review feedback, or CI/check
  failures.
- The agent has access to GitHub through `gh`, a connector, or an authenticated
  browser.
- The user may omit a PR URL or number because they are already on the PR head
  branch.

## Pattern

1. **Prefer explicit PR identifiers when present**: accept PR URL, PR number, or
   branch first.
2. **Use current branch only as a lookup key**: if the user omitted all explicit
   identifiers, read the current branch and query GitHub for the matching PR.
3. **Require remote confirmation before repair**: branch-based discovery is
   incomplete until remote GitHub metadata confirms the PR target.
4. **Stop on discovery ambiguity**: detached HEAD, zero-match, multi-match, or
   unavailable GitHub metadata must stop and request an explicit PR target.
5. **Read remote PR state before editing**: base/head refs, mergeability, review
   threads, checks, and useful failing log snippets.
6. **Map blockers into conflict, feedback, and CI groups**.
7. **Make only blocker-scoped changes and run targeted then broader validation**.
8. **Push the PR branch and reply to or resolve handled feedback**.
9. **Report sources read, validation evidence, push result, handled feedback, and
   remaining risks**.

## Reusable preconditions

- The environment can read the current git branch.
- GitHub lookup is available through `gh`, a connector, or an authenticated
  browser.
- Repo policy does not allow silent tie-breaking across multiple matching PRs.

## Evidence

- `skills/imm-pr-fix/SKILL.md` now requires PR target identification, remote PR
  context collection, check-log reading, validated push, and feedback closeout.
- `skills/imm-pr-fix/SKILL.md` now also defaults omitted PR target discovery to
  the current branch, requires remote GitHub metadata before repair starts, and
  stops on detached HEAD / zero-match / multi-match / unavailable-metadata
  discovery states.
- `tests/test_skill_contracts.py` now contains a focused regression that fails
  if `imm-pr-fix` drops current-branch lookup, remote confirmation, or ambiguity
  stop conditions.
- `docs/plans/2026-05-07-007-feat-pr-fix-remote-context-plan.md` and
  `docs/plans/2026-05-08-008-fix-pr-fix-current-branch-discovery-plan.md`
  together validate the base remote-context contract and its current-branch
  discovery extension.

## Constraints and advice

- Do not let “default to current branch” degrade into “assume the current branch
  is the PR.”
- Do not auto-pick a latest or arbitrary PR when branch-based lookup is not
  unique.
- Keep branch-based convenience and remote-source-of-truth semantics in the same
  contract and the same focused regression, otherwise one side will drift.
- Treat missing GitHub metadata as a hard stop for repair targeting, not as a
  reason to fall back to local guesswork.

---
*沉淀日期: 2026-05-08 | 来源: imm-pr-fix current-branch discovery plan completion*
