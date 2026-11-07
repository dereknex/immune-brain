# Antigravity package delivery recovery

**Status**: Candidate; planning only.
**Design risk**: High — the complete package crosses host discovery, generated-output, versioning and release boundaries; recovery must retain independent assurance ownership.
**Output language**: English.
**Execution posture**: characterization-first; reuse the retained implementation as untrusted input and rerun package acceptance against the new frozen delivery.
**Threat model and supported environment**: Repository-controlled assets and a named local retained Git index; no hostile remote input or new provider access. macOS/Linux Bun, Node, npm and Git with UTF-8 paths (including spaces); native validation requires the previously observed `agy 1.5.1`. Windows wrappers and complete Antigravity Managed lifecycle certification remain outside the original package task.

## Outcome and boundary

Deliver the entire isolated Antigravity package into the user's checkout through a newly enrolled single-task Lane, including the two post-settlement fixes: nested Markdown reference closure and executable-mode repair. Preserve all six original package acceptance outcomes and obtain new QA and Review for the actual delivered bytes. A repair limited to the two small edits would omit the package itself: the coordinator checkout currently contains none of the retained implementation.

This is a standalone replacement delivery, not a successor Slice dependent on integration of the parked task. The old task's terminal record, audit evidence, intent and bound Spec remain unchanged. Neither a new task id nor a copied old approval authorizes delivery; the new task must pass its own Enrollment, QA, Review and batch final verification.

The native reviewer capability mismatch remains a known limitation of the original package boundary, not a repaired or certified workflow. Do not grant shell tools, copy source into a metadata-only review packet, change shared Review authority, or claim native review execution succeeds. State the limitation in the new artifact README and delivery report. A future request to make that workflow operational needs its own evidence-transport design.

## Discovery evidence

Paths prefixed `retained/` below mean the named local Lane:
`/Users/derek/workspaces/immune-brain/.git/imm/worktrees/antigravity-plugin-isolation/antigravity-plugin-isolation/`.

| ID | Repository or observed evidence |
| --- | --- |
| E1 | `docs/specs/antigravity-plugin-isolation.spec.md`, Outcome, D1–D7 and AC1–AC6: dedicated install root, complete dependency closure, five read-only native roles, one version authority, native validation; full Managed lifecycle certification is explicitly excluded. |
| E2 | Parent `start_unattended_batch` result in this session: batch `batch-antigravity-plugin-isolation-922458a0-c10d-42ff-a7d6-50a3f0e424de` is `needs_human`, child reason `batch commit drifted from the reviewed delivery identity`, no integrated commit, final verification null. `plugins/immune-brain/runtime/unattended/batch_git.ts:442` independently checks captured snapshot identity against the settled QA hash. |
| E3 | `retained/.imm/audit/antigravity-plugin-isolation/run-1fde37c4-cd68-4ca9-bee5-dae18f844a07/terminal-proof.json:1` records `done`; its `task-record.json` includes QA and Review approvals for that historical delivery. These are not approvals for subsequent edits. |
| E4 | `retained/scripts/build-antigravity-plugin.ts:239` writes then applies `chmodSync`; `:355` checks nested `dist/**/*.md`. `retained/tests/antigravity-host-package.test.ts:271` adds nested-doc/role-prompt link failures; `:417` checks lost executable bits and rebuild recovery. These are retained implementation inputs, not verified passes for a new task. |
| E5 | `retained/docs/reference/immune-brain-config.md:5` replaces an unshipped relative ADR link with a repository-location reference; `retained/tests/pi-only-current-contracts.test.ts:75` updates its contract assertion. Both packaged document copies must derive from the canonical source. |
| E6 | `retained/scripts/build-antigravity-plugin.ts:112` generates native definitions from the existing Claude role generators; `:48` permits only native file/search tools. `plugins/immune-brain/runtime/prompts/code-review.md:5` requires immutable Git commands and forbids copying source into the review envelope; `runtime/assurance/review_packet.ts:10` requires packet hash verification. Thus merely inserting source into the packet is not a compatible reviewer fix. |
| E7 | `retained/scripts/build-antigravity-plugin.ts:171`, `scripts/build-claude-plugin.ts:44`, `scripts/plugin_versioning.ts:74`, `scripts/dist-sync-manifest.ts:169`, `docs/agents/derived-files.json:31` and `package.json:33` trace build inputs, exported role generators, manifest stamping, self-authored packaged `revisit.md`, generated inventory and release checks. |
| E8 | Read-only Git inspection captured retained HEAD `297c5c999bb890e71729670bab4bbda11a016354`, zero unstaged diff bytes, and the complete staged implementation patch identity described below. The current coordinator worktree was clean before this planning entry. |

### Retained input identity

Capture the retained index patch as raw bytes using Git, without a pager or text rendering:

```text
git diff --cached --binary --no-ext-diff --no-textconv --no-renames HEAD -- . :(exclude).imm/audit/**
```

The pathspecs must be passed as literal arguments, not expanded by a shell. Observed patch length: `4999190` bytes; SHA-256: `ff6de60f52e10bc0d511a823102e027a8b912944a2ff1f9e7d5a7d0b90002581`. This includes original additions/deletions and the post-settlement edits, excludes old audit exports, and contains no runtime database. Check HEAD, patch digest and absence of unstaged changes before extracting input. Changed input requires bounded rediscovery and an explicit updated proposal, not silent adoption or deletion.

The patch is a recovery input, never an assurance artifact or a new authority owner. It remains local and is not sent to a model/provider by this plan. If this Lane disappears, stop with the missing-input evidence; do not reset branches or recreate user resources.

## Decisions and provenance

| ID | Decision | Exactly one source |
| --- | --- | --- |
| D1 | Use a new standalone task id `antigravity-plugin-isolation-recovery` and independently deliver the whole package; keep the parked batch and old terminal evidence intact. | Delegated technical choice: a terminal snapshot cannot authorize changed bytes. |
| D2 | Reuse the digest-bound retained implementation only as input inside the new runtime-created Lane. Do not copy `.imm/`, `.git`, old TaskIntents or old audit evidence into the new task, and never implement in the coordinator. | E8. |
| D3 | Preserve the original install-root, role/tool, dependency-closure, native-validation and version/release behavior. Retain a single package release note rather than add a second entry for the same change. | E1. |
| D4 | Require nested Markdown link validation and executable-mode repair, with their existing fixture seams. Fix newly exposed links at their canonical authoring source; regenerate mirrors. | E4. |
| D5 | Document the native reviewer limitation without changing Review transport, shell capability or the metadata-only envelope. No success claim for a real native model review follows from package tests. | E6. |
| D6 | Freeze only after all implementation, mirror generation and required local checks. After settlement make no implementation edit: integrate precisely that reviewed snapshot; subsequent defects need a new owner. | E2. |

## User scenarios

These scenarios conserve the user's original package repair request, as recorded by E1, and its resumed delivery in this session.

| Scenario | Observable result | Mapping |
| --- | --- | --- |
| SCN-1 | Install the new root from the npm artifact, discovering all five native definitions and public skills, with Pi/Claude roots preserved. | automated: AC1, AC4, AC5 |
| SCN-2 | Run hooks, MCP discovery and read-only CLI commands after relocating the artifact to a path with spaces and no repository siblings. | automated: AC2, AC3 |
| SCN-3 | A nested contract link failure or lost executable bit is detected; rebuilding repairs permissions and produces a closed, consistent artifact. | automated: AC7 |
| SCN-4 | The official native loader validates the delivered artifact without warnings; this result makes no native Managed Review claim. | automated: AC6; capability limitation is disclosed, not marked as workflow certification. |

## Technical Design

**Design views**: package ownership, build interfaces, and recovery sequence. No Kernel schema, authority protocol or persisted transition is added.

### Package ownership and interfaces

Keep `plugins/immune-brain/` as the Pi/Claude and shared canonical source root. Keep `plugins/immune-brain-antigravity/` as the isolated native artifact. The retained Antigravity builder owns generated runtime/CLI/skills/contracts/role definitions and bundle outputs; its explicit canonical files remain hand maintained. Shared runtime copies are derived bytes, not a second independently maintained implementation.

Trace and carry the complete implementation through `scripts/build-antigravity-plugin.ts`, exported generators in `scripts/build-claude-plugin.ts`, `scripts/plugin_versioning.ts`, `scripts/dist-sync-manifest.ts`, `docs/agents/derived-files.json`, root npm files/release checks and the corresponding package assertions. Delete the obsolete shared-root Antigravity manifest/config/hooks/bundle atomically. Preserve Pi/Claude entrypoints and tests. Native reviewer/verifier retain their strict read-only tool boundary and shared prompts.

`buildAntigravityPlugin(root)` must explicitly restore intended file modes even when a destination exists. `checkAntigravityPlugin(root)` remains read-only and detects changed/missing/stale outputs and mode drift. `artifactClosureErrors(artifact)` checks public skill links and all Markdown below `dist/`, including `dist/docs/**` and `dist/role-prompts/**`, and rejects the named missing/escaping/symlink fixtures. These are existing interfaces, not new wrappers.

Apply reference repairs at `docs/reference/immune-brain-config.md` and self-authored `plugins/immune-brain/dist/revisit.md` as traced by the sync manifest; rebuild the downstream copies. A source-repository document that is not shipped is identified as a repository path rather than a broken artifact hyperlink. Do not loosen the new closure check or remove the negative tests.

### Recovery and delivery sequence

1. On literal-user `drive`, the runtime admits the new task through its single-task Lane and native gate. The old batch is not a prerequisite Slice and grants no authority to the new Lane.
2. Verify the retained input identity. Extract/reapply only its implementation diff in the new admitted Lane, respecting deletions and executable bits. The Executor owns exact path selection and checks base compatibility. Never overwrite unrelated coordinator or retained-Lane edits. Do not use `git reset`, manual worktree creation, or old approval imports.
3. Regenerate owned outputs from the new Lane's canonical sources. Extend the artifact README to disclose the reviewer capability limitation and absence of lifecycle certification; cover the disclosure at the package test seam without asserting that a model obeys it.
4. Run focused acceptance diagnostics and mandatory native validation, plus both host build checks, docs sync, version validation, `bun run typecheck` and the full `bun test`. Recover ordinary local failures in scope; a missing validator or unrelated failure blocking a required command means incomplete, never skip/pass.
5. Stage exact owned paths and freeze; obtain fresh deterministic QA and independent Review under this new task/run. Integrate/deliver only the settled bytes through the batch runtime, then run the recorded `bun test` and `bun run typecheck` final checks. `manual` delivery is staged and uncommitted in the user's checkout.
6. Report new task evidence, delivered identity and final verification. The original batch stays parked historical state; do not claim it integrated. Its optional later retirement and retained-Lane cleanup belong to the native retirement/user cleanup flow and are not required to deliver this replacement. Never delete that Lane while its interactive Host remains open.

Interruption resumes the new task's actual authority facts; it never replays the old batch against modified files. If the import does not apply or the recorded input moved, preserve both copies and report the specific blocker. Native-gate failure follows its same-Host recovery action. The new task does not repair batch internals or bypass the drift check.

Rollback before new settlement leaves the original source Lane and terminal evidence untouched. A failed check leaves the new Lane recoverable. No settings, installed plugins, credentials or remote refs change. The imported patch is disposable extraction output owned by the Executor: delete only its own temporary copy after successful application or failure handling; the retained source remains until user cleanup.

## Acceptance and verification

AC1–AC6 retain the original six package outcomes, including their negative controls. Descriptor prerequisites are QA-host Bun, Node, npm, Git and installed repository dependencies; no descriptor installs dependencies, uses credentials or invokes a real model. AC6 additionally requires the native validator on PATH. Fixtures use isolated temporary paths and clean their own output; missing prerequisites or zero matched required tests fail. All descriptor paths are project-owned seams, some currently present only in the retained input and delivered by this task.

| Acceptance | Exactly one source | Focused seam and controls |
| --- | --- | --- |
| AC1 | E1 | `tests/antigravity-host-package.test.ts`: dedicated manifest, five native role definitions and skill inventory; no Claude/Pi loader components, string-valued tools or shell/write/invocation capabilities. Transitive runtime/claude implementation remains allowed. Test package README disclosure of the native reviewer limitation without treating text as model-behavior proof. |
| AC2 | E1 | Same file: each hook runs from a relocated path with spaces, PLUGIN_ROOT absent and isolated non-authorizing input; MCP resolves its bundle; missing bundle yields nonzero launch. |
| AC3 | E1 | Same file: relocated contract/runtime/role-prompt closure and actual CLI/MCP subprocesses. Missing contract/dependency/prompt, symlink and escaping references fail; no sibling repository is supplied. |
| AC4 | E1 | Same file plus `tests/pi-only-release-contract.test.ts`: complete npm inventory, original entrypoint removal, version stamp/validation and generated output integrity. Missing/mismatched manifest, changed source, missing output and stale output are rejected; repeat generation is deterministic and check-only leaves inputs/index unchanged. |
| AC5 | E1 | `tests/claude-host-package.test.ts`, `tests/pi-only-package-surface.test.ts`, `tests/pi-only-release-contract.test.ts`, `tests/antigravity-assurance-conformance.test.ts`: preserve existing host loading, package exclusions, reviewer and authorization assertions, updating only expectations required by this package change. |
| AC6 | E1 | `agy plugin validate plugins/immune-brain-antigravity --strict --json`: zero exit/errors/warnings, CLI absence fails; AC1 independently disallows a misleading zero-role pass. |
| AC7 | E4 | `tests/antigravity-host-package.test.ts` and `tests/pi-only-current-contracts.test.ts`: nested `dist/docs` missing link and nested role-prompt escaping link fail; complete relocated artifact passes; a 0644 wrapper fails mode check and rebuild restores executability; canonical ADR-reference repair preserves config contract assertions and mirrors. |

AC1–AC7 prove package behavior on the newly frozen content. Fresh QA/Review, unchanged settlement-to-integration identity and passing batch final commands separately prove Managed delivery. Previous reported passes and the original terminal record do not satisfy either requirement.

## Completeness and remaining gap

No upstream Brainstorm manifest was supplied. One Slice, `antigravity-plugin-isolation-recovery`, owns the entire independently installable artifact and its fresh delivery; splitting closure, modes or package integration would leave a non-deliverable intermediate result.

| Required item or phase | Single mapping | Planned result |
| --- | --- | --- |
| Original discovery, role inventory, package documentation | AC1 | Full isolated artifact; no manifest-only substitution. |
| Original executable paths | AC2 | Relocated configured commands work. |
| Original dependency/reference closure | AC3 | No external sibling or symlink supplies dependencies. |
| Original npm/version/generated-output delivery | AC4 | Complete reproducible release inventory. |
| Original host regressions | AC5 | Pi/Claude contracts remain protected. |
| Original official native validation | AC6 | Native strict loader validation. |
| Post-settlement closure and executable-bit fixes | AC7 | Actual failure controls and rebuild recovery. |
| Drifted delivery recovery and final verification | Recovery sequence, stages 1–6 | Freshly assured new delivery, without rewriting old authority. |
| Reviewer capability concern | D5 and AC1 disclosure | Explicit existing package limitation; no new transport, tools or lifecycle-success claim. This was outside E1's full-lifecycle boundary and remains unresolved operationally. |

Remaining gap at planning handoff: candidate execution, every new acceptance result, independent Review and checkout delivery are pending. No existing task completion is evidence that this new result is ready to ship. The parked old batch and retained interactive Lane are preserved resources, not hidden automatic cleanup work.

## Devil's Advocate Audit

- **Rollback resilience**: recovery never mutates the old store or resets either worktree; new implementation and local temporary extraction remain isolated until runtime delivery. A source identity mismatch stops import. There is no migration or compatibility shim to retire.
- **Verification vanity**: full-package acceptance is repeated instead of checking only the two small fixes; zero native warnings cannot replace the five-role inventory; static README assertions are explicitly not real model or lifecycle evidence. Final full-suite/typecheck commands remain required even if focused tests pass.
- **Spec dilution detection**: reject copying old approval evidence, ignoring missing agy, weakening nested link or mode tests, certifying the native reviewer, changing the metadata-only Review contract, making an implementation edit after settlement, or bypassing the old delivery hash. These would invalidate this candidate's boundary rather than shorten recovery.
