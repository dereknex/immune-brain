# Spec: Multi-model advisory dispatch and planner ensemble

## Summary

Immune-Brain must use multiple model capability tiers beyond review lenses while preserving the existing authority separation between Brainstorm, Planner, Executor, QA, Reviewer, and Compounder. The first executable slice introduces a shared read-only advisory dispatch substrate and planner-owned multi-model ensemble synthesis. It also records Pi `Agent` as a supported dispatch host when the current Pi harness exposes that tool surface.

## Problem

The current `model_tier` mechanism is useful but narrow: it applies to advisory review lenses under `imm-code-review` and `imm-ui-review`. Mainline workflow roles such as `imm-brainstorm`, `imm-planner`, `imm-work`, `imm-qa`, and planner research inherit the host model. This leaves planning quality dependent on one model even when a task would benefit from independent fast, mid, and strong model perspectives.

The repository also previously rejected a shared registry or generic dispatcher because there was not enough evidence for platformization. The new requirement changes the evaluation: planner ensemble, review lenses, party advisory, preplan adversarial review, planner research, and work probes all need the same mechanical dispatch concerns. The accepted path is a narrow shared substrate for read-only advisory dispatch only, not a global authority dispatcher.

## Goals

- Support Pi `Agent` as a documented dispatch primitive when available.
- Centralize read-only advisory dispatch mechanics that are repeated across hosts.
- Allow workflow stages to name one or more semantic tiers or concrete model ids.
- Allow `imm-planner` to request multiple model candidates for plan alternatives and risk review.
- Keep the final Spec and Plan owned by `imm-planner`.
- Keep child agents advisory-only with no edits, no plan writes, no workflow-state mutation, and no QA closure.
- Preserve host-owned trigger decisions and result synthesis.

## Non-goals

- No generic dispatcher that can decide scope, write Plans, mutate the State Ledger, or close QA.
- No code-editing child worker in this slice.
- No automatic majority vote or consensus authority over a planner decision.
- No global background queue or cross-session scheduler.
- No mandatory multi-model fan-out for small or single-domain tasks.
- No local-tier rollout in this slice.

## Accepted behavior

### Pi dispatch support

When the current host is Pi and the `Agent` tool is exposed, the dispatch protocol treats Pi as dispatch-capable. The Pi envelope uses the same assembled delegation prompt as other hosts and can pass a resolved non-`inherit` model id. If the `Agent` tool is not exposed, the host records `unavailable_environment` instead of pretending Pi dispatch occurred.

Pi does not rely on a `readonly` tool parameter. Read-only behavior is enforced by `tool_policy: no tools`, advisory-only boundary text, and host synthesis rules. Background Pi children are collected through `get_subagent_result` or completion notifications rather than sleep polling.

### Shared read-only advisory dispatch substrate

The shared substrate may centralize these mechanical concerns:

- model tier resolution from `[subagent_models]`
- delegation packet construction from shared context plus one focus delta
- Cursor, Codex, and Pi envelope generation
- standard fallback reason codes
- telemetry record shape
- normalized advisory child result shape

The shared substrate must not decide whether a host should dispatch. It receives host-owned eligibility and focus inputs and returns deterministic envelopes or normalized summaries. The caller remains responsible for real tool invocation where host tools cannot be unit-tested from repository tests.

### Workflow model selection config

User-facing configuration should be progressive:

1. **Zero config:** every stage inherits the host model and existing review lens behavior stays unchanged.
2. **Preset only:** users pick one workflow preset without naming every stage.
3. **Model slots:** users optionally map `fast`, `mid`, `strong`, and `local` to concrete models through existing `[subagent_models]`.
4. **Advanced overrides:** users only write per-stage lists when a preset is not enough.

Recommended simple form:

```toml
[workflow]
model_preset = "balanced" # off | budget | balanced | quality | ensemble
```

Preset semantics:

- `off`: all workflow stages use `inherit`; review lenses keep current behavior.
- `budget`: use `fast` for advisory expansion and avoid planner ensemble unless explicit.
- `balanced`: use `mid` for mainline stages and `fast/mid/strong` only for high-impact planner ensemble.
- `quality`: prefer `strong` for preplan, high-risk QA, and planner ensemble review.
- `ensemble`: run planner ensemble whenever planning risk gates allow it.

Advanced stage-level selection remains available under `~/.immune-brain/config.toml` and may use semantic tiers or concrete model ids:

```toml
[workflow_models]
brainstorm = ["mid"]
brainstorm_high_ambiguity = ["strong"]
planner = ["mid"]
planner_ensemble = ["fast", "mid", "strong"]
preplan_review = ["strong"]
executor = ["inherit"]
qa = ["mid"]
qa_high_risk = ["strong"]
compounder = ["mid"]
compounder_adr = ["strong"]
```

Resolution rules:

1. Resolve `[workflow].model_preset` to a built-in stage map unless `[workflow_models]` overrides that stage.
2. If an item is `fast`, `mid`, `strong`, `local`, or `inherit`, resolve it through `[subagent_models]` using the existing tier semantics.
3. If an item is any other string, treat it as a concrete host model id and pass it directly when the current host supports `model`.
4. If a resolved value is `inherit`, omit `model` so the child inherits the host model.
5. Single-model stages use the first resolved model. Multi-model stages produce one advisory candidate per resolved entry.
6. When a multi-model stage resolves to fewer than two distinct model identities, the host should either run a single-model fallback or require an explicit force flag before paying ensemble cost.

### Planner ensemble advisory

`imm-planner` may request a bounded multi-model advisory round when a planning task is complex enough to benefit from independent alternatives. The default candidate shape is derived from `workflow_models.planner_ensemble`:

- first entry: divergent options and simpler alternatives
- second entry: executable slice and repo-grounded plan draft
- third entry: adversarial risk review and verification strength review

The planner merges candidate output into one `planner_ensemble_packet`. The final Spec and Plan remain planner-owned. Agreement becomes evidence, disagreement becomes decision criteria, and strong-model blockers become explicit risk or verification requirements.

### Mainline model tier policy

Mainline role guidance should distinguish model use by decision risk:

- Brainstorm: use `workflow_models.brainstorm` by default and `brainstorm_high_ambiguity` when scope ambiguity is expensive.
- Planner: use `workflow_models.planner` by default and `planner_ensemble` for high-impact or multi-domain Plans.
- Executor: use `workflow_models.executor`; default to `inherit` to prevent churn.
- QA: use `workflow_models.qa` by default and `qa_high_risk` for high-risk closure or replan decisions.
- Review: continue current lens tiers while allowing security, API contract, and data integrity to opt into strong.
- Compounder: use `workflow_models.compounder` by default and `compounder_adr` for ADR-level trade-offs.

## Compatibility

Existing host-bound review behavior must continue to work. Existing activation plans, `model_tiers`, `lens_model_tiers`, fallback reasons, and packaged docs remain backward-compatible. If a host does not support `model`, the envelope omits it and inherits the host model.

## Verification expectations

- Protocol and config docs mention Cursor `Task`, Codex `spawn_agent`, and Pi `Agent` model dispatch.
- Tests guard the Pi `Agent` contract.
- The shared substrate has focused unit tests for preset expansion, tier resolution, envelope generation, fallback accounting, and no authority fields.
- Planner ensemble contract tests prove child candidates are advisory-only and final Plan writing remains planner-owned.
- Dist docs stay synchronized or explicitly adapted.