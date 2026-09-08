---
name: imm-doc-prune
description: Use when the user explicitly requests Immune-Brain pruning of stale current documentation from a Git repository after an explicit, hash-bound, user-approved manifest; never deletes Managed authority artifacts.
---

# Immune-Brain: Doc Prune

Use [`../../dist/imm-doc-prune.md`](../../dist/imm-doc-prune.md) as the canonical
contract index, not a whole-document read. This is a
standalone host-native maintenance entry, not a Managed Path continuation
and not an `imm-loop` internal-role dispatch.

Mandatory constraints: audit is read-only. Mutation requires exact hash-bound
manifest approval and immediate revalidation. Preserve active Managed ownership;
never delete authority artifacts or commit. Interruption requires a fresh scan.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Authority Boundary](../../dist/imm-doc-prune.md#authority-boundary), [Invocation](../../dist/imm-doc-prune.md#invocation), [Authority Artifacts Excluded](../../dist/imm-doc-prune.md#authority-artifacts-excluded)
- audit or manifest preparation: [Inventory and Manifest](../../dist/imm-doc-prune.md#inventory-and-manifest)
- approved mutation before any edit: [Mutation Envelope](../../dist/imm-doc-prune.md#mutation-envelope), [Approved Mutation](../../dist/imm-doc-prune.md#approved-mutation)
- completion: [Verify and Report](../../dist/imm-doc-prune.md#verify-and-report)
- recovery or deletion recoverability: [Recovery](../../dist/imm-doc-prune.md#recovery)
