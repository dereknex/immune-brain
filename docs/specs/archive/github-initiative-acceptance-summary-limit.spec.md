# Spec: GitHub Initiative Acceptance Summary Limit

**Task ID**: `2026-09-07-001-github-initiative-acceptance-summary-limit`
**Owner**: user
**Status**: Proposed
**Output language**: English (project policy)

**Design risk**: Medium

The change is a narrow outbound projection contract fix, but it affects both single-Task and complete Initiative GitHub publication. It does not change Kernel authority, TaskIntent validation, or GitHub mutation ownership.

**Design views**: component interface and data flow are selected because the defect is a length mismatch between the Kernel TaskIntent parser and the GitHub projection validator. Architecture layers, state transitions, and temporal sequence are omitted because ownership, states, ordering, and remote mutation flow do not change.

**Diagram decision**: not_required
**Diagram reason**: The complete behavior is one linear validation path with no new component or state relationship.

## Outcome

A TaskIntent acceptance assertion that is valid under the Kernel contract can be projected into a GitHub Child Issue without failing at an unrelated 500-character tracker limit. GitHub's total body-byte preflight remains the final size boundary.

## Discovery Evidence

- `plugins/immune-brain/runtime/kernel/intent.ts:196` accepts `intent.acceptance[].assertion` values up to 2,000 characters.
- `plugins/immune-brain/runtime/github_issue_tracker.ts:969` currently revalidates that assertion as `acceptance[].summary` with a 500-character limit before any GitHub write.
- `plugins/immune-brain/runtime/github_issue_tracker.ts:605` and the Initiative preflight enforce the actual 65,536-byte GitHub Issue body limit, including reserved terminal suffix bytes.
- `plugins/immune-brain/runtime/github_issue_tracker.ts:1286` maps canonical assertions losslessly into public summaries.
- `tests/plugin-package-runtime.test.ts` owns complete Initiative publication, restricted projection, and body-limit regression coverage.
- `plugins/immune-brain/bin/imm-tracker` routes through `runtime/v4_runtime.ts`; neither wrapper needs modification.
- `docs/adr/0002-maintenance-surface-ownership.md` and `docs/adr/0004-dual-host-assurance-adapters.md` keep GitHub projection non-authoritative and outside Kernel ownership.
- `docs/solutions/rejected-plan-boundary-shortcuts-and-automatic-successor-authority.md` rejects using tracker metadata as automatic execution authority; this change preserves that boundary.

## Technical Design

### Interface

`validateOperation` continues to normalize and validate every `upsert-task` acceptance summary. Its accepted length becomes 1-2,000 characters, matching the canonical TaskIntent assertion contract. Inputs, outputs, errors, ownership, secret redaction, restricted-text rejection, and compatibility remain unchanged.

Only the acceptance summary field changes. The independent 500-character limits for `key_interfaces`, `decisions`, and `out_of_scope` remain unchanged.

### Data Flow

The source remains the Git-tracked canonical TaskIntent. `taskPublication` maps each assertion without truncation to the tracker operation; `validateOperation` validates up to 2,000 characters; `childBody` renders it; `bodyLimitFailure` measures the complete UTF-8 body before any remote mutation. An individual assertion over 2,000 characters remains Kernel-invalid, while a combined body over 65,536 bytes remains a tracker `permanent_failure` with zero GitHub writes.

### Failure and Compatibility

The repair broadens only a tracker constraint that was narrower than its source contract. Existing safe-text checks and body guards remain fail-closed. Rollback is one source constant/call-site reversal plus its focused tests; no persisted state or remote migration is introduced.

## Scope

- `docs/specs/github-initiative-acceptance-summary-limit.spec.md`
- `docs/specs/archive/github-initiative-acceptance-summary-limit.spec.md`
- `plugins/immune-brain/runtime/github_issue_tracker.ts`
- `tests/plugin-package-runtime.test.ts`

## Acceptance and Verification

1. `acc-valid-taskintent-acceptance-projected`: A canonical TaskIntent with an acceptance assertion between 501 and 2,000 characters publishes through both the tracker operation and complete Initiative path without truncation, while existing restricted-text validation still rejects prohibited content.
   - Verification: `bun test tests/plugin-package-runtime.test.ts`
2. `acc-github-body-limit-preserved`: Enlarged acceptance summaries remain subject to the existing 65,536-byte UTF-8 body preflight and terminal-suffix reserve, and an oversized Child performs zero GitHub mutations.
   - Verification: `bun test tests/plugin-package-runtime.test.ts`

This is the highest existing observable behavioral seam: it exercises the real publication functions and fake GitHub mutation transport, so it catches both the original preflight rejection and any accidental weakening of zero-write body-limit behavior.

## Devil's Advocate Audit

**Rollback resilience**: The change has no state migration or partial-write recovery. Reverting the source limit and tests fully restores prior behavior.

**Verification vanity**: A direct validator unit assertion would miss the complete publication path. The focused test must author a canonical tracked TaskIntent with a long assertion, publish it, and inspect the rendered Child body. The body-limit case must assert zero transport mutations.

**Spec dilution detection**: The task does not shorten TaskIntent acceptance, truncate public evidence, broaden unrelated projection fields, bypass restricted-text validation, weaken body-size preflight, or grant execution authority from GitHub state.

## Brainstorm Trace

Not applicable: this is a direct Planner repair of a reproduced repository contract mismatch and introduces no user-owned product decision.
