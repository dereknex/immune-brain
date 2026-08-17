# Iteration Plan: Subagent Activation Hardening

## Task

- Summary: Fix missed Activation Plan path triggers, align Codex dispatch documentation with current model support, and make cataloged reviewer Delegation Packet contracts consistent.
- Origin: origin_review from `imm-brainstorm` review of current Skills and subagents implementation.
- Spec: `.imm/specs/subagent-activation-hardening.spec.md`

## Research

- `.imm/activation_plan.py:108-119` matches catalog path globs with Python `fnmatch`; `auth/session.py` returns `trigger_not_hit` against the existing `**/auth/**` rule.
- `docs/reference/subagent-trigger-catalog.yaml:41-134` contains `**/<dir>/**` patterns for auth, API, jobs, workers, and similar root-or-nested risk directories.
- `docs/reference/subagent-dispatch-protocol.md:112-116` says Codex `spawn_agent` has no `model` parameter and model tier resolution is Cursor-only, which no longer matches the current Codex tool schema.
- `.imm/specs/subagent-runtime-mvp.spec.md:49-52` and `:130-131` still describe only the first reviewer pair, while current catalog and `imm-code-review` include `data-integrity-reviewer` and `reliability-reviewer`.
- `skills/data-integrity-reviewer/SKILL.md:19-23` and `skills/reliability-reviewer/SKILL.md:19-23` lack `tool_policy`, `fallback_reasons`, and `output_expectation` in their required delegated inputs.
- `tests/test_activation_plan.py` covers nested examples, but not root-level directory trigger paths.

## Decisions

- Use `new_slice`; there is no active validated plan and the previous work is an advisory review, not an append-eligible current plan.
- Keep the change host-bound to `imm-code-review`; do not introduce a shared registry, scheduler, or cross-host dispatcher.
- Treat path matching as the highest-priority fix because it can silently skip dedicated reviewer coverage.
- Keep runtime documentation truthful to current Codex capability without changing advisory-only authority or readonly boundaries.
- Complete the reviewer contract only for already-cataloged child reviewers.
- Append review repair U4 to close the installed wrapper acceptance gap found by `imm-code-review`; preserve U1-U3 closure history.

## Assumptions

- The catalog intends `**/auth/**`, `**/api/**`, `**/jobs/**`, and similar patterns to match both root-level and nested directories.
- Codex `spawn_agent` supports a `model` argument in the current runtime, but still does not enforce readonly through a tool flag.
- Existing `imm-code-review` synthesis remains the parent authority for child findings.

---

### Step 1

- Step ID: U1
- Result: Activation Plan path matching covers cataloged reviewer risk paths
- Verification: `python3 -m unittest tests.test_activation_plan` exits zero and includes root-level trigger cases for security, API contract, data integrity, and reliability paths
- Depends on: None
- Execution note: test-first

### Step 2

- Step ID: U2
- Result: Subagent runtime documentation matches current dispatch truth
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero with assertions covering Codex `spawn_agent` model support and four cataloged child reviewers in the runtime MVP truth
- Depends on: 1

### Step 3

- Step ID: U3
- Result: Cataloged reviewer Skills expose a consistent Delegation Packet input contract
- Verification: `python3 -m unittest tests.test_skill_contracts` exits zero with assertions that `data-integrity-reviewer` and `reliability-reviewer` require `tool_policy`, `fallback_reasons`, and `output_expectation`
- Depends on: 2

### Step 4

- Step ID: U4
- Result: Installed Activation Plan wrapper uses the hardened matcher
- Verification: `zsh scripts/legacy-installer.sh --check` exits zero; `imm-activation-plan --changed-path auth/session.py` returns `security-reviewer`; `imm-activation-plan --changed-path jobs/send.py` returns `reliability-reviewer`
- Depends on: 3
