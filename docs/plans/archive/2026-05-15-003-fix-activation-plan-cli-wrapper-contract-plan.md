# Iteration Plan: Activation Plan CLI Wrapper Contract

## Task

- Summary: Make Activation Plan invocation CLI-first so subagent catalog planning does not fall back to solo when a project lacks `.imm/activation_plan.py`.
- Origin: Direct user request after `imm-brainstorm`: "`activation_plan.py` needs to use CLI wrapping" because review output reported "subagents not dispatched" when `.imm/activation_plan.py` was absent.
- Spec: `.imm/specs/activation-plan-cli-wrapper-contract.spec.md`

## Research

- `scripts/legacy-installer.sh` already installs `imm-activation-plan` as a managed CLI wrapper and copies `.imm/activation_plan.py` into the managed runtime.
- `skills/imm-code-review/SKILL.md` still named `.imm/activation_plan.py` as the Phase 2 activation planning path, which can mislead agents in initialized projects that intentionally lack repo-local engine scripts.
- `docs/reference/automatic-subagent-activation-policy.md` and `docs/reference/subagent-trigger-catalog.yaml` still exposed repo-local validation commands before the portable wrapper.
- `scripts/legacy-cli-launcher` did not handle the `imm-activation-plan` command name, leaving the launcher and installed command list out of sync.

## Decisions

- Use `new_slice`; this is a new runtime contract repair, not an append to an active current plan.
- Keep the scope to invocation contract and tests; do not alter Activation Plan matching semantics.
- Make `imm-activation-plan` the normal runtime path and keep `python3 .imm/activation_plan.py` only as a repo-local development fallback.
- Do not add subagent dispatch orchestration; this Step only protects the deterministic Activation Plan entrypoint.

## Assumptions

- Managed installs remain the supported way for other projects to access Immune-Brain engine scripts.
- Existing `tests.test_activation_plan` coverage is sufficient for candidate matching semantics.
- The user-facing failure is caused by guidance/launcher contract drift, not by trigger catalog content.

---

### Step 1

- Step ID: U1
- Result: Activation Plan catalog planning uses the `imm-activation-plan` CLI wrapper contract
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_install_local tests.test_activation_plan` exits zero
- Depends on: None
- Execution note: test-first
- failure_behavior: If the wrapper path fails, `imm-code-review` may incorrectly report solo fallback even when catalog triggers match.
- security_considerations: None; this changes local invocation guidance and wrapper coverage only.

## Test scenarios

- `imm-code-review` contract names `imm-activation-plan` and rejects missing project-local `.imm/activation_plan.py` as a skip reason.
- Reference validation guidance points users to `imm-activation-plan --validate-refs`.
- `legacy-cli-launcher` invoked as `imm-activation-plan` emits a valid Activation Plan for `app/auth/session.py`.
