# Whole-File Deletion & Declared Derived-Bundle Review Proof and ADR 0043 Advisory Cleanup

- **Status**: Candidate; no execution authority.
- **Task ID**: `review-deletion-bundle-proof`
- **Design risk**: Medium — modifies the shared `code-review` internal role contract (`plugins/immune-brain/runtime/prompts/code-review.md`), `STATIC_REVIEW_RULES` (`plugins/immune-brain/runtime/role_prompt_bridge.ts`), `dist/drive.md`, and packaged Claude/Antigravity/Pi review surfaces, affecting `currentReviewContractHash()` and `inspected_paths` admission rules across all three Hosts.
- **Design views**: service/component interfaces, data flow. (`architecture layers`, `state transitions`, and `temporal sequence` are omitted because no layer dependency, Kernel reducer state transition, or multi-step dispatch protocol changes: `record_review_incomplete`, `authorize_review_retry`, and `REVIEW_GIT_ALLOWED_TOOLS` remain unchanged.)
- **Threat model and supported environment**: Inputs are immutable Git commit trees (`base_head` and `review_commit`), `<review_commit>:docs/agents/derived-files.json`, `<review_commit>:.imm/risk-floor.json`, and settled deterministic QA outcomes inside a local repository; adversary is incomplete or unverified review coverage over unauthorized deletions, risk-floor removals, or unverified bundle drift; supported environment is macOS and Linux with Git (`--no-pager` read-only object commands), Bun, and UTF-8 repository paths.
- **Document language**: English (following BASELINE Output Language Policy; user-facing chat replies remain Chinese).

---

## 1. Outcome and Slice Horizon

This single-slice follow-up on `refactor-loop` (atop `b0d106e3cd4`) permanently lands the fail-closed **Whole-file deletion and declared derived-bundle proof** contract that unblocked `retire-loop-daemon`'s 332-path Review within the 96-turn ceiling, and resolves the non-blocking advisory finding (`review-02c22f5e2942-1-review-1`) recorded on `retire-loop-daemon` (`docs/specs/revisit-workflow-health.spec.md:35` citing deleted `docs/plans/review-verifier-eval-s1-metrics.intent.json`).

| Slice | Closable result when landed | Remaining gap after this Slice |
| --- | --- | --- |
| **`review-deletion-bundle-proof` (this TaskIntent)** | `code-review.md`, `STATIC_REVIEW_RULES`, and `dist/drive.md` define fail-closed read-only Git proofs for whole-file deletions and `derived-files.json` outputs using only `REVIEW_GIT_ALLOWED_TOOLS`; `revisit-workflow-health.spec.md:35` rewrites its dangling `docs/plans/review-verifier-eval-s1-metrics.intent.json` path to a historical bare-name citation matching line 34; focused contract tests and Claude/Antigravity/`dist/` mirrors & bundles pass with zero drift | ADR 0043 Slice 2 (`takt/gate/v1` CLI bridge) and Slice 3 (interactive single-task `/drive` decoupling and `runtime/unattended/` retirement) remain tracked separately as confirmed in `retire-loop-daemon.spec.md`. |

---

## 2. Discovery Evidence

- **Reviewer budget & allowlist boundary (`HEAD b0d106e3cd4`)**:
  - `plugins/immune-brain/runtime/assurance/coordinator.ts:715-720` caps `reviewTurnBudget` at `48` turns initially and `96` turns on retry (`reducer.ts:280`).
  - `plugins/immune-brain/runtime/role_prompt_bridge.ts:159-161,232-240` hashes `[loadRolePrompt("code-review"), STATIC_REVIEW_RULES]` as `currentReviewContractHash()` and requires reading every changed path's diff except Drizzle snapshots (`STATIC_REVIEW_RULES[6]`).
  - `plugins/immune-brain/runtime/prompts/code-review.md:111-148` defines `### Generated snapshot proof` solely for newly added Drizzle `migrations/meta/*_snapshot.json`.
  - `plugins/immune-brain/runtime/assurance/cli_review.ts:65-69` (`REVIEW_GIT_ALLOWED_TOOLS`) restricts the `claude-code` `authority-review` session exclusively to read-only `git` commands (`git show`, `git diff`, `git log`, `git cat-file`, `git rev-parse`, `git ls-tree`, `git grep`, with optional `--no-pager` and no `-C`, pipes, or redirection) plus `submit_session_result`. Any structural proof rule must therefore rely strictly on those allowlisted Git commands rather than `bun` or shell pipelines.
- **Derived-file manifest & packaged mirrors**:
  - `docs/agents/derived-files.json:1-95` (`immune_brain/derived_files/v1`) declares `sources[]`, `outputs[]`, `generate`, and `check` commands for `claude-mcp-bundle`, `antigravity-plugin-artifact`, and `host-capability-reference`.
  - `scripts/sync-dist-docs.ts:72-78` mirrors `plugins/immune-brain/runtime/prompts/code-review.md` to `plugins/immune-brain/dist/role-prompts/code-review.md`; `scripts/build-claude-plugin.ts:48-66` compiles `plugins/immune-brain/dist/claude/mcp-server.mjs` and generates `plugins/immune-brain/skills/authority-review/SKILL.md`; `scripts/build-antigravity-plugin.ts` syncs `plugins/immune-brain-antigravity/`.
- **Dangling citation advisory & single-Spec binding rule**:
  - Settled audit `.imm/audit/retire-loop-daemon/run-81d65786-8c38-4be9-8e2b-4c5efca138f6/task-record.json` (`approval-review-49140778`, advisory `review-02c22f5e2942-1-review-1`) notes that `docs/specs/revisit-workflow-health.spec.md:35` still cites `docs/plans/review-verifier-eval-s1-metrics.intent.json` (deleted in `b0d106e3cd4`), whereas line 34 already uses the bare historical name `review-verifier-eval.spec.md:476`.
  - Per `plugins/immune-brain/runtime/kernel/spec_binding.ts:84-95` (and `docs/specs/revisit-evidence-chain.spec.md:113`), `TaskIntent.scope_hint` may list at most one active `docs/specs/<name>.spec.md` path (`docs/specs/review-deletion-bundle-proof.spec.md`); `docs/specs/revisit-workflow-health.spec.md` is therefore authorized by `D2` / `AC2` and delivered as a documented `beyond_estimate` path (`ADR 0028`).

---

## 3. Technical Design

### 3.1 Service / Component Interfaces and Decisions

- **D1 — Add Fail-Closed Whole-File Deletion & Declared Derived-Bundle Proof Contract** *(Source: user-confirmed Option A & branch follow-up request)*:
  - In `plugins/immune-brain/runtime/prompts/code-review.md:111-149`, preserve `### Generated snapshot proof` verbatim (maintaining 100% compatibility with existing Drizzle snapshot guards) and add `### Whole-file deletion and declared derived-bundle proof` using **only** commands permitted by `REVIEW_GIT_ALLOWED_TOOLS` (`git --no-pager diff`, `git --no-pager ls-tree`, `git --no-pager show`, `git --no-pager grep`, with no `-C`, no pipes, and no redirection):
    1. *Whole-file deletions*: Eligible only when `git --no-pager diff --raw --no-renames <base_head> <review_commit>` shows status `D` with all-zero new OID and regular-file mode (`100644`/`100755`) in `<base_head>`, `git --no-pager ls-tree -r <review_commit>` confirms absence, the TaskIntent (`goal`/`scope_hint`/`acceptance`) or bound `Spec` authorizes removal (any deleted path matching `.imm/risk-floor.json` floor prefixes not explicitly named for removal in an acceptance assertion or bound `Spec` remains ineligible and requires `git --no-pager show <base_head>:<path>`), and `git --no-pager grep -n` across `<review_commit>` plus settled QA outcomes prove zero dangling imports, registrations, or live callers.
    2. *Declared derived bundles and mirrors*: Eligible only for non-deleted `outputs[]` declared in `<review_commit>:docs/agents/derived-files.json` (`immune_brain/derived_files/v1`) with explicit `sources[]`, `generate`, and `check` commands, after reading every changed non-derived input diff via `git --no-pager diff <base_head> <review_commit> -- <source_paths>`, verifying settled QA outcomes passed the entry's `check` command on this snapshot (otherwise falling back to full diff reading), and running `git --no-pager grep` on compiled `*.mjs` bundles for any retired identifiers prohibited by acceptance.
    3. Both proofs require naming `whole-file deletion proof` and/or `declared derived-bundle proof` in `approval.summary` before listing those paths in `approval.inspected_paths`, and fail closed to reading the full diff or returning `incomplete` when any step cannot be proved.
  - Update `STATIC_REVIEW_RULES[6]` in `plugins/immune-brain/runtime/role_prompt_bridge.ts:239` and `plugins/immune-brain/dist/drive.md:358-360` to reference the new proof alongside the existing Drizzle generated snapshot proof, then regenerate `dist/role-prompts/code-review.md`, `skills/authority-review/SKILL.md`, `dist/claude/mcp-server.mjs`, and `plugins/immune-brain-antigravity/`.
- **D2 — Rewrite Dangling `RVE-S1` Citation in `revisit-workflow-health.spec.md`** *(Source: user-confirmed branch follow-up request & `approval-review-49140778` advisory `review-02c22f5e2942-1-review-1`)*:
  - Update `docs/specs/revisit-workflow-health.spec.md:35` (delivered as an expected `beyond_estimate` path per `spec_binding.ts:84-95`) so the deleted path `docs/plans/review-verifier-eval-s1-metrics.intent.json` is written as the bare historical artifact name `review-verifier-eval-s1-metrics.intent.json` (noting retirement under `ADR 0043`, matching line 34's `review-verifier-eval.spec.md:476` convention).

### 3.2 Data Flow

1. **Build & Mirror Sync**: `runtime/prompts/code-review.md` + `runtime/role_prompt_bridge.ts` + `dist/drive.md` -> `sync-dist-docs.ts` -> `dist/role-prompts/code-review.md`; `build-claude-plugin.ts` -> `skills/authority-review/SKILL.md` + `dist/claude/mcp-server.mjs`; `build-antigravity-plugin.ts` -> `plugins/immune-brain-antigravity/`.
2. **Runtime Contract Hash & Dispatch**: `currentReviewContractHash()` computes deterministic `sha256` over `[loadRolePrompt("code-review"), STATIC_REVIEW_RULES]`; Pi (`buildReviewPrompt`) and Claude (`authority-review/SKILL.md`) deliver identical proof rules and guards to reviewers.

**False-compromise check**: No false compromise — reviewers never skip modified source/test/doc diffs, unauthorized deletions, risk-floor files not named in acceptance/Spec, or bundles lacking settled `check` verification.

---

## 4. User Scenarios

| ID | Actor | Given | When | Then | Mode | Acceptance |
| --- | --- | --- | --- | --- | --- | --- |
| `SCN-1` | Authority reviewer / Host runtime | The updated `code-review` prompt and `STATIC_REVIEW_RULES` are built into Pi and Claude review surfaces | `buildReviewPrompt` and `skills/authority-review/SKILL.md` are inspected | Both contain the complete `Whole-file deletion and declared derived-bundle proof` section, allowlisted `git --no-pager diff|ls-tree|show|grep` commands, `.imm/risk-floor.json` and `docs/agents/derived-files.json` fail-closed guards, and `approval.summary` disclosure requirements while keeping all Drizzle snapshot proof rules intact | `automated` | `AC1` |
| `SCN-2` | Repository maintainer | All mirrors, Host bundles, and `revisit-workflow-health.spec.md` are updated | Focused package/mirror sync checks and citation assertions run | `sync-dist-docs.ts --check`, `build-claude-plugin.ts --check`, and `build-antigravity-plugin.ts --check` pass with zero drift, and `docs/specs/revisit-workflow-health.spec.md` contains no dangling `docs/plans/review-verifier-eval-s1-metrics.intent.json` path | `automated` | `AC2` |

---

## 5. Acceptance, Agreed Seams, and Controls

- **AC1 — Fail-Closed Whole-File Deletion and Declared Derived-Bundle Review Proof Contract** *(Source: `D1`, `SCN-1`)*:
  - **Agreed seams**: `tests/generated-snapshot-review-contract.test.ts`, `tests/host-neutral-assurance-coordinator.test.ts`, `tests/cli-review-dispatch.test.ts`.
  - **Controls**:
    - *Positive*: Both `buildReviewPrompt` (Pi) and `plugins/immune-brain/skills/authority-review/SKILL.md` (Claude) embed `STATIC_REVIEW_RULES` and `code-review.md` including `whole-file deletion or declared derived-bundle proof`, allowlisted `git --no-pager diff --raw --no-renames`, `git --no-pager ls-tree`, `git --no-pager show`, and `git --no-pager grep` steps, `whole-file deletion proof` / `declared derived-bundle proof` `approval.summary` naming, and `dist/drive.md` links `#whole-file-deletion-and-declared-derived-bundle-proof`; all existing Drizzle snapshot proof assertions still pass.
    - *Negative*: Unlisted deleted paths matching `.imm/risk-floor.json`, unauthorized deletions, and derived outputs lacking settled `check` outcomes or `docs/agents/derived-files.json` provenance are explicitly excluded and fall back to reading the full diff or returning `incomplete`; `buildReviewBrief` omits `STATIC_REVIEW_RULES` while `buildReviewPrompt` includes every rule.
    - *Bound*: Proof commands reference only subcommands in `REVIEW_GIT_ALLOWED_TOOLS` (zero `bun`, `node`, `-C`, pipe, or redirection instructions in the new proof section).
  - **Done looks like**: Running `AC1`'s focused `bun test` command exits `0` and asserts every clause of `SCN-1`'s `Then`.

- **AC2 — Mirror & Host Bundle Parity and Retired Citation Cleanup in `revisit-workflow-health.spec.md`** *(Source: `D1`, `D2`, `SCN-2`)*:
  - **Agreed seams**: `tests/generated-snapshot-review-contract.test.ts`, `tests/claude-host-package.test.ts`, `tests/antigravity-host-package.test.ts`, `tests/dist-docs-sync-contract.test.ts`.
  - **Controls**:
    - *Positive*: `plugins/immune-brain/dist/role-prompts/code-review.md` matches `plugins/immune-brain/runtime/prompts/code-review.md`, `reviewerDefinitionDrift` is `null`, Claude and Antigravity plugin bundles pass parity checks, and `docs/specs/revisit-workflow-health.spec.md` cites `review-verifier-eval-s1-metrics.intent.json` with an ADR 0043 retirement note.
    - *Negative*: `docs/specs/revisit-workflow-health.spec.md` does not contain the deleted path string `docs/plans/review-verifier-eval-s1-metrics.intent.json`, and `sync-dist-docs.ts --check` / bundle checks report zero drift.
    - *Bound*: `docs/specs/revisit-workflow-health.spec.md` keeps its `#322` `D1`–`D10` decisions and `RVE-S1` provenance meaning unchanged.
  - **Done looks like**: Running `AC2`'s focused `bun test` command exits `0` and asserts every clause of `SCN-2`'s `Then`.

---

## 6. Devil's Advocate Audit

1. **Rollback resilience & interruption recovery**: Execution runs in an isolated single-task Lane (`imm/worktrees/review-deletion-bundle-proof/review-deletion-bundle-proof`) atop `b0d106e3cd4` without touching `retire-loop-daemon`'s committed history or `.imm/audit/` proof; full rollback after delivery is a single `git revert` of the follow-up commit.
2. **Verification vanity**: Checking prose substrings alone could miss drift between `runtime/prompts/code-review.md`, `dist/role-prompts/code-review.md`, `skills/authority-review/SKILL.md`, `dist/claude/mcp-server.mjs`, and `plugins/immune-brain-antigravity/`, or allow commands blocked by `REVIEW_GIT_ALLOWED_TOOLS`. `AC1` and `AC2` test live `buildReviewPrompt`, `reviewerDefinitionDrift`, `claude-host-package.test.ts`, `antigravity-host-package.test.ts`, `dist-docs-sync-contract.test.ts`, and cross-check proof commands against `REVIEW_GIT_ALLOWED_TOOLS`.
3. **Spec dilution detection**: Both user-requested follow-ups (permanent Review proof contract + `revisit-workflow-health.spec.md:35` advisory cleanup) are delivered completely in one coherent commit without weakening review coverage on modified source files or risk-floor paths.
