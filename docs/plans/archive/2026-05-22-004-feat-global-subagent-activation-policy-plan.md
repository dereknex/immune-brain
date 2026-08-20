---
title: "feat: add global subagent activation policy"
type: feat
status: proposed
date: 2026-05-22
origin: imm-brainstorm analysis of global subagent activation configuration
---

# Iteration Plan

## Task
- Summary: Add one global subagent activation policy that covers current review, research, probe, party, mapper, and project-specific subagent surfaces.
- Origin: User clarified that the desired control is a global override and asked to include all current subagent usage so future subagents follow the same policy.
- Spec: docs/specs/archive/global-subagent-activation-policy.spec.md
- Brainstorm manifest: BR-REQ-1, BR-REQ-2, BR-REQ-3, BR-DEC-1, BR-DEC-2, BR-DEC-3, BR-OUT-1, BR-OUT-2
- Research: CONTEXT.md defines Activation Plan, Delegation Packet, Domain Mapper, and State Ledger as the relevant terms. Current runtime surfaces include `.imm/imm_core/activation_plan.py`, `.imm/imm_core/code_review_subagents.py`, `.imm/imm_core/work_probes.py`, and `.imm/imm_core/domain_mapper_dispatch.py`. Current docs define catalog review hosts, `imm-party` explicit delegation, brainstorm and planner research dispatch, work `parallel_probes`, architecture Domain Mapper, and project-specific trigger-only reviewers. `docs/solutions/rejected-shared-registry-generic-dispatcher.md` rejects shared registry or generic dispatcher work until real multi-host drift justifies platformization.
- Decisions:
    - D1: Use a global activation policy with `auto`, `explicit_only`, and `disabled` modes.
    - D2: Apply precedence in this order: user solo request, lens or subagent override, host override, global default, repo default.
    - D3: Keep the policy host-bound and reusable instead of creating a shared dispatcher.
    - D4: Add explicit fallback reasons `explicit_required` and `config_disabled`.
    - D5: Treat project-specific reviewers as governed trigger-only participants even before they are wired into the catalog.
- Assumptions:
    - `~/.immune-brain/config.toml` remains machine-local and optional.
    - Hosts receive resolved activation policy inputs; pure planners do not read user config directly.
    - Existing model tier configuration remains separate from activation eligibility.
- Scope Mode: Three-step feature slice
- Engineering Closure Check:
  - architecture_surface: `.imm/imm_core/activation_plan.py`, `.imm/imm_core/work_probes.py`, `.imm/imm_core/domain_mapper_dispatch.py`, subagent reference docs, skill contract docs, tests
  - dependencies_known: yes; Python standard library is sufficient
  - verification_path: focused unittest coverage plus `imm-plan` validation
  - blockers: none
  - replan_condition: if implementation requires a true shared dispatcher or host runtime tool changes

## Brainstorm Manifest
| ID | Item |
|----|------|
| BR-REQ-1 | Global config covers all existing subagent activation surfaces |
| BR-REQ-2 | Future subagents must follow the same activation policy |
| BR-REQ-3 | Config can choose automatic activation, explicit-only activation, or disabled activation |
| BR-DEC-1 | Use global default plus host override plus lens or subagent override |
| BR-DEC-2 | Keep dispatch host-bound and avoid a shared dispatcher |
| BR-DEC-3 | Add `explicit_required` and `config_disabled` fallback reasons |
| BR-OUT-1 | Do not add background queues or cross-session scheduling |
| BR-OUT-2 | Do not change advisory-only or authority boundaries |

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-1 | covered_by_step | U3 | The final contract coverage accounts for every current surface after policy and runtime support land |
| BR-REQ-2 | covered_by_step | U3 | Contract tests make future subagent wording mandatory |
| BR-REQ-3 | covered_by_step | U2 | The runtime helper coverage implements the three allowed modes after policy documentation lands |
| BR-DEC-1 | captured_as_decision | D2 | Override precedence is fixed before runtime work |
| BR-DEC-2 | captured_as_decision | D3 | The design extends host-bound helpers only |
| BR-DEC-3 | covered_by_step | U2 | Runtime output proves the new fallback reasons after documentation defines them |
| BR-OUT-1 | out_of_scope | Non-goals | The spec excludes background queues and cross-session scheduling |
| BR-OUT-2 | captured_as_decision | D3 | Advisory authority remains unchanged |

## Steps

### Step 1
- Step ID: U1
- Result: Global subagent activation policy is specified
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan`
- Test scenarios: config docs define the three modes; policy docs define override precedence; future subagent contract fields are required; existing no shared dispatcher guard remains present
- Discovery cache: docs/reference/immune-brain-config.md (local config docs); docs/reference/automatic-subagent-activation-policy.md (catalog activation policy); docs/reference/subagent-dispatch-protocol.md (dispatch lifecycle); docs/reference/workflow-and-subagents.md (subagent roster contract); tests/test_skill_contracts.py (contract assertions)
- Execution note: test-first
- failure_behavior: If existing docs conflict on default participation, prefer the global policy spec and record narrowed wording in the reference docs.
- security_considerations: Config must not grant write authority or QA authority.
- Depends on: none

### Step 2
- Step ID: U2
- Result: Activation helpers honor configured modes
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_activation_plan tests.test_work_probes tests.test_domain_mapper_dispatch`
- Test scenarios: auto mode preserves current trigger behavior; explicit_only returns `explicit_required` without explicit request; disabled returns `config_disabled`; lens override beats host override; work probes and Domain Mapper accept policy fallback reasons
- Discovery cache: .imm/imm_core/activation_plan.py (catalog activation builder); .imm/imm_core/work_probes.py (parallel probe dispatch helper); .imm/imm_core/domain_mapper_dispatch.py (Domain Mapper dispatch helper); tests/test_activation_plan.py (activation golden tests); tests/test_work_probes.py (probe helper tests); tests/test_domain_mapper_dispatch.py (mapper helper tests)
- Execution note: test-first
- failure_behavior: If config parsing becomes larger than this slice, keep runtime helpers pure and pass policy data as explicit inputs.
- security_considerations: Disabled or explicit-only modes must not be bypassed by trigger matches.
- Depends on: 1

### Step 3
- Step ID: U3
- Result: Subagent hosts share the activation contract
- Verification Type: automated
- Verification: `python3 -m unittest tests.test_skill_contracts tests.test_activation_plan tests.test_work_probes tests.test_domain_mapper_dispatch`
- Test scenarios: code review and UI review docs mention global policy; party, brainstorm, planner, work probes, and architecture mapper docs mention global policy; project-specific reviewers stay trigger-only under the policy; fallback explanations include `explicit_required` and `config_disabled`; future subagent contract wording is enforced
- Discovery cache: plugins/immune-brain/dist/imm-code-review.md (review host contract); plugins/immune-brain/dist/imm-ui-review.md (UI host contract); plugins/immune-brain/dist/imm-party.md (party delegation contract); plugins/immune-brain/dist/imm-brainstorm.md (research dispatch contract); plugins/immune-brain/dist/imm-planner.md (research dispatch and probes contract); plugins/immune-brain/dist/imm-work.md (probe host contract); plugins/immune-brain/dist/imm-arch-explorer.md (Domain Mapper contract); plugins/immune-brain/dist/prompt-contract-reviewer.md (project-specific reviewer precedent); tests/test_skill_contracts.py (cross-surface contract coverage)
- failure_behavior: If wording drift is broader than expected, limit the implementation to references and installed dist skill docs then defer source skill duplication to a follow-up.
- security_considerations: The final contract must preserve `tool_policy: no tools` and advisory-only language for delegated reviewers.
- Depends on: 2
