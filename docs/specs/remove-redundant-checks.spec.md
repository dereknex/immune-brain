# Remove dead code and duplicate checks

**Status**: Candidate; not enrolled.
**Design risk**: Medium — S6 changes how the Review coordinator parses untrusted reviewer and verifier output; every other Slice deletes code no production path reaches, or prompt sentences whose rule a named code site already enforces.
**Execution posture**: characterization-first for S6 and S7 (pin the current outcome of every input whose check is removed or merged before deleting it); deletion-then-verify for S1–S5.
**Document language**: English, following the Planner document-language default.
**Source**: Issue #510 and its candidate inventory `immune-brain-remove-checks-analysis.md` (not committed; baseline `8282079e1d9473ff4ac49ea1fc2b47ac7222094f`), narrowed in a clarify session on 2026-11-14 and confirmed on 2026-11-15. Line anchors below were re-read on `855c004f6f3851dbc528e0fa5a9b4504260ebb9c`. Inventory item IDs (`I*`, `H*`, `PR1`, `B*`) refer to that inventory and are reproduced here with their anchor so this Spec stands alone.

## Outcome

Every change in this Initiative leaves observable behavior unchanged: no input that is rejected today is admitted with a different meaning, no rejection moves to another layer or error route, and no new side effect (dispatch, QA run, dialog, store write) appears. Within that bound:

- Production code that no production path reaches is deleted together with the tests that only protected it (S1–S4).
- Prompt sentences that restate a rule a named code site already enforces are deleted from the agent contracts (S5).
- Caller-side checks that duplicate a retained check, or that reject only fields the parser then discards, are deleted from the Review coordinator (S6) and the unattended batch layer (S7).

**No user-visible change**: each Slice removes unreachable code, restated prompt text, or a duplicated check; the set of accepted and rejected inputs at every public seam stays the same, except that S6 stops rejecting extra fields that the parser already drops before anything reads or stores them.

## User decisions

| ID | Decision | Source |
|---|---|---|
| U1 | Prompt text about the unchanged-observation stop states no number; the code constant `UNCHANGED_CONTINUATION_LIMIT = 1` (`runtime/assurance/run_continuation.ts:67`) stays the authority. | User reply "全部采用建议" to Q1, 2026-11-14. |
| U2 | #510 keeps only behavior-preserving deletions. Every REPL item and every NOW item that changes behavior moves to a separate proposal. | User reply "全部采用建议" to Q2, 2026-11-14. |
| U3 | Dedup rule: keep the check closest to the Kernel or storage and delete the caller-side early check. Under it, inventory §4's R8/#32 choice is reversed, and S9 moves out of #510. | User reply "全部采用建议" to Q3, 2026-11-14. |
| U4 | The inventory is a candidate index only and is not committed; anchors are re-read on main when each Slice is authored. | User reply "全部采用建议" to Q4, 2026-11-14. |
| U5 | Prompt deletions add no tests beyond one contract test plus an anchor table; code deletions add a test only where the retained check lacks coverage. | User reply "全部采用建议" to Q5, 2026-11-14. |
| U6 | Production-unreachable code is deleted first, in its own Slices, with the tests that only protect it. | User reply "全部采用建议" to Q6, 2026-11-14. |
| U7 | The legacy-format compatibility chain (`legacy_task_record.ts`, `sqlite_migration.ts`, `storage_layout_migration.ts`, about 1,540 lines) stays out of this Initiative and gets its own Issue. | User reply "全部采用建议" to Q7, 2026-11-14. |
| U8 | One GitHub Initiative, slug `remove-redundant-checks`, seven Slices S1–S7; S5 blocked by S1–S4; S6 and S7 blocked by S5. | User answer "按此确认并发布", 2026-11-15. |

## Planner corrections applied under the confirmed criteria

These items appeared in the confirmed manifest but fail the confirmed criterion (U2: no new side effect, same rejection route). The Planner moves them to the behavior-change proposal; no new user decision is introduced.

| Item | Evidence | Reason it leaves #510 |
|---|---|---|
| B2 incomplete `inspected_paths` subset/dedupe (`coordinator.ts:1088`) | The incomplete verdict goes to `record_review_incomplete` (`coordinator.ts:1885`); a Kernel rejection returns `blocked` with the error (`:1897`) instead of the parse-error route. | Rejection moves to another layer and route. |
| B3 rework with zero findings (`coordinator.ts:1142`), all-refuted routing (`verdict_authority.ts:378`) | `applyVerdict` runs `hooks.beforeCommit` and `commitInvocation` (`verdict_authority.ts:407-408`) before the Kernel rejects. | New side effect before rejection. |
| B8 `readChildVerdict` throws (`coordinator.ts:1062-1078`) | Without them a non-JSON string reaches `JSON.parse` or `Object.keys` with a different error text. | Error text and route change. |
| B9 `reviewer_model` / verifier model non-empty (`coordinator.ts:881-887`, `:2005`) | The retained site named in the manifest is the deleted code. | No retained check. |
| B10 `prepareReview` absent (`coordinator.ts:1754`) | Deleting it turns a named reason into a `TypeError` text in `review_preparation_failed`. | User-visible reason changes. |
| B12 `recordVerification` verified list empty (`verdict_authority.ts:456`) | `recoverKernelStoreFollowUps` and `commitInvocation` (`:458`, `:451`) run before the reducer rejects. | New side effect before rejection. |
| B1 at the child-verdict top level (`coordinator.ts:1096`) and in verifier output (`:966`, `:1006`) | `findings` is optional on a pass verdict (`:1131`), so a misspelled key would silently drop advisory findings; admitting more verifier output admits more refutations, which weakens Review (`:962`). | Silent loss of advisory findings; Review weakened. |
| B16 lane instruction / session close unknown-field rejection (`batch_lanes.ts:159`, `:201`) | `kind` defaults to `"instruction"` (`batch_lanes.ts:158`), so a misspelled kind key would send a correction as a plain instruction and spend no correction budget. | Silent semantic change. |
| B13 config "at most 8" (`layered_config.ts:150`), B14 `resolveLaneParallel` shape (`batch_lanes.ts:92-93`), B18 no-`.imm` fast path (`antigravity/lane_guard.ts:862`) | Rejection moves from config load to batch start (B13), from before the native gate to after it (B14, `lane_guard.ts:796`), or constructs `AntigravityRuntime` without proof that it writes nothing (B18). | Route or side effect changes. |
| I13, I19, I23 (`dist/drive.md:205-207, 250-252, 292-299`) | Their code enforcement is the breaking-revision user gate (`classifyIntentRevision`). | Removing the sentence makes a native dialog more likely. |
| SKILL H10 (`skills/authority-review/SKILL.md:201-205`) | Enforcement is at settlement (`coordinator.ts` contract-hash check); removing the early stop spends one full Review turn. | New side effect (a wasted Review run). |
| `integrateLaneCommit`, `NO_LOCAL_NAMES`, `loadLoopDispatches`, `enrollmentScopeDisclosure` | Each is a test seam over a production function. | Excluded as test seams, per the confirmed exclusion rule. |

## Threat model and supported environment

Threat model and supported environment: S6 parses reviewer and verifier output, which is untrusted model output; the adversary is a reviewer or verifier that emits extra fields or self-asserts approval identity. Every field this Initiative stops rejecting sits on an object whose meaningful fields are all required, so a misspelled meaningful key still fails its required-field check; the extra field itself is dropped, or overwritten with a coordinator-derived value, before the verdict reaches a capability or the Kernel. Reviewer bytes are kept only as `reviewer_verdict_sha256` (`review_mediation.ts:82`) and never reparsed by a stricter parser. All other Slices take no external input beyond the repository's own tooling. Supported environment: macOS and Linux with Bun, Git SHA-1 and SHA-256 object formats, UTF-8 text.

## Discovery evidence

- Unreachable-symbol scan: every `export` under `plugins/immune-brain/runtime/` counted by word references across `runtime`, `.pi-extension`, `hooks`, `bin`, `scripts`, `tests`, `docs/agents`, `dist/*.md` and `skills`, excluding the generated `plugins/immune-brain-antigravity/` and `dist/claude/` trees. A symbol counts as dead when its only references are its definition, tests, or the hash-bound historical fixtures.
- `tests/fixtures/goal-driven-run-historical-sources.json` and `tests/fixtures/decision-eval/**`, `tests/fixtures/review-eval/**` mention deleted symbols, but they are historical captures bound by `source_revision` and SHA-256 (`tests/goal-driven-run-live-evidence.test.ts:19-26`); they stay unchanged.
- Derived outputs: `plugins/immune-brain/dist/claude/mcp-server.mjs` (inlines `runtime/**/*.ts`), the `plugins/immune-brain-antigravity/` mirror (copies runtime, prompts, skills, `dist/*.md`), and `docs/reference/host-capability.md` (renders `runtime/claude/capability.ts`), all declared in `docs/agents/derived-files.json`. Deleting `kernel/canary_eligibility.ts` also removes its mirror output entry there (`docs/agents/derived-files.json:161`) and its import-map entry (`package.json:53`).
- `dist/drive.md`, `dist/drive-batch.md` and `skills/authority-review/SKILL.md` are canonical sources (no entry in `scripts/dist-sync-manifest.ts`); `runtime/prompts/executor.md` is mirrored to `dist/role-prompts/executor.md`. None of these four files changed between `8282079` and `855c004`.
- Risk floor: every touched runtime directory is `material` in `.imm/risk-floor.json`; nothing is `critical`, and `docs/agents/no-touch.json` is empty.

## Technical Design

Selected design views: **data flow** (S6: reviewer output → parser → rebuilt verdict → capability digest → Kernel) and **component interfaces** (S1–S4 exports, S7 traversal helper). Architecture layers, state transitions and temporal sequence are unchanged: no Slice adds, moves or reorders a state owner or a transition.

### S1–S4: production-unreachable code

Delete each listed symbol, any private helper that becomes unreferenced as a result (repeat until none remains), and every test case whose only subject is a deleted symbol. A test file whose every case goes is deleted; a test file with surviving cases keeps them.

| Slice | Symbol (file:line on `855c004`) |
|---|---|
| S1 | `runtime/kernel/storage_paths.ts`: `stateWorkspacePath:128`, `stateClaimPath:132`, `stateStoreLockPath:148`, `stateTransactionPath:152`, `batchCommitEvidencePath:225`, `LEGACY_CLAIM_RELATIVE:242`, `JOURNAL_RELATIVE:38`, `KERNEL_DB_SIDECARS:45`, `FILE_STORE_MIGRATION_MARKER:92`; `runtime/kernel/sqlite_store.ts`: `kernelStoreExists:239`, `readActiveRun:803`, `listTerminalRuns:810`, `readStoreBytes:1187`, `writeStoreBytes:1191`; `runtime/kernel/sqlite_migration.ts`: `inspectImportState:945`; `runtime/kernel/storage.ts`: `appendObservationJournalEntry:1265`, `terminalProofRunId:1493`; `runtime/kernel/risk_floor.ts`: `touchesChangedPathFloor:243`; `runtime/kernel/types.ts`: `TASK_ACTION_CONTRACT:366`; `runtime/kernel/backend_claim.ts`: `assertNoKernelBackendForV3:218`; the whole module `runtime/kernel/canary_eligibility.ts` (`evaluateCanaryEligibility`). |
| S2 | `runtime/assurance/review_evidence.ts`: `verifyReviewBundle`, `deleteReviewRef:623`; `runtime/assurance/qa_findings.ts`: `qaEvidenceFreshnessId:17`, `describeQaFailure:40`; `runtime/unattended/batch_state.ts`: `replaceBatchRunState:720`; `runtime/kernel/legacy_task_record.ts`: `assertKernelInvariantsV2:298`; `runtime/github_issue_tracker.ts`: `assertIsolatedTaskPrerequisites:870`; `runtime/workspace_scope.ts`: `workspaceDiffHash:213`, `replacementChangedFilesSinceSnapshot:906`, `changedFilesSinceSnapshot:959`, `assertCheckCommandsCiteExistingTests:1060`. |
| S3 | `runtime/claude/capability.ts`: `parsePermissionMode:33`; `runtime/claude/role_agents.ts`: `CLAUDE_NATIVE_AGENT_ROLES:81`; `runtime/loop_contract.ts`: `normalizeArchitectureExplorerOutput:399`, `normalizeAdvisoryReviewerOutput:418` (`ADVISORY_RESULT_INSTRUCTION` stays: `docs/reference/subagent-dispatch-protocol.md:190` names it as the protocol sentence). |
| S4 | `runtime/loop_daemon/repair_agent.ts`: `clearRepairAttempt:273`, `dispatchRepair:934`; `runtime/loop_daemon/leases.ts`: `heartbeatLoopLease:273`, `reclaimExpiredLeases:358`; `runtime/loop_daemon/plan_drafter.ts`: `parsePlanDigest:114`; `runtime/loop_daemon/identity.ts`: `capabilityRefusal:88`, `getCachedDaemonGithubLogin:102`; `runtime/loop_daemon/judgement.ts`: `MIN_CLASSIFIER_CONFIDENCE:39`; `runtime/loop_daemon/decision_relay.ts`: `DECISION_CHOICE_MARKER_PREFIX:40`; `runtime/decision_model/contract.ts`: `assertApplicationPointId:85`. |

`kernel/legacy_task_record.ts` loses only `assertKernelInvariantsV2`; the rest of the legacy chain stays (U7).

### S5: prompt sentences that restate enforced rules

Delete only the restating sentence; keep every neighboring sentence that carries a prompt-only rule. The PR carries this table with the enforcing site re-read on the merge base.

| File | ID | Sentence (anchor) | Enforcing site |
|---|---|---|---|
| `dist/drive.md` | I2 | freeze refuses unstaged/untracked and skip-worktree/assume-unchanged paths (`:66-67`) | freeze checks F2/F3 in the Kernel snapshot |
| | I3 | Kernel projection owns lifecycle, freshness, obligation; prose never overrides (`:86-88`) | Kernel CAS and freshness; `run_continuation.ts` pause |
| | I4 | "Three unchanged observations stop" — delete the number only, keep the stop rule (`:123-124`) | `run_continuation.ts:67,278` |
| | I5 | native-gate failures never auto-retry (`:125`) | native gate B4 |
| | I9 | in-scope tracked content must equal the frozen snapshot (`:156-158`) | QA drift check D1 |
| | I10 | material/critical need fresh independent Review (`:179`) | completion A1 |
| | I11 | submit rework verdict first; staging while frozen discards it (`:182-184`) | D1 + C33 |
| | I14 | fresh projection; never repeat a mutation to re-observe; CAS mandatory (`:216-220`, `:237-240`) | Kernel CAS |
| | I15 | Review retry authorization rules (`:224-228`) | C39 / E2 |
| | I18 | hard no-touch paths stay prohibited (`:249`) | `runtime/kernel/no_touch.ts:54-57` |
| | I22 | "The third native-operation failure ... pauses" — merge into I20, which states the same limit (`:268-270`) | same limit as I20 |
| | I24 | stale claim → `repair_authority_state`; native failure fail-closed with one recovery (`:310-314`) | B4 / C37 |
| | I25 | recovery is observation; `review_preparation_failed` keeps QA (`:315-320`) | `deriveAssuranceRecovery`, `reviewPreparationFailed` |
| | I27 | diagnostic caps: 16 KiB, no stdout/stderr, 2048-byte prepare tail, 64 drift paths (`:325-337`) | C3 / C4 / D1 |
| | I28 | quota/interruption is not budget exhaustion; malformed output is not a verdict (`:350-356`) | C45 / C48 / C49 |
| | I31 | tracker projection never blocks, never evidence (`:433-437`, `:475-476`) | `coordinator.ts:79-135` |
| `dist/drive-batch.md` | H2 | fresh literal-user authorization for parked-run recovery; repeated tick grants nothing (`:202, :208-209`) | D12 |
| | H3 | `runtime_reload_required` park and reload (`:214-221`) | D15 |
| | H4 | frozen acceptance is the authority subject; coordinator cannot approve revisions or reseal `plan_digest` (`:225-228`) | A15 + B14 |
| | H5 | changed topology refuses `plan_changed` (`:238-241`) | C15a + C24 |
| | H6 | contract mismatch refuses `batch_runtime_contract_mismatch` (`:243-249`) | D8 |
| | H7 | Lane edit/write outside the Lane is refused (`:253-256`) | G1 |
| | H9 | different `max_parallel` on resume refuses `batch_parallel_mismatch` (`:266-267`) | D16a |
| | H10 | review model/effort without `review_host` refused (`:283`, refusal clause only) | B2 |
| | H11 | instruction only to idle/done sessions (`:489`) | D6c / D6d |
| | H12 | at most two corrections per child (`:504-506`, limit clause only) | D14 |
| | H13 | Lane session close rule (`:530-535`, refusal clause only) | D7 |
| `skills/authority-review/SKILL.md` | H1 | manifest verification steps (`:10-13`, the verify list only; keep the Git invocation rules and the live-bytes prohibition) | coordinator packet `coordinator.ts:752-755` |
| | H5 | "return `incomplete` with `inspected_paths` and a single-line `reason`, without approval or findings" (`:124-125`) | coordinator packet `coordinator.ts:779` |
| `runtime/prompts/executor.md` | PR1 | "stopped or excluded work never counts as Parent success" (`:24`) | B1 / B12 completion conjunction |

Kept as prompt-only rules (must stay present): I1, I6, I7, I8, I12, I13, I16, I17, I19, I20, I21, I23, I26, I29, I30, K5, SKILL H10. H8 stays until `planLaneLeakRestore` is read; K9 stays until Enrollment's `enrollment_ready` check is proved.

### S6: Review coordinator parser (`runtime/assurance/coordinator.ts`)

Data flow: reviewer text → `readChildVerdict` → `parseChildVerdict` / `parseAssuranceVerdict` → `parseVerdictFindings` → `parseVerdictEvidence` → a verdict object rebuilt from named fields (`:1089`, `:1132`, `:1162`, `:1203-1220`) → `findingsDigestV2` / capability → Kernel. Every deleted check sits before a rebuild that keeps only named fields or overwrites the field with a coordinator-derived value.

| ID | Delete | Retained point |
|---|---|---|
| B1 | unknown-field rejection on finding evidence (`:1025`), `evidence.violated` (`:1045`), incomplete (`:1085`), pass approval (`:1129`) and finding (`:1200`); every field of these objects is required, so a misspelled meaningful key still fails | whitelist rebuild at each return (`:1089`, `:1162`, `:1202-1220`) |
| B4 | "rework verdict must omit approval" (`:1143`) | the rework return carries no approval field (`:1162`) |
| B5 | pass approval `kind` / `authority_role` self-assertion in `:1106` (keep the `summary` check) | approval rebuilt with the expected kind and role |
| B6 | `!finding.id.trim()` in `:1201` (keep `typeof finding.id !== "string"`) | id regenerated from snapshot digest and index (`:1202`) |
| B7 | duplicate verification finding identity (`:873-874`) | ids carry the finding index, so they are unique by construction |
| B11 | security-boundary path/line/commit revalidation and the second `git show` (`:859-869`); keep `if (!boundary) throw new Error("security boundary source is invalid")` so a missing boundary keeps today's message | `reviewSecurityBoundarySources` (`:822-842`), whose result is the only production input (`:2010` → `:2014` → `:901`) |

### S7: unattended batch layer

| ID | Change | Retained point |
|---|---|---|
| B15 | delete `positiveLimit` (`runtime/unattended/batch_schedule.ts:149-154`) and pass `maxParallel` through | `batch_state.ts:830` and `parseMaxParallel` (`batch_lanes.ts:100`) |
| B17 | merge the two topological traversals (`batch_preflight.ts:475-480`, `batch_schedule.ts:184-189`) into one shared helper; each caller keeps its own error text ("Initiative dependencies contain a cycle or unknown Task", "Initiative Task dependencies must form an acyclic graph") | the shared helper; `batch_authority.ts:170-208` DFS unchanged |

The throws in B17 terminate their loops; deleting either throw would loop forever on a cycle, so they merge rather than go.

### False-compromise check

No false compromise detected. The only accepted trade-off is that S6 now admits extra fields it discards, which is the confirmed criterion (U2) rather than a contradiction.

## Devil's Advocate Audit

- **Rollback resilience**: every Slice is one revertible commit series touching no persisted format. S6 changes no stored verdict bytes: the reviewer bytes already reach `verdict_sha256` unchanged and the rebuilt verdict carries only named fields, so a revert needs no data repair.
- **Verification vanity**: a grep that finds no symbol proves only absence; each dead-code Slice therefore also runs `bun run typecheck` and the surviving tests of the touched modules. S6 pins each relaxed input to a positive result and pairs it with a negative control that must still throw with today's message. S5's contract test checks both that removed sentences are absent and that the kept prompt-only rules are still present, so a sweeping deletion fails it.
- **Spec dilution**: the corrections table removes nine confirmed-manifest items with code evidence, all under the confirmed criteria; none of them is silently dropped, and all of them move to the behavior-change proposal.

## Acceptance and verification mapping

| Acceptance | Seam | Done looks like |
|---|---|---|
| RC-S1-A1, RC-S2-A1, RC-S3-A1, RC-S4-A1 | `sh -c 'grep -rnw --exclude-dir=fixtures "$@"; test $? -eq 1'` over `runtime`, `.pi-extension`, `hooks`, `bin`, `scripts`, `tests`, `package.json`, `docs/agents` | the grep finds none of the Slice's symbols and exits 1; an error exit (2) fails; S1 also requires `kernel/canary_eligibility.ts` to be gone |
| RC-S1-A2 … RC-S4-A2 | the surviving tests of the touched modules plus `tests/claude-host-package.test.ts` and `tests/antigravity-host-package.test.ts` | the surviving cases pass; the Claude bundle and Antigravity mirror match source |
| RC-S1-A3 … RC-S4-A3, RC-S6-A4, RC-S7-A3 | `bun run typecheck` | no remaining import, re-export or call names a deleted or changed symbol |
| RC-S5-A1 | new `tests/prompt-dedupe-contract.test.ts` | each S5 row's sentence is absent and each kept prompt-only rule is present |
| RC-S5-A2 | existing contract tests that read the edited sources, plus `tests/antigravity-host-package.test.ts` for mirror consistency | all pass with the edited sources and regenerated mirrors |
| RC-S6-A1 | `tests/pi-canary-assurance-authority.test.ts`, `tests/pi-canary-assurance-progression.test.ts` | an extra field on evidence, `violated`, incomplete, approval or finding parses and is absent from the result; an extra top-level child-verdict field still throws `unknown field`; a missing required field still throws its current message |
| RC-S6-A2 | `tests/pi-canary-assurance-authority.test.ts` | B4/B5/B6 inputs parse into the rebuilt values; non-string id and empty approval summary still throw |
| RC-S6-A3 | `tests/host-neutral-assurance-coordinator.test.ts` | B7/B11 verification packets match those built before the change for the same verdict; an unknown boundary ref still throws `security boundary source is invalid`; an extra field in verifier output still discards the whole output |
| RC-S7-A1 | `tests/unattended-batch-schedule.test.ts`, `tests/unattended-batch-lanes.test.ts` | a cycle and an unknown blocker are rejected by both callers with their current text; parallel groups are unchanged |
| RC-S7-A2 | `tests/unattended-batch-schedule.test.ts`, `tests/unattended-batch-lanes.test.ts` | `startableChildren` returns the same children for limits 1, 2, `Infinity` and above the child count; `parseMaxParallel` still throws for 0, -1, 1.5 and a string, which every production entry calls before scheduling (`host-core/mcp_runtime.ts:455`, `antigravity/lane_guard.ts:796`, `.pi-extension/imm-unattended-batch.ts:391`) |

## Out of scope

All inventory MUST KEEP items and the eight authorization boundaries; every REPL item; behavior-changing NOW items (moved to a separate proposal, including the corrections table above); Kernel and persistence-side checks kept under U3 (R8, R24, S12, F9/F10, S9, `validateLane` per-key fallback); C1/C2 (`reviewReworkFindings` has a second caller at `.pi-extension/imm-canary-work.ts:1836`); A14 (kept: `run_continuation.ts:243-244`); the legacy-format compatibility chain (U7).
