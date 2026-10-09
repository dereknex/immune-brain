# Session retro follow-ups — 2026-10-09

Source: Claude session `4df4215e-0188-4d66-9ac0-f1c9103e8587`; implementation in immune-brain only. Issues: #177–#181 and nexttylabs/refine#674–#675.

## Review evidence (#177)

Bounded source inspected: `~/.claude/projects/-Users-derek-workspaces-immune-brain/732b5920-32a9-424c-bf3b-849de2415f70/subagents/*.jsonl`, selected by reviewer metadata. Commands identify immutable review commits, so they can be distinguished from live-tree reads. The following are concrete partial-reading observations, not inferred defects or a minimum-duration rule:

| operation_id | review_commit | observed bundle reading |
| --- | --- | --- |
| 5f65a33c-ef54-4bcf-820e-1e75ad735144 | c28e2e611c23ef4c4afa9e55a5a466a6a692c000 | counted diff lines, read removed-line `head -20` and `max_parallel` matches; complete added hunks not demonstrated |
| 5de6983d-edc5-4f7b-8ce6-460cb17ccce2 | a4d5068bdd95237ede7bad8021fba9f5ab072367 | bundle diff filtered through `cut -c1-160` and `head -200` |
| 86b6e159-f940-4acb-a220-922d90a3ed32 | 77a1a77c2172703b1807ff24491741f4816344f8 | bundle diff piped to `head -150` |
| 70563ba8-c3ad-4435-bbed-66ec1bc2539a | 6228334708c0e003d8ecaeb85905521dc0a0342b | initial aggregate excludes dist; later added/removed lines cut to 300 columns |
| b9147e9f-a6d5-4d74-91be-dfd81b60d59a | 42731087729cc2169e517b68e4a5874535292412 | initial aggregate excludes bundle; later bundle diff piped to `head -80` |

These reviewers declared the bundle in `inspected_paths`. That list enforces declared path coverage but cannot prove full reading. Some tool results are persisted-output wrappers; their presence is not itself evidence of truncation or of a later full read. No claim is made that every source file was unread or that these limitations caused a missed bug.

Canonical `runtime/prompts/code-review.md` now requires complete per-file hunks, bounded pagination, deletions, relevant callers/state owners and negative cases. Both packaged prompt and generated Claude reviewer definition derive from it. Existing reserved-prompt and receipt rules remain authoritative; no fabricated receipt or altered historical verdict is introduced.

### Per-file coverage reconstruction (2026-10-09)

Both remaining evidence items were collected read-only against the same bounded sources and are recorded here as measurements, not as new repairs. Classification is per demonstrated tool call only: a file is `complete` when a transcript shows an unbounded read whose result is byte-identical to freshly computed `git` object output, or a bounded read whose captured result provably contains the whole diff; `partial` when a bound truncated or stripped context; `unread` when only `--stat`/name-list metadata was seen. A persisted-output wrapper counts only where the transcript later Reads the persisted file.

The five dispatches in this repository, reconstructed per file:

| operation_id | files | complete | partial | unread | partial cases |
| --- | --- | --- | --- | --- | --- |
| 5f65a33c-ef54-4bcf-820e-1e75ad735144 | 26 | 23 | 3 | 0 | `dist/claude/mcp-server.mjs` (counted diff lines, removed lines `head -20`, no added-line content); `batch_kernel_port.ts` (diff persisted to a wrapper never Read back; only `sed -n 30,200p` demonstrated); `tests/unattended-batch-lanes.test.ts` (sed ranges cover 1–228, 451–600, 600–734; lines 229–450 only grep names) |
| 5de6983d-edc5-4f7b-8ce6-460cb17ccce2 | 8 | 7 | 1 | 0 | `dist/claude/mcp-server.mjs` (`cut -c1-160` column-truncated 6 of 123 changed lines, hunk context removed) |
| 86b6e159-f940-4acb-a220-922d90a3ed32 | 17 | 17 | 0 | 0 | — |
| 70563ba8-c3ad-4435-bbed-66ec1bc2539a | 7 | 6 | 1 | 0 | `dist/claude/mcp-server.mjs` (`cut -c1-300` bit a 365-char changed line) |
| b9147e9f-a6d5-4d74-91be-dfd81b60d59a | 11 | 11 | 0 | 0 | — |
| **total** | **69** | **64** | **5** | **0** | |

Caller and state-owner reads outside the revision were also reconstructed (for example `scripts/verify-batch-completion.ts`, `batch_git.ts`, `batch_reconfirmation.ts`, `assurance/qa.ts`, and repo-wide greps for the symbols each change touched). Two bounded bundle reads (Dispatches 3 and 5) did not truncate and are counted `complete` on that evidence; the other three did.

### refine PR #670 review log audit

The two reviewer transcripts for PR #670 are one review run (`run-eee1cd94-408b-4586-b5b8-1f4f3594f7a6`) with two reviewers over the same frozen snapshot `4d90aeaf66600204fa3064c8416efb4fefac5b3f` (single parent `d5a2aff1fc9bc946ab967bc89d65f0262f025317`, still resolvable in `/Users/derek/workspaces/refine`), found at `~/.claude/projects/-Users-derek-workspaces-refine/3a324a1c-2e10-483e-8995-b5c5a42ebf99/subagents/`. The diff is 57 files, +732 / −3905, matching the statistics recorded in #177.

| reviewer | complete | partial | unread | verdict |
| --- | --- | --- | --- | --- |
| agent-a1847be62a6673de8 | 5 | 4 | 48 | `pass`, all 57 paths declared inspected, 1 advisory |
| agent-a56d75a61840896ec | 4 | 1 | 52 | `pass` (claimed), all 57 paths declared inspected, 1 advisory |

Visible changed lines were roughly 18% and 9% of the 4637 changed lines. Neither reviewer read any caller or state owner in full, tracked a call graph, or ran a test; both left acceptance to Kernel QA. The `partial` cases are the informative ones: a 272-line diff truncated at `head -250` exactly at a hunk header, a 38.3KB three-file diff persisted to a wrapper never Read back, a 641-line file read only through 13 grep line numbers, and a doc read through `sed -n 35,60p`. Three `git show` attempts failed on zsh revision modifiers and never produced output.

One concrete transfer failure is on record: agent-a56d75a6's handback verdict is invalid JSON (`inspected_paths` is not closed before `findings`, so the root object is unterminated; reproduced locally with `json.loads`, and confirmed by structural diff against the other reviewer's valid verdict). Whether the caller rejected that handback cannot be determined from these transcripts. Both reviewers' advisory finding is itself supported by visible evidence (a grep hit on the doc line that still lists removed env names).

### Measured effect

Baseline, from the pre-change evidence above:

- coverage: 64/69 files complete across the five in-repo dispatches (5 partial, 0 unread); 5/57 and 4/57 complete on the 57-file PR #670 review.
- transfer failure: 1 invalid verdict JSON in 2 handbacks (PR #670), plus the declared-vs-read gap in both.
- recovery: not measured; no post-change review run of comparable size exists yet.

The prompt change is in place, but an improvement cannot be claimed until a review of comparable size runs under the new prompt and the same per-file reconstruction is repeated. That measurement is the only remaining item for #177; no receipt, count, or historical verdict is fabricated to fill it.

## Planning and plan drift (#178)

Planner guidance now explicitly traces deployment configuration copies, integration assertions, generated Claude bundle and release changeset. Existing caller/state-owner closure guidance remains in place.

Serial reconfirmation intentionally supports only zero recorded child commits with one revised settled child and immutable evidence. A changed plan after recorded progress stays refused with zero writes. The rejection now explains that the old authorization cannot execute the revised plan, preserves batch/report/commit/audit evidence and directs inspection of remaining Kernel runs before an explicit `imm-run` handoff. It does not terminate the old batch, re-enroll settled children, manufacture trailers or rewrite past approval.

### Batch disposition (delivered 2026-10-09)

The remaining authority-backed disposition is implemented as `retire_stale_batch`, documented in [ADR 0016](../adr/0016-stale-batch-disposition.md) and `docs/specs/stale-batch-disposition.spec.md`:

- A new terminal batch state `superseded`, owned by `runtime/unattended/batch_state.ts`; the preflight derives its accepted-state set from the exported `BATCH_RUN_STATES` instead of a second list.
- `runtime/unattended/batch_disposition.ts` reads the Initiative's active record, projects the record's own evidence to one native gate, re-reads and requires identical bytes before writing, then rewrites only `batch_state` and `updated_at` under the Kernel store lock and writes one terminal report. Children, commits, lane bindings, `plan_digest`, `base_head` and the original `confirmation_time` are preserved; the report states that no batch trailer and no approval were granted.
- A mid-flight child (`enrolled`, `settled`, `lane_admitted`, `lane_committed`) refuses before the gate with `stale_batch_in_flight`; a record that moved during the gate is refused with `plan_changed`; decline and cancel are the Host's own envelopes and write nothing. No capability is minted or consumed and no TaskRecord, attestation or claim is touched.
- Both Hosts expose it (Pi Tool `retire_stale_batch`, Claude `unattended_batch` operation) with the same interactive-only rule as `start_unattended_batch`.
- `tests/batch-stale-disposition.test.ts` (12 focused tests) covers the serial and lane shapes, evidence preservation, both refusals, zero-write decline/cancel, adopt-after-move, and the invalid-state writer refusal.

### #165 surviving evidence

Reconstructed from the live tree and audit store on 2026-10-09: the `parallel-batch-lanes` batch record is no longer on disk, so the historical deletion actor and approval source remain unknown and are not asserted. What survives is the Git and audit evidence: children S1 and S2 carry `Immune-Brain-Batch` trailers from the batch runner; S3, S4 and S5 are manual commits with no trailer; all eight Kernel runs for those tasks are `done`; and the sibling batch records from the same period are still present. The disposition above makes this state recoverable without deleting evidence, but it cannot reconstruct a record that is already gone.

## Implemented repairs

- #179: archive durability checks use archive/legacy terminal evidence only. The retired active-freeze archive exemption is removed. Isolated fixtures cover absent, active, terminal, locked, corrupt and unreadable live SQLite; live authority cannot excuse missing or damaged archive evidence.
- #180: store rejection can carry release handoffs for integrated Lanes only when the Lane is clean, on the correct branch/repository, unoccupied, and its audit evidence survives integration. No provision or Executor authority is granted by rejection.
- #181: enrollment records Kernel run identity; fresh literal-user authorization may recover a resolved parked child only for that same run and Lane identity, with no open user decision or replan requirement. Existing commits remain intact. Historical Lane bindings without run identity stay parked. Changed plans remain refused.

## Validation

Focused checks passed: lane suite 38 tests (the multi-worktree supervision walkthrough has an explicit 20-second limit); complete plan reconfirmation suite 20; serial runner/plan suites 121; package/planner/contract suites 57. Earlier durability/archival, Pi and Claude authority, and completion-verifier runs also passed. `bun run typecheck`, generated-doc sync, fresh Claude bundle comparison and `git diff --check` passed.

Independent read-only review found and verified fixes for two boundaries: ownership must be checked after consumed slots are rehydrated on fresh authorization; release on rejection must verify current branch lineage and current-HEAD audit reachability. Regression controls use real registry slot consumption and a reset branch. No commit, push, Issue closure or deployment was performed.

For the 2026-10-09 disposition work: `bun run typecheck`, the new `tests/batch-stale-disposition.test.ts` (12 tests), the batch suites (`unattended-batch-run`, `batch-plan-reconfirmation`, `unattended-batch-lanes`, `unattended-contracts`, `pi-batch-authority`, `claude-batch-authority`, `claude-host-authority`, `claude-host-package`, `packaged-contract-tool-surface`, `kernel-storage-layout-migration`) and a fresh `bun scripts/build-claude-plugin.ts` bundle all pass. No commit, push, Issue closure or deployment was performed.

## Cross-project boundary

No refine worktree edits or Dev/Gateway operations were performed. #675 needs exact Vitest collection/execution/skip counts and a nonzero scan/positive control. #674 needs local timeout/cancellation/configuration evidence and separately authorized Dev article/Gateway validation. Missing evidence remains unknown rather than an asserted production failure.
