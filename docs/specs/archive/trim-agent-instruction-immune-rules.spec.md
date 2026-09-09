# Spec: Trim Immune-Brain Rules From Agent Instructions

**Task ID**: `2026-09-09-001-trim-agent-instruction-immune-rules`
**Owner**: user
**Status**: Candidate
**Design risk**: Low
**Design risk rationale**: This removes repository-local prompt guidance without changing Skills, runtime authority, persisted state, or external interfaces.
**Diagram decision**: not_required
**Diagram reason**: The change is a bounded deletion from one instruction file; `CLAUDE.md` already resolves to that file through a tracked symbolic link.

## Outcome

Reduce interference with unrelated Skills by removing Immune-Brain workflow explanations from the repository root agent instructions. Preserve the general engineering and Skill-selection rules, repository navigation that is useful outside Managed execution, and the existing Initiative carrier preference.

## Confirmed Decisions

- The user selected instruction-file cleanup instead of changing the six `imm-*` Skill descriptions or adding `disable-model-invocation`.
- Remove Immune-Brain-specific workflow rules from `AGENTS.md`, including Managed owner, TaskIntent, `.imm`, Enrollment, and Kernel QA/Review directions that ordinary tasks do not need.
- Keep general precedence, local execution, verification, search-boundary, and Skill-selection guidance.
- Keep `Initiative carrier default: github` as a minimal preference rather than a workflow explanation.
- Do not replace or edit the `CLAUDE.md` symbolic link; it continues to resolve to `AGENTS.md` and therefore receives the same instruction cleanup.

No unresolved user decision remains.

## Discovery Evidence

- `AGENTS.md` is the only content owner. `CLAUDE.md` is a tracked symbolic link whose target is `AGENTS.md`.
- `AGENTS.md` currently mixes general repository guidance with a dedicated `## Immune-Brain` section and additional references to Managed authority, Immune-Brain document language, Kernel QA/Review, and Managed owners in otherwise general sections.
- `tests/exhaustive-decision-tree-contract.test.ts` directly requires the root instruction file to contain `普通输入保持 host-native` and therefore must be revised with the retired guidance.
- `tests/subagent-activation-contract-retirement.test.ts` and `tests/host-tool-policy-contract.test.ts` protect general subagent and host-tool guidance that remains in scope and must continue to pass.
- `plugins/immune-brain/skills/*/SKILL.md`, `plugins/immune-brain/dist/BASELINE.md`, and `IMMUNE.md` remain the owners of explicit Immune-Brain workflow behavior; this task does not change them.

## Technical Design

Edit `AGENTS.md` in place. Remove the dedicated workflow section and Immune-Brain-only clauses embedded in general sections. Preserve the existing carrier directive in a compact `## Immune-Brain Preferences` block. Preserve useful repository navigation without restating Managed routing or authority rules.

Update the existing root-contract test so it verifies the resulting boundary: general agent guidance and the carrier preference remain, the retired workflow trigger sentence is absent, and `CLAUDE.md` remains a symbolic link to `AGENTS.md`. Do not add a second test file or duplicate the instruction content in a fixture.

Add one patch changeset because the packaged project guidance changes user-visible behavior. No compatibility layer or migration is needed; rollback is the coherent revert of the instruction, test, and changeset edits.

## Boundary

In scope: root agent instructions, the directly bound contract test, this Spec and its archive destination, the canonical TaskIntent, and one patch changeset.

Out of scope: Skill frontmatter, `disable-model-invocation`, `IMMUNE.md`, Baseline and dist contracts, README text, extension/runtime code, Kernel authority, configuration parsing, and changes to the `CLAUDE.md` symlink itself.

## Acceptance And Verification

| ID | Required evidence | Focused descriptor |
| --- | --- | --- |
| acc-agent-instruction-boundary | `AGENTS.md` retains general precedence, verification, Skill-selection guidance, and `Initiative carrier default: github`; it no longer carries the dedicated Immune-Brain workflow rules or the `普通输入保持 host-native` trigger text; `CLAUDE.md` remains a symbolic link to `AGENTS.md`. | `bun test tests/exhaustive-decision-tree-contract.test.ts tests/subagent-activation-contract-retirement.test.ts tests/host-tool-policy-contract.test.ts` |
| acc-release-metadata | A patch changeset describes the reduced agent-instruction interference and is covered by the existing root-instruction contract test. | `bun test tests/exhaustive-decision-tree-contract.test.ts` |

## Brainstorm Trace

| Origin | Resolution |
| --- | --- |
| Goal: avoid Immune-Brain conflicts with other Skills | Remove repository-local workflow explanations from the always-loaded host instructions. |
| Decision: do not strengthen Skill descriptions | Skill frontmatter and model-invocation behavior are explicitly out of scope. |
| Decision: only AGENTS.md and CLAUDE.md rule explanations need removal | Change the single content owner, preserve the symlink, and touch only the test and release metadata required to support that deletion. |
| Known limitation | This reduces prompt interference but does not guarantee that a model will never select an exposed `imm-*` Skill through description matching. |

## Output Language

The Spec and TaskIntent use English. User-facing summaries remain Chinese.
