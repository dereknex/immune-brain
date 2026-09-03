# Accept GitHub Issues with null bodies

## Task

Fix the GitHub Initiative tracker so repositories containing legitimate bodyless Issues do not block every tracker operation before mutation.

## Output Language

Spec prose is English. Schema fields, commands, paths, API names, and code identifiers remain literal.

**Design risk**: Medium

The code change is local, but it adjusts validation at the GitHub API trust boundary used before remote mutations. The plan therefore records the accepted wire shape, fail-closed behavior, compatibility, and verification explicitly.

**Design views**: Service/component interface and data flow are selected because the defect is the conversion from GitHub API JSON into the tracker's internal `GithubIssue` snapshot. Architecture layers, state transitions, and temporal sequence are omitted because ownership, lifecycle states, and mutation ordering do not change.

**Diagram decision**: not_required

**Diagram reason**: The affected flow is a single synchronous parse boundary and is clearer as an ordered list than as a diagram.

## Summary

GitHub's Issues API returns `body: null` for an Issue with no description. `parseIssues` currently requires every body to be a string, so one bodyless Issue makes `snapshot` return `permanent_failure`. Because every tracker operation snapshots before mutation, Initiative and Task publication are blocked even when the target Issue is unrelated.

Normalize only `null` Issue bodies to `""` at the API parsing boundary. Preserve strict rejection for missing bodies and every non-string, non-null body value.

## Origin

The failure was reproduced in Pi session `01a065ed-a15a-7beb-a06b-45aa9d6247d1` while planning against `nexttylabs/refine`. `imm-tracker create-initiative` returned `permanent_failure: gh returned a malformed Issue`; live read-only inspection confirmed existing Issues #472 and #473 return `body: null`.

## Research

Reference closure:

- `plugins/immune-brain/runtime/github_issue_tracker.ts`: `runGithubTrackerOperation` obtains a repository `snapshot` before dispatching `create-initiative`, `upsert-task`, or `mark-terminal`.
- `plugins/immune-brain/runtime/github_issue_tracker.ts`: `snapshot` paginates GitHub Issues and delegates each response page to `parseIssues`.
- `plugins/immune-brain/runtime/github_issue_tracker.ts`: downstream marker and ownership lookups consume `GithubIssue.body` as a string, so normalization belongs at `parseIssues`, not at every caller.
- `tests/plugin-package-runtime.test.ts`: `FakeGh` and the Parent creation tests are the highest existing behavioral seam. They observe whether a valid snapshot reaches creation and expose a mutation counter for fail-before-write assertions.
- `package.json`: the runtime source is shipped directly; there is no generated tracker mirror to update.

Relevant history:

- ADR-0004 preserves one host-neutral authority protocol but does not constrain this optional outbound tracker adapter.
- No ADR or rejected Learning specifies that bodyless GitHub Issues must be rejected.
- The recent tracker pagination change increased the number of repository Issues parsed but did not model nullable bodies.

Subagent dispatch was not used: this is a bounded single-module contract fix with a direct behavioral test seam (`trigger_not_hit`).

## Decisions

1. Accept `item.body === null` and normalize it to `""` while constructing `GithubIssue`.
2. Continue rejecting an absent `body` property and body values of any other type.
3. Keep `GithubIssue.body` as `string`; downstream marker matching and ownership checks require no nullable compatibility path.
4. Add a regression case to the existing tracker runtime test using a pre-existing bodyless Issue, then assert Initiative creation succeeds. This proves an unrelated legal Issue no longer blocks the snapshot-to-create path.
5. Keep the existing snapshot-before-mutation ordering and all remote-state confirmation behavior unchanged.

## Technical Design

### Interface contract

Input owner: GitHub REST Issues API response consumed by `GhTransport`.

Accepted body values:

- `string`: preserve exactly.
- `null`: normalize to `""`.

Rejected body values:

- missing/`undefined`;
- arrays, objects, booleans, and numbers.

Output owner: internal `GithubIssue`, whose `body` remains a required string. Existing callers continue using string marker searches without guards or compatibility adapters.

### Data flow and failure behavior

1. `runGithubTrackerOperation` validates the requested operation.
2. `snapshot` fetches repository identity and paginated Issues.
3. `parseIssues` validates each Issue and normalizes only `body: null`.
4. Marker lookup runs over the normalized snapshot.
5. The existing operation-specific code may mutate GitHub and then re-snapshot for convergence.

Malformed fields other than the documented nullable body remain `permanent_failure`. A bodyless Issue contributes no ownership markers and therefore cannot be mistaken for an Immune-Brain Parent or Child.

## Compatibility And Rollback

No migration, persisted-state change, TaskIntent schema change, CLI change, or GitHub marker change is required. Existing string bodies are byte-preserved.

If implementation or verification fails, revert the runtime and test changes together. Interruption before completion leaves the current fail-closed behavior; no repository or GitHub state is migrated. The change does not add a transitional compatibility layer.

## Verification

Run:

`bun test tests/plugin-package-runtime.test.ts`

The regression must seed `FakeGh` with a legal Issue whose API body is `null`, call `runGithubTrackerOperation` for Initiative creation, and observe `status: created` plus exactly the expected creation mutation. The existing tests in the same file continue checking malformed inputs, carrier conflicts, ownership markers, convergence, and fail-before-write behavior.

## Devil's Advocate Audit

### Rollback resilience

The implementation is one parser normalization and one test fixture. There are no partial data migrations or durable local writes. Reverting both files restores prior behavior; GitHub mutation ordering remains unchanged.

### Verification vanity

A source-text assertion would not catch the regression. The selected behavioral test fails on the current implementation because snapshot parsing returns `permanent_failure` before `FakeGh` records creation, and passes only when the legal nullable wire value reaches the existing creation path.

### Spec dilution detection

The plan does not replace strict parsing with broad coercion. It accepts only GitHub's documented bodyless representation, preserves all unrelated malformed-value failures, and proves actual operation progress rather than merely testing a helper in isolation.

## Executable Slice

One TaskIntent owns the complete result because parser normalization and its regression test share one contract, rollback, verification command, and remote-write trust-boundary invariant. Splitting them would leave either an unverified behavior change or a failing test-only artifact.
