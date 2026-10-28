---
name: prune-docs
description: Use when the user explicitly requests Immune-Brain pruning of stale current documentation.
---

# Immune-Brain: Prune Docs

Use [`../../dist/prune-docs.md`](../../dist/prune-docs.md) as the canonical
contract index, not a whole-document read. This is a
standalone host-native maintenance entry, not a Managed Path continuation
and not an `drive` internal-role dispatch.

Mandatory constraints: audit is read-only. Mutation requires exact hash-bound
manifest approval and immediate revalidation. Preserve active Managed ownership;
never delete authority artifacts or commit. Interruption requires a fresh scan.

Section routes - load a section's instructions only when its branch applies.
Read each linked heading body up to the next heading; nested sections and
references load only under their own condition. Never read the whole contract
or all references as an entry prerequisite.

- common: [Authority Boundary](../../dist/prune-docs.md#authority-boundary), [Invocation](../../dist/prune-docs.md#invocation), [Authority Artifacts Excluded](../../dist/prune-docs.md#authority-artifacts-excluded)
- audit or manifest preparation: [Inventory and Manifest](../../dist/prune-docs.md#inventory-and-manifest)
- approved mutation before any edit: [Mutation Envelope](../../dist/prune-docs.md#mutation-envelope), [Approved Mutation](../../dist/prune-docs.md#approved-mutation)
- completion: [Verify and Report](../../dist/prune-docs.md#verify-and-report)
- recovery or deletion recoverability: [Recovery](../../dist/prune-docs.md#recovery)
