---
"immune-brain": patch
---

Reduce `runtime/plan_core.ts` to the validator surface production reaches — `PlanValidationError` and `projectPlanValidation` — with the compiler deciding which bodies were genuinely unreachable, and remove the two orphans in `runtime/v4_runtime.ts` (the unused `READ_ONLY_V3_COMMANDS` set and `retiredResponse`'s unused `command` and `args` parameters). Plan validation behavior, the `imm-plan` projection, and the v3 retirement messages are unchanged; the plan-signature helpers, which no production caller reached, are gone.
