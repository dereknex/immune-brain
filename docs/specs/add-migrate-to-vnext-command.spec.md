# Add the one-time `imm-kernel migrate --to-vNext` command

**Status**: Candidate; plan-only, not enrolled.
**Design risk**: High — a new migration tool that mutates persisted authority-adjacent store state (`.imm/audit/`, `.imm/state/`) and gates the next version's own startup on its having run; reuses an existing, already-proven migration pattern, but the transformation and its marker are new.
**Execution posture**: diagnose-first (`--check` reports what would change without mutating), then verified-import-then-atomic-publish, mirroring the existing `imm-kernel migrate --storage-layout` precedent exactly rather than inventing a new migration shape.
**Document language**: English, following the Planner document-language default.
**Ordering dependency**: this Spec executes only after `close-taskrecord-v3-drain-window` (`BR-DEC-01`/`BR-DEC-02`) has landed. Flattening historical `TaskRecord` evidence to pure v4 JSON is only a well-defined transformation once the live union is v4-only; running this migration first would flatten evidence against a still-moving live contract.

## Outcome

A new `--to-vNext` flag is added to the existing `imm-kernel migrate` dispatcher (alongside, not replacing, `--storage-layout`). Run without `--check`, it: (1) refuses to run while an active Kernel claim or an unsettled unattended batch exists, matching the existing migration precondition; (2) builds a verified candidate transformation of every historical `.imm/audit/<task-id>/` record — flattening whatever mix of `TaskRecordV2`/`TaskRecordV3`/`TaskRecordV4` and any residual `verification_descriptor` v1-shaped embedded payload exists on disk into pure, already-terminal v4-shaped JSON that no versioned parser is needed to read; (3) verifies the candidate's identity digest against the source before atomically publishing it; (4) writes a distinct migration receipt and bumps a `schema_version`-style marker, so the storage-layout migration's own existing receipt is never touched or overwritten. Run with `--check`, it performs the same diagnosis and identity verification but publishes nothing, exiting non-zero only if a real precondition failure (active claim, unsettled batch, or a record that cannot be flattened) is found.

After this migration has run once, this same version's own Kernel startup path refuses to operate on a workspace missing the vNext marker, and its diagnostic names the exact recovery action (`run imm-kernel migrate --to-vNext first`) — mirroring the existing storage-layout gate's own message shape at `commands/kernel.ts:527,536` exactly.

## Brainstorm Trace

| ID | Confirmed requirement | Design / acceptance |
|---|---|---|
| BR-DEC-05 | Add a one-time `imm-kernel migrate --to-vNext [--check]`, reusing the existing JSON→SQLite migration pattern (reject while an active task/unsettled batch exists; verify a candidate store's identity digest before atomic publish); process TaskRecord v3→v4 and verification v1→v2; write a schema/marker on completion; the next version's startup does only a marker check and refuses with a recovery instruction if it is missing | D1, D2; AC1–AC3 |

## Scope and exclusions

Include: `plugins/immune-brain/runtime/commands/kernel.ts` (the `migrate` dispatcher, currently accepting only `--storage-layout`, at line 1219); `plugins/immune-brain/runtime/kernel/sqlite_migration.ts` (the reused import/verify/publish/receipt primitives); a new module for the vNext transformation itself (flattening `.imm/audit/` evidence); the new marker/receipt path and the startup gate that checks it; a new focused test file for the command and gate.

Exclude: the existing `--storage-layout` migration and its own receipt (`MIGRATION_RECEIPT_RELATIVE`) — untouched, coexisting under a distinct marker path, not merged into one migration; `close-taskrecord-v3-drain-window`'s own reducer/validation narrowing (a prerequisite, not part of this Spec's own diff); any change to what a live `TaskRecordV4` record itself requires; `verification_descriptor` v2's own contract shape (a separate, already-settled scope per `project-owned-verification`) — this Spec only flattens any residual v1-shaped payload it finds embedded in historical evidence, it does not redesign v2. No generic "migration framework" beyond what `sqlite_migration.ts` already provides — this reuses that pattern's shape, it does not replace it.

## Discovery evidence and reference closure

- `plugins/immune-brain/runtime/commands/kernel.ts:1219-1237`: the `migrate` dispatcher currently accepts only `--storage-layout` (`if (flags.length !== 1 || flags[0] !== "--storage-layout") ...`); `--to-vNext` is added as a sibling accepted flag, not a replacement.
- `plugins/immune-brain/runtime/commands/kernel.ts:527,536`: the existing storage-layout gate's message shape (`"...; run imm-kernel migrate --storage-layout first"`, `"Run imm-kernel migrate --storage-layout, commit the affected paths, then retry intent author."`) — the vNext startup gate's own message mirrors this exact shape, naming `imm-kernel migrate --to-vNext` instead.
- `plugins/immune-brain/runtime/kernel/sqlite_migration.ts`: `withImportLock` (line 85, concurrency guard), `MIGRATION_RECEIPT_RELATIVE = .imm/state/migration-receipt.json` (line 123), `writeReceiptDurably` (line 215), `preserveRetiredArtifacts`/`removeRetiredArtifacts` (lines 460/468, preserve-then-remove-only-after-verified-publish), `writeAuditEvidence` (line 492), `buildCandidateStore`/`rebuildCandidateStore`/`verifyCandidateStore` (lines 508/548/555, build a candidate in isolation, verify its identity digest, only then publish), `importIdentity` (line 617, the identity digest itself), `importLegacyWorkspace`/`importLegacyWorkspaceLocked` (lines 767/782, the top-level orchestration this Spec's own `--to-vNext` orchestration mirrors). This is a proven, already-shipped pattern for exactly this shape of migration (diagnose → verified candidate → atomic publish → durable receipt); the vNext migration reuses these primitives rather than inventing new ones.
- `plugins/immune-brain/runtime/kernel/sqlite_store.ts:350` (`readMeta(db, "schema_version")`), `:403` (`writeMeta(db, "schema_version", ...)`): an existing SQLite meta-row marker precedent, confirming a schema-version marker is already a first-class concept in this store, not a new mechanism.
- `.gitignore:7`: `.imm/migrations/` is already reserved (ignored) even though nothing currently writes there — worth a quick check by whoever implements this Spec for whether that path was meant for this migration's working/candidate directory, before choosing a new location.
- `tests/kernel-storage-layout-migration.test.ts` (1286 lines): the closest existing test-shape precedent for a migration command test (diagnose, reject-on-precondition, verified-publish, receipt assertions) — the new `--to-vNext` test file follows its structure rather than inventing a new testing shape.
- `tests/kernel-migrate.test.ts` (142 lines): covers only an unrelated, already-retired `--dry-run` legacy-Ledger variant of `migrate` — no overlap with `--to-vNext`, confirmed by direct read; not a source of reusable fixtures for this Spec.
- Dependency: `close-taskrecord-v3-drain-window` (`BR-DEC-01`/`BR-DEC-02`) must land first — its `readAuditTaskPair` frozen-reader split (D2 of that Spec) is exactly what this Spec's flattening step reads from and ultimately makes redundant for any workspace that has completed this migration.

## Technical Design

**Design views**: a short sequence view would help here (diagnose → lock → build candidate → verify identity → atomic publish → receipt/marker) since this introduces a genuinely new multi-step orchestration, even though every step reuses an existing primitive.
**Diagram decision**: a compact sequence diagram is warranted for the `--to-vNext` (non-`--check`) path, since this is the one new orchestration this cutover introduces; `--check` is the same diagnosis truncated before publish and does not need its own diagram.
**Diagram reason**: unlike D1/D2 in the sibling extraction Specs, this is new control flow (a new top-level command path), not a relocation of existing branches — the sequence view should be produced by whoever implements this Spec, using the primitives named above, rather than being fully pre-drawn here.

### D1. `imm-kernel migrate --to-vNext [--check]`

Reject immediately if an active Kernel claim or an unsettled unattended batch is present (reusing the existing precondition check `importLegacyWorkspace` already performs, generalized to this transformation). Inventory every `.imm/audit/<task-id>/` record via the (by then landed) frozen historical reader from `close-taskrecord-v3-drain-window`, and confirm whether any embedded `verification_descriptor` payload is still v1-shaped; if none are found, this half of the step is a no-op verification, not a transformation — do not fabricate a v1→v2 rewrite where no v1 data remains. Build a candidate flattened export (pure v4-shaped JSON, no versioned parser required to read it back) via a new function mirroring `buildCandidateStore`/`verifyCandidateStore`'s shape; verify the candidate's identity digest against the source (mirroring `importIdentity`) before publishing. `--check` stops here and reports the diagnosis (preconditions, record count, any v1 payloads found) without publishing. Without `--check`, publish atomically, then write a receipt at a distinct path (not `MIGRATION_RECEIPT_RELATIVE`, so the storage-layout migration's own receipt is never overwritten) and bump a `schema_version`-style marker via the same `readMeta`/`writeMeta` mechanism `sqlite_store.ts` already uses.

### D2. Startup marker gate

This version's own Kernel startup (the same code path already gated on the storage-layout marker, per `commands/kernel.ts:527,536`) adds a check for the vNext marker written by D1. Its absence produces a rejection whose message names the exact recovery action, `imm-kernel migrate --to-vNext`, mirroring the existing storage-layout message's shape and tone exactly — no new diagnostic vocabulary is introduced.

## Verification and acceptance mapping

| Acceptance | Focused verification | Required regression behavior |
|---|---|---|
| AC1 | `bun test tests/kernel-migrate-to-vnext.test.ts` (new) | `--to-vNext` refuses to run with an active claim or unsettled batch present; `--check` diagnoses without mutating; a real run flattens historical `.imm/audit/` evidence to pure v4-shaped JSON, verifies its identity digest before publish, and writes a receipt distinct from the storage-layout migration's own |
| AC2 | `bun test tests/kernel-storage-layout-migration.test.ts` | the existing storage-layout migration's own receipt, marker, and behavior are completely unaffected by the new vNext migration's presence |
| AC3 | `bun test tests/kernel-migrate-to-vnext.test.ts` (new, startup-gate cases) | Kernel startup refuses to operate on a workspace missing the vNext marker, naming `imm-kernel migrate --to-vNext` as the recovery action; startup proceeds normally once the marker is present |

Outside these acceptance descriptors: `bun run typecheck` and a full `bun test` pass, since this Spec depends on `close-taskrecord-v3-drain-window` having already landed and must not regress that Spec's own frozen-reader behavior.

## Devil's Advocate Audit

- **Rollback resilience**: the existing pattern's preserve-before-remove discipline (`preserveRetiredArtifacts` before `removeRetiredArtifacts`) must carry over here — the pre-migration `.imm/audit/` evidence is preserved until the candidate is verified and published, so a failed or interrupted run leaves the original evidence intact and the workspace still pre-migration (the marker is simply absent, and D2's gate keeps refusing until a successful run).
- **Verification vanity**: `--check` succeeding must not be treated as proof a real run will succeed — AC1 must include at least one real (non-`--check`) run asserting the receipt and marker are actually written, not just that diagnosis reports cleanly.
- **Spec dilution**: this must not become a general "data migration framework," must not touch the storage-layout migration's own receipt or marker, and must not silently invent a v1→v2 transformation where discovery finds no residual v1-shaped payload — the inventory step in D1 exists precisely to keep this Spec evidence-scoped rather than assumption-scoped.

## Delivery boundary

One Spec and one TaskIntent settle together. This candidate authorizes nothing until native Enrollment. Execution completion requires the focused acceptance checks, `bun run typecheck`, and required Review (a new migration path mutating persisted authority-adjacent store state requires it); planning completion requires canonical author/validate success, a tracked candidate artifact, and the complete BR trace above. This Spec's TaskIntent should not be enrolled before `close-taskrecord-v3-drain-window`'s has settled, per the ordering dependency stated above.
