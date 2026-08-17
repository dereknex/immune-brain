# gstack quality ceiling protocol

This guidance maps the useful parts of gstack's quality philosophy onto the
current Immune-Brain implementation. It is a docs and contract surface, not a
runtime authority.

The protocol deliberately strengthens existing Skill behavior without changing
State Ledger semantics, Activation Plan triggers, or role authority.

## Role Preference Contract

Each core Skill should have a sharp role preference: one preferred bias it
optimizes for, and one prohibited drift it must avoid. This keeps quality high
because the same role does not plan, implement, approve, and archive its own
work.

The stable role preference wording is `preferred bias` plus `prohibited drift`;
contract guards should preserve both phrases so future edits do not blur role
authority.

| Skill | preferred bias | prohibited drift |
|---|---|---|
| `imm-planner` | Prefer clear boundaries, independently closable Steps, concrete verification, and complete mapping of declared inputs. | Do not implement code, hide unresolved questions, or split one outcome into read/edit/run micro-steps. |
| `imm-executor` | Prefer the active Step boundary, minimal sufficient edits, and evidence that directly proves the recorded Result. | Do not close QA, widen scope for adjacent cleanup, or rewrite the Plan while implementing. |
| `imm-qa` | Prefer objective evidence, closure integrity, and rework/replan when evidence does not match the Plan. | Do not fix code, accept narrative-only claims, or decide product scope in place of planner-owned trace mapping. |
| `imm-compounder` | Prefer reusable Learning, durable tradeoff capture, and context dehydration after closure. | Do not replace QA closure, create speculative Learnings, or introduce a second memory authority. |

The practical rule is simple: advisory roles do not implement; execution roles
do not close QA; planner owns scope; QA owns closure judgment.

## Interaction Ritual Gates

Strict interaction ritual should be compressed into two gates. These gates
align with `skills/BASELINE.md` Success Criteria and Collaboration Posture, but
they are not a new workflow phase.

### Entry gate

Before a role proceeds, the active target must have enough clarity to avoid
speculative work:

- Goal: the expected Result is concrete.
- Boundary: the Skill authority and in/out scope are explicit.
- Verification path: the evidence command, artifact, or human check is known.
- Uncertainty: missing information that would change outcome, authority, or
  risk is either answered or recorded as a blocker.

If the Entry gate fails, the correct response is to ask, return to
`imm-brainstorm`, or return to `imm-planner`; it is not to silently widen scope.

### Exit gate

Before a role hands off or stops, the next boundary must be explicit:

- Evidence: what was checked, produced, or changed is visible.
- Risk: unresolved uncertainty is not hidden.
- Next action: rework, replan, compound, or continue is named.
- Authority: the next Skill owns the next decision.

If the Exit gate fails, the role should stop with the missing evidence instead
of manufacturing a pass.

## Closed-world Completeness Boundary

gstack's "lake-dry" completeness philosophy is valuable only when the input is
closed-world. Immune-Brain should apply it when the source declares a finite set
of items that must be mapped.

Current closed-world inputs include only finite source packets:

- `Brainstorm manifest`
- review follow-up packets with explicit findings or scope items

Derived processing stages include `Brainstorm Trace`, `origin_coverage`, and
the QA closure gate. They prove coverage of the source packet, but they are not
new closed-world inputs.

The processing chain is:

```text
Brainstorm manifest -> Brainstorm Trace -> origin_coverage -> QA closure gate
```

Every declared `BR-*` item must be covered, captured as a decision, deferred
with a reason, scoped out with a reason, or resolved as an assumption. This
prevents confirmed input from disappearing during planning.

This boundary is intentionally narrow. Ordinary small tasks do not become heavy
Brainstorm or origin coverage workflows unless they first produce a
closed-world manifest or equivalent packet.

## Deferred and Rejected Boundaries

This protocol preserves the boundaries already recorded in
[`gstack-borrow-p1-guidance.md`](gstack-borrow-p1-guidance.md) and
[`gstack-skills-borrow-insights.md`](../solutions/gstack-skills-borrow-insights.md).

Guard phrases:

- No shared registry: keep routing host-bound and trigger-only.
- No duplicate memory: do not add `learnings.jsonl`, SQLite, FTS, or another
  memory authority beside `.imm/memory/` and `docs/solutions/`.
- No browser daemon: persistent browser infrastructure needs a separate Spec
  and Plan.
- No ONNX: prompt-injection classification runtime is out of scope here.
- No Canary: Canary Token runtime is out of scope here.

P2/P3 candidates such as Accessibility Ref runtime, browser daemon, Canary
Token, ONNX classifier, sandboxing, and untrusted-output runtime guards require
their own threat model, Spec, Plan, and verification path.

## Use

Use this protocol when changing Skill contracts, prompt surfaces, workflow
guidance, or review gates. Do not use it as a reason to add default reviewer
fan-out, a shared dispatcher, a new memory plane, or extra ceremony for small
tasks.
