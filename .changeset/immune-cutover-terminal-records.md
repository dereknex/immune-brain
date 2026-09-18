---
"immune-brain": major
---

Close the TaskRecord v3 drain window and delete the drained v4 CLI surface.

The live `TaskRecord` contract is v4 only: `parseTaskRecord` and every entry
point that mutates authority now reject a v2/v3 record, and the frozen parsers
for those contracts moved to `kernel/legacy_task_record.ts`, where the audit and
storage-layout readers reach them as a fallback. Settled pre-v4 evidence under
`.imm/audit/` stays exactly as it was written — it is read through those frozen
parsers rather than rewritten (see `docs/adr/0011-frozen-readers-for-pre-v4-terminal-evidence.md`), so no existing workspace needs a new migration step.

The eight commands marked "Retired after v4 storage retirement" (`imm-work`,
`imm-review`, `imm-autowork`, `imm-heal`, `imm-migrate`, `imm-finish`,
`imm-check-child-output`, `imm-retire-stale-wrapper`) are gone: their `bin/`
wrappers and the runtime's per-command `drain_required` / `v3_storage_retired`
wall are deleted, a retired name now returns the generic
`Unknown Immune-Brain v4 command` response, and `list-commands --json` no longer
publishes a `retired` list. The retired *option* wall on `imm-plan --sync` and
friends is unchanged.
