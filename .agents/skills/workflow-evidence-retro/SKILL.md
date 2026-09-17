---
name: workflow-evidence-retro
description: Use when the user asks to assess agent workflow friction from task audit records or prioritize process improvements using completed and stopped runs.
---

# Workflow Evidence Retro

Produce a bounded, reproducible baseline and one evidence-backed next improvement. Analyze existing records; implementation requires scope from the user's request. This Skill grants no execution or workflow authority.

## 1. Fix the sample

Use the current project and explicitly named evidence roots. Check the existing retro tools before choosing an extractor. Use task/run audit records for lifecycle facts; session-based model rankings answer a different question.

Inventory record schemas and layouts before sampling. Recursively include flat and run-scoped audit paths. Select about 10 recent terminal runs by recorded terminal timestamp, with a stable path tie-breaker. Preserve task/run identities, deduplicate mirrored copies, and report exclusions and missing timestamps. Include stopped runs. Label the absence of active/unexported runs as terminal-sample bias.

Completion: report the source revision, exact sample paths/identities, selection rule, time window, schemas and omitted coverage. Use no file mtime or task-name ordering as a substitute for terminal timestamps.

## 2. Verify and count facts

Validate each selected record against its terminal proof using the format's actual hash convention, identity, lifecycle and terminal event. Label unsupported schemas or mismatches explicitly; limit conclusions to the evidence that can be verified. Hash agreement establishes consistency, not independent authenticity.

Count separately:

- Successful QA attestations and execution failures.
- Review rework events, pass attestations and finding entries by source/status.
- Compatible revisions, breaking revisions, user-authorized rework and stop events.
- Distinct evidence bindings within each run (intent revision/content and delivery/diff identity; use additional binding fields when the format provides them).

Finding entries are not unique bugs. Pass attestations are not total review rounds. Repeated QA with changed identity is not evidence of wasted reruns. Logged user authority events are a lower-bound observation, not a count of unnecessary prompts. Event gaps are not active work or waiting time. Keep unavailable cost, escaped-defect and post-delivery outcome metrics unknown.

Completion: every displayed count is reproducible with a bounded read-only command or existing analyzer, and the sample table distinguishes stopped from done.

## 3. Explain the recurring failures

Read all findings and relevant event sequences for the sample, not only keyword matches. For each proposed pattern, cite exact record paths and finding/event IDs; separate observed facts, plausible explanations and unknowns. Classify useful quality catches separately from process faults and literal user decisions. Check counterexamples before ranking.

For repeated cross-boundary findings, trace the evidence through:

```text
real public/host entry
  authorization and preconditions
  changed behavior and state owner
  serialization / durable write
  reload and downstream consumer
```

For rejection tests, ask whether the original state could succeed, whether only the target condition changed, and whether the asserted rejection reason proves the intended invariant. A test that fails because another prerequisite is missing does not prove the claimed protection.

Historical resolved findings show past rework, not current bugs. Before proposing a current fix, inspect the named current paths or explicitly mark the proposal as requiring reproduction. Repeated rework alone does not establish that a task was too large or an authorization gate was unnecessary.

Completion: up to three distinct opportunities, each with evidence, practical consequence, uncertainty and a countercheck. Return fewer if the evidence does not support three.

## 4. Choose one next improvement

Recommend the smallest change that addresses the best-supported recurring pattern. State target behavior, likely files, focused verification and a bounded follow-up sample. Prefer existing prompts, tests and recovery mechanisms. Preserve authority and assurance boundaries; reduced friction is not permission to bypass them.

For cross-boundary omissions, consider one handoff requirement covering the real entry and write/read path. Check whether existing instructions already cover it before adding text. Rework should revisit callers sharing the violated invariant, within the authorized scope.

Record a security or data-loss concern promptly, but keep historical evidence distinct from a reproduced current vulnerability. Implement only the scope the user authorized; never resume a stopped managed run through this Skill.

Completion: write the report to the project's existing report location (otherwise `docs/reports/`), verify links and recompute counts. Report changes and verification limits. Keep evidence stores read-only, and extract reusable lessons without copying local metrics into standing rules.

## Worked example

When applying this method to Immune-Brain audit schemas or checking the rationale for the cross-boundary test rule, consult [the ten-task baseline](../../../docs/reports/workflow-evidence-baseline.md). Its figures are a fixed historical example, not thresholds for future tasks. Other projects should use their own evidence formats and constraints.
