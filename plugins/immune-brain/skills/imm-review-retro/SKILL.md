---
name: imm-review-retro
description: Use when the user explicitly requests Immune-Brain ranking of models by cross-model review load or a project usage retro.
---

# Immune-Brain: Review Retro

Use [`../../dist/imm-review-retro.md`](../../dist/imm-review-retro.md) as the
canonical contract index, not a whole-document read. This is a
standalone host-native analysis entry, not a Managed Path continuation
and not an `imm-loop` internal-role dispatch.

Mandatory constraints: read-only on pi session logs. Do not edit code, tests,
Specs, or workflow state. Do not write session logs or `.imm/` files.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Boundary](../../dist/imm-review-retro.md#boundary), [Invocation](../../dist/imm-review-retro.md#invocation)
- running the analyzer: [Counting rules](../../dist/imm-review-retro.md#counting-rules), [CLI](../../dist/imm-review-retro.md#cli)
- interpreting the report: [Report](../../dist/imm-review-retro.md#report), [Caveats](../../dist/imm-review-retro.md#caveats)
