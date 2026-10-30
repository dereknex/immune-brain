---
name: revisit
description: Use when the user explicitly requests an Immune-Brain workflow-health retro over recent pi session logs.
---

# Immune-Brain: Revisit

Use [`../../dist/revisit.md`](../../dist/revisit.md) as the
canonical contract index, not a whole-document read. This is a
standalone host-native analysis entry, not a Managed Path continuation
and not an `drive` internal-role dispatch.

Mandatory constraints: read-only on pi session logs and on the committed
`.imm/audit/` of one named project at HEAD (`--audit`). Do not edit code, tests,
Specs, or workflow state. Do not write session logs or `.imm/` files, and do not
read live `.imm/` state.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Boundary](../../dist/revisit.md#boundary), [Invocation](../../dist/revisit.md#invocation)
- running the analyzer: [Counting rules](../../dist/revisit.md#counting-rules), [CLI](../../dist/revisit.md#cli)
- interpreting the report: [Report](../../dist/revisit.md#report), [Caveats](../../dist/revisit.md#caveats)
