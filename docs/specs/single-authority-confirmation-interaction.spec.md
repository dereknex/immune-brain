# Spec: Single Authority Confirmation Interaction

**Task ID**: `2026-08-21-006-single-authority-confirmation-interaction`
**Status**: Proposed
**Owner**: Planner
**Design risk**: Medium
**Design risk rationale**: The change alters user-facing workflow and authority guidance across Brainstorm, Planner, Loop, and the Pi Work Tool, but it does not change Kernel state, capabilities, confirmation callbacks, or persisted schemas.
**Diagram decision**: not_required
**Diagram reason**: The contract is a short decision hierarchy; a diagram would duplicate the prose without clarifying additional structure.

## Summary

Make one user decision require at most one confirmation. Keep native host UI as the only digest-bound authority gate, treat an explicit execution request or `start Enrollment` reply as a trigger rather than approval, and stop asking users to reconfirm decisions they already answered or bulk-approved.

## Requirements

### R1. Decision confirmation is delta-based

- Brainstorm and Planner ask only about unresolved decisions that can change Result, Scope, behavior, Verification, or risk treatment.
- A direct user requirement, an answer to a numbered question, or bulk approval of recommendations confirms those decisions.
- A final result-only summary is a non-blocking correction window when it introduces no new or changed decision.
- If synthesis introduces or changes a material decision, the owning Skill must surface that delta and obtain explicit confirmation before handoff.
- Brainstorm must not restore the historical failure where agent judgment alone turns unconfirmed proposed direction or scope into a Planner handoff.

### R2. Enrollment has one authority confirmation

- For an original mutation request, Planner authors and validates the candidate TaskIntent, then invokes `imm_canary_enrollment` without a separate chat confirmation.
- For an explicit Plan-only request, Planner stops without Enrollment. A later literal-user `start Enrollment` reply is an execution trigger; it is not represented as authority confirmation.
- The native digest-bound Enrollment UI remains the only authority confirmation and retains all existing snapshot revalidation, rehearsal, waiver, cancellation, and zero-write behavior.
- User-facing text must not ask the user to confirm in chat before announcing that a native confirmation will follow.

### R3. Existing-task authority operations open their native gate directly

- After `awaiting_user`, Loop calls `request_authorization` directly.
- A complete breaking revision is passed directly to `approve_breaking_intent_revision`; its native UI is the only approval.
- A proven stale claim routes directly to `repair_authority_state`; its native UI is the only approval.
- Review decision, rework/reject reason input, stop, and user-decision resolution retain their existing structured native interaction and authority semantics.

### R4. Historical guidance remains coherent

- Update the existing Brainstorm confirmation-gate Learning so it preserves confirmation for genuinely unconfirmed direction or scope while no longer requiring a redundant final-summary confirmation.
- Source Skill contracts and packaged `dist` contracts must state the same behavior.
- Do not add a confirmation token, parser, compatibility layer, runtime state, or alternate chat authority path.

## Technical Design

The change is prompt-contract-only. Existing host-owned UI remains the authority implementation. Contract tests pin three observable rules:

1. answered decisions are not reconfirmed, while new synthesis deltas still block handoff;
2. mutation requests proceed from validated TaskIntent to native Enrollment, while Plan-only requests use a non-authoritative start trigger;
3. Review authorization, breaking revision approval, and stale-claim repair are invoked directly and never preceded by a requested chat confirmation.

No runtime branch or storage behavior changes. Existing cancellation and snapshot-race tests remain authoritative for UI behavior.

## Decisions

- Keep native UI confirmation; do not interpret free-form chat as Kernel authority.
- Remove duplicate confirmation wording rather than build a deduplication state machine.
- Preserve the old Brainstorm gate only for decisions the user has not actually confirmed.
- Use existing focused contract tests instead of adding a new test harness.

## Assumptions

- The Parent can invoke the next foreground Tool in the same turn after a direct mutation request or an `awaiting_user` result.
- A Plan-only user must send a later message to change intent to execution; that message is necessarily a trigger but need not be called a confirmation.
- Native Pi UI remains available for authority-bearing operations.

## Devil's Advocate Audit

- **Rollback resilience**: All behavior changes are prose contracts and focused assertions. Reverting the contract edits restores prior behavior; Kernel authority and persisted records are untouched.
- **Verification vanity**: Tests must reject the old mandatory-final-confirmation phrases and require the direct-to-native, trigger-versus-authority wording. A mere check for the word `confirmation` is insufficient.
- **Spec dilution detection**: The change does not remove native confirmation, digest binding, snapshot revalidation, cancellation, Review decisions, or the requirement to confirm genuinely new or changed decisions.

## Test Scenarios

1. Brainstorm receives explicit answers or bulk approval, emits an unchanged summary, and can hand off without asking for another confirmation.
2. Brainstorm synthesis adds a new scope decision and must ask for confirmation of that delta before handoff.
3. A clear mutation request reaches validated TaskIntent and opens native Enrollment without a chat pre-confirmation.
4. A Plan-only request stops; `start Enrollment` later opens native Enrollment and is described only as a trigger.
5. Review `awaiting_user`, breaking revision approval, and stale-claim repair each open their native interaction directly.
6. Native cancellation or snapshot drift continues to produce zero authority writes under existing runtime tests.

## Non-Goals

- Removing or replacing Pi native confirmation UI.
- Treating natural-language replies as capabilities.
- Changing Kernel reducers, storage, TaskIntent schema, risk floors, or authorization operations.
- Redesigning the native dialog layout.
