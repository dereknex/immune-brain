---
name: imm-retro
description: Use when the user explicitly requests Immune-Brain ranking of models by cross-model review load or a project usage retro.
---

# Immune-Brain: Retro

Use [`../../dist/imm-retro.md`](../../dist/imm-retro.md) as the
canonical contract index, not a whole-document read. This is a
standalone host-native analysis entry, not a Managed Path continuation
and not an `imm-run` internal-role dispatch.

Mandatory constraints: read-only on pi session logs. Do not edit code, tests,
Specs, or workflow state. Do not write session logs or `.imm/` files.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Boundary](../../dist/imm-retro.md#boundary), [Invocation](../../dist/imm-retro.md#invocation)
- running the analyzer: [Counting rules](../../dist/imm-retro.md#counting-rules), [CLI](../../dist/imm-retro.md#cli)
- interpreting the report: [Report](../../dist/imm-retro.md#report), [Caveats](../../dist/imm-retro.md#caveats)
