# Spec: Global Subagent Activation Policy

**Task ID**: IMM-SUBAGENT-ACTIVATION-003
**Owner**: Planner
**Status**: Proposed
**Related**: docs/reference/automatic-subagent-activation-policy.md, docs/reference/subagent-dispatch-protocol.md, docs/reference/immune-brain-config.md, docs/reference/subagent-trigger-catalog.yaml, docs/reference/workflow-and-subagents.md

## Background

Immune-Brain currently has several subagent activation paths:

- `imm-code-review` and `imm-ui-review` use deterministic catalog-driven
  `activation_plan` output.
- `imm-party` uses explicit advisory role delegation.
- `imm-brainstorm` and `imm-planner` can use optional readonly research
  dispatch.
- `imm-work` can consume planner-defined `parallel_probes`.
- `imm-arch-explorer` can run Domain Mapper surveys.
- Project-specific advisory reviewers such as `prompt-contract-reviewer`,
  `ai-eval-planner`, `docs-verifier`, `release-readiness-checker`, and
  `debug-investigator` use trigger-only local skill surfaces.

The current local config only covers subagent model tier resolution through
`[subagent_models]`. It does not provide one global activation policy that
lets a user choose whether eligible subagents activate automatically, require
explicit request, or stay disabled.

## Goal

Define and implement one global activation policy that all current and future
subagent-capable hosts must follow.

The policy must support:

- Global default mode.
- Host-level overrides.
- Lens or subagent-level overrides.
- Explicit fallback reasons when config prevents dispatch.
- Consistent contract requirements for future subagents.

## Requirements

### R1. Activation modes

The global policy must support exactly these modes:

- `auto`: dispatch is allowed when the host trigger, boundary, environment, and
  cost gates pass.
- `explicit_only`: dispatch is allowed only when the user explicitly requests
  subagents, parallel research, specialist review, party advisory, or equivalent
  delegated review.
- `disabled`: dispatch is never allowed for that configured scope.

User-requested solo remains highest priority and maps to `user_requested`.

### R2. Config shape

`~/.immune-brain/config.toml` must document an optional
`[subagent_activation]` section:

```toml
[subagent_activation]
default = "auto"

[subagent_activation.hosts]
imm-code-review = "auto"
imm-ui-review = "auto"
imm-party = "explicit_only"
imm-brainstorm = "explicit_only"
imm-planner = "explicit_only"
imm-work = "auto"
imm-arch-explorer = "auto"

[subagent_activation.lenses]
security = "auto"
api_contract = "auto"
data_integrity = "auto"
reliability = "auto"
ui_a11y = "auto"
ui_responsive = "auto"
ux_heuristic = "auto"
ui_visual = "auto"

[subagent_activation.subagents]
prompt-contract-reviewer = "explicit_only"
ai-eval-planner = "explicit_only"
docs-verifier = "explicit_only"
release-readiness-checker = "explicit_only"
debug-investigator = "explicit_only"
```

Precedence is: explicit user solo, subagent or lens override, host override,
global default, then repo default.

### R3. Covered activation surfaces

The policy must cover these existing surfaces:

- Catalog review hosts: `imm-code-review`, `imm-ui-review`.
- Advisory party host: `imm-party`.
- Research dispatch hosts: `imm-brainstorm`, `imm-planner`.
- Work probe host: `imm-work` `parallel_probes`.
- Architecture survey host: `imm-arch-explorer` Domain Mapper.
- Project-specific trigger-only reviewers:
  `prompt-contract-reviewer`, `ai-eval-planner`, `docs-verifier`,
  `release-readiness-checker`, `debug-investigator`.

### R4. Fallback reasons

When config prevents dispatch, hosts must use explicit reason codes:

- `explicit_required`: config requires explicit subagent request and none was
  present.
- `config_disabled`: config disables dispatch for the matched host, lens, or
  subagent.

These are in addition to existing fallback reasons such as `trigger_not_hit`,
`unclear_boundary`, `unavailable_environment`, `cost_scope_mismatch`,
`dispatch_failed`, `child_timeout`, and `user_requested`.

### R5. Future subagent contract

Every future subagent-capable host, lens, or local specialist must declare:

- `host`
- `mode`
- `activation_default`
- `trigger_surface`
- `authority_class`
- `fallback_reason`
- `model_tier` when model resolution applies
- `tool_policy`
- `write_boundary`

New subagents must not bypass the global activation policy by inventing an
ad hoc dispatch rule.

### R6. Authority boundary preservation

The policy changes activation eligibility only. It must not grant planning,
execution, QA, workflow-state, or code-edit authority to advisory subagents.

## Non-goals

- No shared runtime registry.
- No generic dispatcher.
- No background queue.
- No cross-session scheduling.
- No agent-to-agent communication.
- No long-term subagent memory.
- No LLM-only routing.
- No change to `imm-work` active-step authority or `imm-qa` closure authority.

## Acceptance Criteria

- `docs/reference/immune-brain-config.md` documents `[subagent_activation]`.
- `docs/reference/automatic-subagent-activation-policy.md` and
  `docs/reference/subagent-dispatch-protocol.md` define mode semantics,
  precedence, and fallback meanings.
- Runtime helpers expose a pure activation-policy resolver that can be reused by
  catalog review hosts, work probes, and Domain Mapper.
- `activation_plan` handles configured modes for `imm-code-review` and
  `imm-ui-review` without reading user config directly.
- `imm-work` probe and `imm-arch-explorer` mapper helpers accept policy-derived
  fallback reasons.
- Skill contracts for `imm-party`, `imm-brainstorm`, `imm-planner`,
  `imm-work`, `imm-arch-explorer`, `imm-code-review`, and `imm-ui-review`
  mention the global policy.
- Project-specific reviewer docs state that trigger-only participation is
  governed by the global policy.
- Tests cover `auto`, `explicit_only`, `disabled`, override precedence, new
  fallback reasons, and future-subagent contract wording.
