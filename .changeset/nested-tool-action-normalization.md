---
"immune-brain": patch
---

Normalize JSON-string Tool action arguments before schema validation.

`hyper/qwen3.8-flash` can emit the object-valued `action` argument of
`imm_loop_action` and `imm_kernel_canary` as a JSON string
(`action: "{\"op\":\"status\"}"`), which the strict TypeBox schemas previously
rejected with repeated pre-execution failures. These Tools now recover exactly
that observed shape through Pi's `prepareArguments` pre-validation hook: only a
top-level `action` string that parses to a non-null, non-array object is
recovered; native object input, invalid JSON, arrays, `null`, primitives, and
all other malformed input still fail the unchanged strict schemas.