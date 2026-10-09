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

Remaining: refine PR #670's review log, per-file complete coverage reconstruction, and measured transfer-failure/recovery improvements. These are not proven by this change.

## Planning and plan drift (#178)

Planner guidance now explicitly traces deployment configuration copies, integration assertions, generated Claude bundle and release changeset. Existing caller/state-owner closure guidance remains in place.

Serial reconfirmation intentionally supports only zero recorded child commits with one revised settled child and immutable evidence. A changed plan after recorded progress stays refused with zero writes. The rejection now explains that the old authorization cannot execute the revised plan, preserves batch/report/commit/audit evidence and directs inspection of remaining Kernel runs before an explicit `imm-run` handoff. It does not terminate the old batch, re-enroll settled children, manufacture trailers or rewrite past approval.

Remaining: an explicit authority-backed disposition for the old batch after partial progress, and reconstruction of #165's surviving evidence. The historical deletion actor and approval source remain unknown. The new focused report test is a negative-control fixture, not a claim to validate historical commit evidence.

## Implemented repairs

- #179: archive durability checks use archive/legacy terminal evidence only. The retired active-freeze archive exemption is removed. Isolated fixtures cover absent, active, terminal, locked, corrupt and unreadable live SQLite; live authority cannot excuse missing or damaged archive evidence.
- #180: store rejection can carry release handoffs for integrated Lanes only when the Lane is clean, on the correct branch/repository, unoccupied, and its audit evidence survives integration. No provision or Executor authority is granted by rejection.
- #181: enrollment records Kernel run identity; fresh literal-user authorization may recover a resolved parked child only for that same run and Lane identity, with no open user decision or replan requirement. Existing commits remain intact. Historical Lane bindings without run identity stay parked. Changed plans remain refused.

## Validation

Focused checks passed: lane suite 38 tests (the multi-worktree supervision walkthrough has an explicit 20-second limit); complete plan reconfirmation suite 20; serial runner/plan suites 121; package/planner/contract suites 57. Earlier durability/archival, Pi and Claude authority, and completion-verifier runs also passed. `bun run typecheck`, generated-doc sync, fresh Claude bundle comparison and `git diff --check` passed.

Independent read-only review found and verified fixes for two boundaries: ownership must be checked after consumed slots are rehydrated on fresh authorization; release on rejection must verify current branch lineage and current-HEAD audit reachability. Regression controls use real registry slot consumption and a reset branch. No commit, push, Issue closure or deployment was performed.

## Cross-project boundary

No refine worktree edits or Dev/Gateway operations were performed. #675 needs exact Vitest collection/execution/skip counts and a nonzero scan/positive control. #674 needs local timeout/cancellation/configuration evidence and separately authorized Dev article/Gateway validation. Missing evidence remains unknown rather than an asserted production failure.
