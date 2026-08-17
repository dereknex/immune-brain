# Spec: Activation Plan CLI Wrapper Contract

## Summary

Subagent activation planning must be invoked through the installed
`imm-activation-plan` CLI wrapper in normal project contexts. Host Skills must
not treat a missing project-local `.imm/activation_plan.py` file as evidence
that catalog-driven activation planning is unavailable.

## Goal

Make the activation planning contract CLI-first so `imm-code-review` can build
an Activation Plan from managed installs and initialized projects that do not
carry repo-local engine scripts.

## Scope

### In scope

- `skills/imm-code-review/SKILL.md` Phase 2 trigger matching guidance.
- `docs/reference/automatic-subagent-activation-policy.md` catalog metadata
  validation guidance.
- `docs/reference/subagent-trigger-catalog.yaml` validation command comment.
- `scripts/legacy-cli-launcher` support for the `imm-activation-plan` command name.
- Contract and installer tests that protect the wrapper contract.

### Out of scope

- Changing Activation Plan candidate matching semantics.
- Changing dispatch, retry, synthesis, or model-tier behavior.
- Adding a shared registry, scheduler, or background dispatcher.
- Installing engine scripts into project-local `.imm/` directories.

## Requirements

R1. `imm-code-review` must name `imm-activation-plan` as the normal activation
planning entrypoint.

R2. `imm-code-review` must explicitly say that a project-local missing
`.imm/activation_plan.py` is not a reason to skip catalog planning.

R3. Reference validation guidance must prefer
`imm-activation-plan --validate-refs`, while allowing
`python3 .imm/activation_plan.py --validate-refs` only as a repo-local
development fallback.

R4. `scripts/legacy-cli-launcher`, when invoked as `imm-activation-plan`, must call
repo-local `.imm/activation_plan.py`.

R5. Tests must prove the Skill contract and launcher behavior.

## Acceptance checklist

- [ ] `skills/imm-code-review/SKILL.md` uses `imm-activation-plan` as the
      primary activation planning entrypoint.
- [ ] `docs/reference/subagent-trigger-catalog.yaml` says
      `imm-activation-plan --validate-refs`.
- [ ] `scripts/legacy-cli-launcher` supports `imm-activation-plan`.
- [ ] `python3 -m unittest tests.test_skill_contracts tests.test_install_local tests.test_activation_plan`
      exits zero.
