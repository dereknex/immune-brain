---
status: accepted
---

# Receipt-Bound Review Verdict Submission

Accepted with the Issue #177 remaining work. The reviewer's verdict reaches the
Kernel through a Parent transcription today; this ADR removes the transcription
as the required channel and closes the Pi host's observation gap. ADR 0004's
host Port owns Review observation; nothing here adds a second workflow state
machine, an approval tier, or a Kernel core rewrite.

## Context

The 2026-10-09 retro (#177) recorded real handover failures across two hosts:

- Session A (immune-brain): the #173 verdict relay shortened `caller_chain`;
  the Parent also decoded and rewrote a reserved dispatch prompt once.
- Session B (refine PR #670): one reviewer handback was invalid JSON (root
  object unterminated); the declared-vs-read gap showed 5/57 and 4/57 files
  actually read against 57 declared.

Two structural facts shape the decision:

1. **The Claude host already mediates.** `submit_review` on the Claude host
   compares the Parent-submitted verdict against the hook-observed reviewer
   receipt with a fingerprint over the entire valid verdict surface (contract,
   role, task_id, snapshot_digest, decision, approval, findings — caller_chain
   lives inside findings), since 14fc66a. The #173 relay shortening was in fact
   caught this way ("parent verdict does not match reviewer receipt" appears in
   that session's records); the cost was one extra resubmission round trip.
2. **The Pi host observes nothing.** `docs/reference/subagent-dispatch-protocol.md`
   stated "Local execution trusts the Parent to relay the reviewer verdict and
   does not require Agent lifecycle receipts." The same relay shortening on Pi
   passes silently: `PiReviewHost` records only pending operation ids and
   `submit_review` feeds the Parent's bytes straight into the coordinator.

The residual gaps, after (1): transcription remains the required channel, so
relay errors keep happening and keep costing recovery round trips; and the
reviewer's own bytes are never persisted to authority evidence, so post-hoc
audit cannot prove the persisted verdict equals what the reviewer produced —
the #177 retro itself hit this limit when it could not determine from
transcripts whether an invalid handback had been rejected by the caller.

## Decision

1. **`submit_review`'s `verdict` becomes optional on both hosts.** Omitted: the
   Kernel applies the host-observed reviewer receipt bytes directly, after the
   same `parseAssuranceVerdict` validation against the frozen snapshot, with the
   same snapshot-digest, record/Intent/workspace/diff revision, and reservation
   correlation checks. Provided: the existing fingerprint comparison path is
   unchanged, byte for byte. The Parent keeps exclusive trigger authority —
   dispatching the reserved reviewer and submitting remain Parent-owned acts,
   and the settlement actor stays `parent-mediated-review`. Only the copy step
   is removed.

2. **The Pi host gains the Claude-equivalent observation.** The Pi extension
   observes the generic `tool_call` event for an `Agent` dispatch whose prompt
   digest matches the reserved prompt (`promptDigest`), then stores the paired
   `tool_result` content bytes on that review reservation. The receipt lives in
   process memory, the same lifetime as the reservation itself: a restart that
   loses the receipt has already lost the reservation and reports
   `no active Review operation`. No new persisted surface is created. A
   `submit_review` without a recorded receipt fails closed with the existing
   blocked guidance (release the reservation, dispatch a fresh reviewer).

3. **Recovery wording follows the new primary path.** A fingerprint mismatch or
   an absent receipt keeps current fail-closed behavior; the recovery action
   names the no-verdict resubmission first ("resubmit without a verdict to apply
   the observed reviewer receipt"), with exact-byte resubmission remaining valid
   where a receipt is unavailable.

4. **The v4 review attestation gains an optional `reviewer_verdict_sha256`.**
   Bound from the observed receipt bytes at submission and emitted only when
   present — legacy records keep their canonical hash (the same optional-field
   rule parseFinding already follows for finding anchors). Audit can then prove
   the persisted verdict equals the reviewer-produced bytes without reading host
   transcripts.

5. **The shared coordinator is not the resolver.** Verdict-source resolution
   (Parent bytes vs observed receipt) happens in the host adapters before the
   shared submit path; the coordinator keeps its current single-verdict-input
   signature. If a future change needs the coordinator to know about receipts,
   that is a new decision, not an extension of this one.

## Consequences

- A relayed verdict is no longer the required channel; #173-class relay errors
  cannot occur on the no-verdict path, and the interception round-trip cost
  disappears for it. Transcription remains available for hosts and callers that
  genuinely cannot observe.
- The dual-host conformance suite must cover, on both hosts: no-verdict
  submission applying the receipt bytes; provided-verdict fingerprint behavior;
  and the fail-closed no-receipt path.
- `docs/reference/subagent-dispatch-protocol.md` retires its
  "trusts the Parent" sentence; the reserved-prompt verbatim dispatch and
  `inspected_paths` rules from #146/#148/#149 are unchanged — the observation
  boundary reuses exactly that receipt edge.
- Post-hoc audit gains a digest bound; transcript reconstruction stays possible
  but is no longer required to prove relay fidelity.
- The generated Claude bundle (`dist/claude/mcp-server.mjs`) must be regenerated
  with this change and shipped in the same slice, or the packaged host diverges
  from the reviewed sources.

## Rejected Alternatives

- **Detection only (mandatory relay plus fingerprint, ported to Pi).** Keeps
  the error channel and the recovery round trip; on Pi it would add the
  comparison without removing the copy step it checks.
- **An explicit `verdict_source: "observed_receipt"` field.** A wider tool
  surface than an optional omission (against the #1795 minimal-surface
  precedent); omission is the natural expression of "did not transcribe".
- **Silently falling back to receipt bytes on mismatch.** Overrides the
  Parent's explicit input; a mismatch must stay visible with its own recovery.
- **Persisting reviewer bytes or a digest to a sidecar evidence file.** A second
  authority surface; the optional attestation field serves the same audit need
  inside the existing evidence.
- **A durable Pi receipt log (FileHookEventLog-style).** The Claude host needs
  cross-process persistence because hook processes and MCP calls are separate
  processes; the Pi reservation already dies with the process, so a receipt that
  outlives its reservation is a recovery path nothing consumes.
