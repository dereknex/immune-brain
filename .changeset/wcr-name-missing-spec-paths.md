---
"immune-brain": patch
---

The Spec-binding refusal now names what the TaskIntent still has to add, and the
Claude bundle is regenerated with it. `inspectSpecBinding`'s binding_missing
fallback is reachable for the scope_hint shapes that declare Spec halves which
never pair, and it returns those concrete unpaired paths instead of an empty
`missing` and a generic message; the genuinely-empty case keeps its generic
message because it has no path to name, and a complete pair carrying an unpaired
half stays `binding_incomplete`. `batch_plan.ts` renders the paths of every
refusal that carries them through one branch, so its unreachable
`SPEC_BINDING_REASONS.binding_incomplete` entry is gone.
