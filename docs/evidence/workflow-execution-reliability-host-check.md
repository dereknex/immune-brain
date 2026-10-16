# Workflow execution reliability — integration and installed-host check

## Outcome

**Incomplete pending S4 Assurance and final Parent disposition.** S1–S3 are settled and integrated. Revision-4 full release verification passes. Actual development-Claude Local Parent behavior has been observed and independently checked below, including the expected final failure; this does not prove live GitHub Issue resolution or flawless Executor compliance. No installed plugin was updated and no historical capture was rewritten.

## Revision and ownership

- Tested integrated HEAD: `bd8ad00118c727f4f5c4d80f35402c99e39d3a59`.
- S1 commit: `1ec9eb2b4a0d74f8b49207491541f4234aa7342e`.
- S2 commit: `15637abd3b97b741fb6ba9c0148d924d511da2a5`.
- S3 commit: `bd8ad00118c727f4f5c4d80f35402c99e39d3a59`.
- S4 run: `run-1910b918-73be-4dee-9fb3-6ec21f33cb0c`.
- The initial installation inventory below predates actual-host testing. Follow-up Sessions `35e42907-8844-43bd-8082-7cd29a7374fa` and `b3dfc5d8-7325-4bf1-9cdb-d83c9af94f2a` identify the new development-Claude observations; the latter resumes after the terminal projection repair.

## Automated integration

`bun test tests/goal-driven-run-contract.test.ts tests/goal-driven-run-recovery.test.ts tests/goal-driven-batch-run.test.ts`: **23 pass, 0 fail**. Existing coverage exercises Parent/isolated Child boundaries, critical tasks and descendants, failed final commands, repair authorization, preserved original delivery and final verification bound to integrated HEAD. No duplicate test was added merely to increase coverage counts.

S3 focused contract/protocol checks plus historical workflow decision evidence: **81 pass, 0 fail**; typecheck passed. These controls establish contract delivery and protocol behavior, not model obedience.

Initial `bun run verify:release` attempt: **not passed**. The foreground command exceeded its 600-second host timeout during the full test suite. Before termination, the log recorded 1,509 passing test lines and one failing test; those partial counts are not a completed suite result. No remaining `bun test`/`verify:release` process was observed afterwards. Pack dry-run was not reached. Version validation, bundle check, documentation parity and typecheck preceded the test stage successfully.

Observed failure: `tests/goal-driven-run-live-evidence.test.ts`, test `both actual Hosts preserve matching unattended scenario and Kernel delivery evidence`, line 19. It compares preserved historical capture hashes with live source. Read-only Git-object comparison confirms all historical source hashes matched planning baseline `c0954ab`, while seven paths differ at the integrated HEAD:

- `plugins/immune-brain/dist/claude/mcp-server.mjs`
- `plugins/immune-brain/dist/imm-run-batch.md`
- `plugins/immune-brain/dist/imm-run.md`
- `plugins/immune-brain/dist/role-prompts/executor.md`
- `plugins/immune-brain/runtime/prompts/executor.md`
- `plugins/immune-brain/runtime/unattended/batch_git.ts`
- `plugins/immune-brain/runtime/unattended/batch_lanes.ts`

This was a newly exposed historical-evidence coupling, not an unrelated pre-existing red. S4 revision 2 was approved through the native breaking-revision gate without changing the run, goal or acceptance assertion. It adds the evidence test and `tests/fixtures/goal-driven-run-historical-sources.json` to scope and adds the test to the focused QA descriptor. The sidecar's parsed canonical hash matches the committed revision: `sha256:dd5446d8e2750e219c713f2772a92cf27f9647fd60270ba2f22a1cfa63fb9008`.

The fixture preserves all 33 measured sources from Git revision `c0954ab`, after verifying every release-neutral hash against the original capture. The test checks the exact source-path set and all original hashes against those preserved bytes, retaining the scenario and Kernel proof assertions. Original capture SHA-256 remains `cc83ecadc0452ab7b2112285f0c2af346d99fe6ac0748335bc61333a912b4cb3`; it was not rewritten. Current-source checks and SCN-5 remain separate obligations.

Post-repair command: `bun test tests/goal-driven-run-live-evidence.test.ts tests/goal-driven-run-contract.test.ts tests/goal-driven-run-recovery.test.ts tests/goal-driven-batch-run.test.ts tests/workflow-behavior-evidence.test.ts && bun run typecheck`: **75 pass, 0 fail**, typecheck passed.

Post-repair full `bun run verify:release`: **passed, exit 0**. The full suite completed **2,585 tests across 189 files, 0 fail**, in 953.28 seconds; release validation and npm pack dry-run completed. A longer 1,800-second foreground limit was used after repairing the known failure, not as a substitute for repair. Local full log: `/tmp/imm-s4-release-r2.1GDaCQ` (ephemeral, not durable evidence). This result covers the current source/test/fixture changes at integrated HEAD `bd8ad001` plus the uncommitted S4 patch; it is not proof of a new Claude observation or final committed Parent HEAD.

## Installed Claude inventory (read-only; normal unreleased-source divergence)

- Claude Code executable: `/Users/derek/.local/share/mise/shims/claude`.
- `claude --version`: `2.1.300 (Claude Code)`.
- Registered plugin: `immune-brain@immune-brain`, user scope, version `5.5.0`.
- Installation root: `/Users/derek/.claude/plugins/cache/immune-brain/immune-brain/5.5.0`.
- Registry build commit: `25b3b631f12a24e4b4faef4047fe6d29bb2f3da3`.
- The registry is installation metadata, not proof of a running session's loaded bytes.

SHA-256 values below omit the `sha256:` prefix. Paths are relative to the plugin root.

| Path | Installed | Integrated workspace | Equal |
| --- | --- | --- | --- |
| `.claude-plugin/plugin.json` | `c37d97f7a6f2ff53b5ace1f4bf6665b93ff304bea8e2175ae6c1fac8c0501c13` | `b6adc712c56c9deed343e38305547a33ff179ec2aab8a829871e5dd073ae2726` | no |
| `skills/imm-run/SKILL.md` | `caa4657e96de275b7e11a3dad98f2f32e2987bd19ff71b451a33eb75eff023b0` | `caa4657e96de275b7e11a3dad98f2f32e2987bd19ff71b451a33eb75eff023b0` | yes |
| `dist/imm-run.md` | `73132e4696921fd15980366f210fd89530ac70764080427b89268472937d3154` | `941ff638c12dbfffcf4ba957266dbdead57b9ce20c2e30a764ce714586af7aa1` | no |
| `dist/imm-run-batch.md` | `cf8548b79b27691e9096c5cc2dce2571d87e40b68c17989cf4ba55beac008d4d` | `c5576707d8750461205b6710aecfe32146f36d0074fb47e1700abf7e1a2597e5` | no |
| `dist/role-prompts/executor.md` | `8661621239a6589dd074da5f52e32cf436b7344857f4c866b28b17bdfb8ad48c` | `278e97f1ae62b7ec7cb4429d905e8f6617b0bdb8159cf35635f363aa88937c10` | no |
| `dist/claude/mcp-server.mjs` | `667e9a5643e0c539cbbb102c17a803355c40920ee6c768bfaceb7e15eaaabe76` | `46f6e5dbd05bf8f8d0263fdd1453c9dcd26a538d92beb3b2004d22dee780f517` | no |
| `hooks/hooks.json` | `00cd183ca2d20520a8b9c35054116f0a3bf4e52471de4dccfdafe64e19d14d62` | `00cd183ca2d20520a8b9c35054116f0a3bf4e52471de4dccfdafe64e19d14d62` | yes |

## SCN-5: pending actual-host observation

The installed release and unreleased integrated source are expected to differ. This inventory does not establish an installation defect, and SCN-5 does not require a new release or replacing the installed cache. Claude Code 2.1.300 `--help` confirms `--plugin-dir <path>` loads a plugin for that session only. Use that supported development-load route in a designated disposable Initiative, verify the actual loaded plugin and Hook/MCP paths (including any same-name installed-plugin collision), and preserve native permission gates. A fresh interactive Claude model session requires authorization before launch; CLI help/version inspection did not start one.

The actual-host capture must identify the loaded build, host version and session ID, and observe Parent selection opening native batch authorization without a Child-selection chat question, critical handling retaining the Parent goal, and final verification failure not being reported as whole-plan success. Historical captures, automated test harnesses, this Pi run and installed-file hashes do not substitute for this observation.

The user authorized a development-Claude observation. Interactive terminal control is unavailable in this Pi session (`orca: command not found`); no non-interactive or permission-bypass substitute was launched. A disposable workspace was prepared at `/private/var/folders/zf/31fnphh957jc1gw0tmpsnl6h0000gn/T/imm-s4-claude-dev-h4lvt8zu/workspace`, outside the production repository. It contains the Local Initiative `scn5-dev-host`: routine alpha → critical Child → routine successor, with native gates retained and final verification intentionally exiting 7. All three candidate intents parse and their descriptors pass positive controls and reject negative controls; self-check outputs were removed. This is setup evidence only.

Initially reserved launch UUID: `e4845415-5300-47b1-b3c7-659abe4e9d36`. Actual subsequently designated observation: Claude Session `0ee3d014-b35f-4071-a5d0-4d59bc43bfce`, beginning at 11:34 UTC. Its raw transcript and the disposable repository's batch report confirm batch `batch-scn5-dev-host-597fe782-7f0d-42f1-b3b7-65fa35b58917` started with `bun -e process.exitCode=7`; alpha committed as `3303f592d56c067af7e798c4f124cc010255164b`, critical independently enrolled and passed QA/Review then committed as `374378913b527ca5b966d74ace68bf76a489103c`, and successor enrolled afterwards and committed as `879de855ac36db97941863f8c3cb80efc878e50e`. Final verification exited 7 on the last commit, with `passed: false` and an explicit Parent-incomplete reason. No repair candidate was started and no whole-plan success was claimed.

The ordinary batch's graph omits critical nodes by design (`batch_plan.ts` filters ordinary dependencies); the observed critical settlement/integration preceded successor Enrollment. This is not evidence of a dependency bypass. Local settlements did emit non-blocking tracker failures because there was no GitHub remote; adding a real remote is not a prerequisite for this fixture. The Stop Hook repeatedly requested repair despite the test's instruction to preserve the intentional failure and stop. Those repetitions are recorded as a handoff conflict, not successful repair behavior.

Development-build provenance remains unresolved for that Session: its tools read contracts under the installed 5.5.0 cache. The designated `claude-debug.log` records earlier development Hooks but ends at 11:31 UTC, before this Session began; it cannot establish this Session's MCP/Hook identity. No corresponding live process remained available for corroboration. Preserve this observation as real Claude behavior with unknown build identity, not as proof of the new development build. A Local carrier also cannot establish actual GitHub Parent Issue resolution; that portion remains explicitly unproven.

## Explicit development-build follow-up

A fresh, independently seeded disposable repository was prepared at `/private/var/folders/zf/31fnphh957jc1gw0tmpsnl6h0000gn/T/imm-s4-claude-provenance-t2gsv96l/workspace`, preserving the previous observation unchanged. Session UUID `35e42907-8844-43bd-8082-7cd29a7374fa` was supplied explicitly with `--plugin-dir /Users/derek/workspaces/immune-brain/plugins/immune-brain` and a new debug file. The system Terminal accepted the launch request. The resulting debug file confirms at 11:43 UTC that the supplied development directory is recognized and its plugin overrides the installed version. This is startup provenance only; MCP/Hook invocation identity, native authorization, task results and final-failure observation are not yet attested for this follow-up. The operator must respond to the actual native confirmations. No permissions were bypassed, no installed cache was changed, and no earlier failed batch was retried by automation.

## Terminal Lane projection repair (approved revision 3)

The designated development session `35e42907-8844-43bd-8082-7cd29a7374fa` stopped after alpha settled: the coordinator reported its QA stale. Comparing the signed Lane snapshot with the coordinator reconstruction showed identical base, scope and delivered blob/mode facts; only `repository_root` differed. Substituting the original Lane root reproduced the signed hash. No critical Enrollment was attempted, so this is a projection contradiction, not an observed Enrollment rejection. Do not rerun QA on the terminal task or rewrite its audit.

The native revision-3 gate approved `plugins/immune-brain/runtime/kernel/assurance_projection.ts` and `tests/kernel-assurance-projection.test.ts`, with the original S4 run and acceptance retained. The repair reuses proof-validated historical projection for committed and imported v4 terminal records. It does not change snapshot hashing, active task correlation, terminal proof validation, storage schema, or the batch's independent integration checks. Terminal status describes historical settlement, not a claim that a later checkout still has the delivered content.

Regression controls cover done/stopped from both the committed store and imported run-aware audit pairs, with a different checkout and later staged edits. Restoring the old imported-terminal projection reproduced two business failures (stale QA/Review); applying the repair yields 22/22 projection tests. The initial test-harness failure on unstaged edits was corrected before this business-red check and is not counted as regression evidence. Expanded regression (projection, batch commit, Parent contract/recovery, historical evidence and package) passed 147 tests; typecheck and bundle generation passed. Existing malformed-proof, active freshness and batch integration denials remain covered.

A read-only projection using the repaired source against the actual stopped fixture reports alpha `done`, `completion_ready: true`, fresh `AC1`/`qa`, no claim and no stale attestation. This required no QA rerun or evidence edit. It is a code-level control, not a substitute for reconnecting/restarting Claude's MCP to observe the repair through the host. The previously recorded full release pass predates revision 3 and must be rerun for this change.

## Revision 4: independent live-delivery validation at reconfirmation

The revision-3 full `verify:release` rerun failed: 2,574 pass, 15 fail, exit 1. All failures were in `tests/batch-plan-reconfirmation.test.ts`: the caller expected terminal status to expose a live diff hash. Terminal status now correctly answers historical settlement rather than current delivery identity. This is a regression in the initial repair, not a reason to weaken the tests.

Revision 4 adds `runtime/unattended/batch_reconfirmation.ts` and its existing test to the approved scope. It retains the independently computed `taskDeliveryIdentity` and uses existing `projectTask` with the current identity, current intent hash and risk floor to prove current delivery completion. The terminal projection separately verifies the settled run/intent/QA/Review facts. No snapshot hash, persisted schema, native capability or denial case changes. The sidecar's canonical hash is `sha256:9d291962258ccd34801f362a97f9ed6b0f191325a5d08550c5e702294e62a29a`.

Focused projection/reconfirmation regression: **42 pass, 0 fail**. This includes all previously failing cases plus stale delivery, wrong proof/identity, native refusal, concurrent claim, crash recovery and stopped/active-child rejection. Revision-4 `bun run verify:release`: **exit 0, 2,589 pass, 0 fail across 189 files**, 932.42 seconds for the test stage; typecheck, bundle/document parity and npm pack dry-run passed. The full command log is `/tmp/s4-revision4-verify-release.log` (ephemeral). This validates the S4 patch, not a final committed Parent HEAD.

## Independently verified development-Claude result

The designated follow-up workspace is the `imm-s4-claude-provenance-t2gsv96l` workspace above. After the projection repair, Claude Session `b3dfc5d8-7325-4bf1-9cdb-d83c9af94f2a` used `--plugin-dir` with the development root. Its `resume-after-projection-fix-debug.log` identifies the inline development plugin overriding installation, the MCP stdio connection at 12:12:25 UTC, and actual Hook commands executing the development `dist/claude/mcp-server.mjs`. `resume-parent-final-debug.log` separately confirms the same override and development Hook calls during final continuation. These are session-correlated runtime observations, not evidence borrowed from the earlier unknown-build Session.

Read-only inspection confirms batch `batch-scn5-dev-host-c4888f8b-5534-485d-9f36-7f021b7bb278` and its report preserve:

| Task | Integrated commit | Terminal event |
| --- | --- | --- |
| alpha | `a3aa7f58355c02d8d7b95f7b9c56952f2d5ed9ea` | `complete:scn5-alpha:2026-10-15T11:46:35.315Z` |
| critical | `995a10dcb2f253804b87e45131fe52f705361d28` | `complete:scn5-critical:2026-10-15T12:14:32.265Z` |
| successor | `7195b89c200da494631172144da88b6fab951813` | `complete:scn5-successor:2026-10-15T12:16:39.736Z` |

Critical used independent Enrollment and QA/Review; its integrated commit is retained as the adopted head from alpha to critical. Successor was provisioned at the critical commit and settled as run `run-4cb96e22-771f-431c-a6cc-b3056f0301f0`. The ordinary list's alpha dependency is the existing critical-node projection, not observed order bypass.

The report records `batch_state: completed` but `final_verification.passed: false`, command `bun -e process.exitCode=7`, exit 7, at integrated HEAD `7195b89c200da494631172144da88b6fab951813`; its reason explicitly says final verification did not pass. Report SHA-256: `c1d1a846c8932236d05d2120b9bcb4a937708a91804494ad8a288dae46fefc37`. No repeat verification, repair or Enrollment is needed to establish this negative observation. The operator ended the test continuation; the test Parent remains incomplete by design.

Limits and deviations:

- This is actual Local Parent routing, not live GitHub Issue resolution. Existing automated Parent/Child tests cover the latter contract; they are not relabelled as live GitHub evidence.
- The successor Lane's designated Session `f40a0e1d-88e4-4449-957d-4d8427219ff4` had a denied read of the development `dist/imm-run.md` (raw tool result: permission not granted). It continued using status/Stop directions and passed Kernel QA. That establishes output/settlement, not compliance with the required contract read. No broad permission grant or claim of flawless end-to-end execution is made.
- Stop Hooks requested repair after the intentional final failure and later paused on unchanged observations. The test did not start repair; this friction is retained rather than hidden or fixed outside scope.
- The host observation exercises revision-3 terminal projection. Revision 4 changes only zero-commit reconfirmation, not this already-committed Lane path; the latter change is proven by focused and full regression, not falsely attributed to this host session. Historical build hashes in the initial inventory/manifest are not asserted to be the restarted MCP bundle hash.

## Safe continuation

1. Revision 4 is now approved. The serial batch's old authorization cannot execute the revised plan: its three commits exclude zero-commit reconfirmation. Existing `batch_preflight.ts` explicitly supports a Kernel handoff for remaining children, preserving the record, reports, commit evidence and audits; do not re-enroll S1–S3 or manufacture batch trailers. Continue the original S4 Kernel run under its approved revision. Only after its live run settles may the drifted batch be retired using `retire_stale_batch` with native confirmation. Retirement preserves evidence and grants no new execution or completion authority; inspect the resulting Parent projection before deciding any further handoff. Do not edit batch state or claim the old batch completed.
2. Use session-only `--plugin-dir` development loading, not a formal release/update, after permission for a fresh Claude observation; record only the specifically designated session.
3. Present the bounded real-host observation and its deviations to S4 Review alongside fresh Kernel QA. Do not claim live GitHub validation or silently waive a manual requirement. Final Parent proof must still follow the supported disposition of the stale production batch.

No S4 settlement or Parent completion is claimed by this report.
