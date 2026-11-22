# Kernel-owned no-touch

**Status**: candidate; authored and structurally validated by the Planner. Validation is not execution or QA evidence, and this document grants no execution authority.
**Planning baseline**: `52f374d715`; recheck affected paths before Enrollment if HEAD changes.
**Document language**: English; user discussion remains Chinese.
**Design risk**: High — it changes a trust boundary every settlement, batch integration, TaskIntent validation and unattended guard consumes; no persisted schema or state machine changes.
**Design views**: component interfaces, data flow.

> **Amendment 2026-11-22 (user direction: "这个逻辑没有必要，帮我删除逻辑并清理文件").** The `docs/agents/no-touch.json` declaration (`immune_brain/no_touch/v1`) is retired: `readNoTouch`, `readNoTouchAt`, `parseNoTouch` and `NO_TOUCH_PATH` are deleted, `noTouchPaths`/`assertNoTouch` take no additions, and this repository's empty declaration file is removed. D2's hard-refusal declaration, D3, T1 and the declared-addition halves of AC2–AC4 no longer apply; the built-in `.imm/state` root (D1) is the whole hard no-touch set, and `.imm/risk-floor.json` remains the only project lever.

## Outcome and provenance

The Kernel's built-in hard no-touch set protects only what the Kernel itself owns: its worktree authority state root. Credential-type filename patterns and CI/release paths leave the built-in set. Protection of anything else is a project decision expressed through the existing declarations, so a confirmed task can change CI or similar files under ordinary Review instead of being forced outside Immune-Brain.

No Brainstorm manifest exists; direct Planner entry after a Chinese clarification exchange. Each decision and acceptance below names exactly one source.

| Source | Evidence, user direction or delegated choice |
| --- | --- |
| U1 | User direction, 2026-11-20: "移除这个硬性列表，只保护自身即可" — remove the built-in hard list; the Kernel protects only itself. |
| U2 | User direction, 2026-11-20: "从机制上进行解决" — fix the mechanism, not individual list entries. |
| E1 | `plugins/immune-brain/runtime/no_touch.ts:46-54`: `noTouchPaths` hard-codes `.imm/state`, `.github/workflows`, `.changeset/config.json`, `.env`/`.env.*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `.npmrc`, `.netrc`. |
| E2 | `plugins/immune-brain/runtime/kernel/storage_paths.ts:35`: `STATE_RELATIVE = ".imm/state"` is the Kernel's single worktree authority root; `.gitignore:11-16` keeps it ignored. |
| E3 | Consumers of `noTouchPaths`/`assertNoTouch`: `kernel/intent.ts:191`, `kernel/completion.ts:107`, `workspace_scope.ts:773`, `unattended/batch_integration.ts:363`, `kernel/enrollment_confirmation.ts:147-190`, `loop_daemon/guards.ts:191`, `loop_daemon/repair_agent.ts:181` (paths under `plugins/immune-brain/runtime/`). |
| E4 | `kernel/risk_floor.ts:225` keeps `.imm/risk-floor.json`, `.imm/routine-classes.json` and `docs/agents/no-touch.json` critical on change; `enrollment_confirmation.ts:148` and `guards.ts:191` refuse the no-touch declaration in unattended paths. |
| E5 | `git log -- .github/workflows` (`318d8023e1`, `52e0619090`, `934115b9c3`): routine CI maintenance in this repository is currently impossible under Managed execution. |
| E6 | `workspace_scope.ts:45,148`: `.imm/audit/` is tracked terminal evidence the Kernel itself commits into deliveries. |
| E7 | `docs/adr/0028-scope-as-estimate.md:33-35` (Decision 4) and `docs/specs/branch-boundary-r2.spec.md` D22 define today's list. |
| T1 | Delegated technical choice: keep the exported `noTouchPaths`/`assertNoTouch`/`readNoTouch`/`readNoTouchAt` signatures so all E3 consumers change behavior through one owner without edits. |

## Decisions

| ID | Decision | Source |
| --- | --- | --- |
| D1 | The built-in no-touch set is exactly the Kernel authority root `STATE_RELATIVE` (`.imm/state` and everything beneath it), imported from `kernel/storage_paths.ts`. `no_touch.ts` holds no path literal or filename pattern of its own; credential and CI/release patterns are deleted. | U1 |
| D2 | Protection follows ownership: the Kernel hard-refuses only state it owns. Anything else a project wants protected is declared with the existing mechanisms — `docs/agents/no-touch.json` for hard refusal, `.imm/risk-floor.json` for Review escalation. No new declaration format, no removal field; the declaration still cannot remove the built-in root. | U2 |
| D3 | Self-policy protection is unchanged: changing `docs/agents/no-touch.json` stays critical risk, and `policy_auto` Enrollment plus Loop guard G3 and the repair agent still refuse it. | E4 |
| D4 | One change point: consumers in E3 keep their calls; the Antigravity mirror and generated MCP bundles are regenerated through `docs/agents/derived-files.json`. | T1 |
| D5 | ADR 0028 Decision 4 is amended in place to the ownership rule; `branch-boundary-r2.spec.md` D22 stays as the historical record of the settled `diff-risk-no-touch` task. | E7 |

## Boundaries and non-goals

- `.imm/audit/` is not added to the built-in set: the Kernel commits it into deliveries itself (E6).
- This repository's own `docs/agents/no-touch.json` and `.imm/risk-floor.json` gain no entries in this task (U1 asks for removal only).
- No change to the risk floor, `policy_auto` risk cap, scope-as-estimate disclosure, or any persisted record shape.

**Threat model and supported environment**: Input is repository paths from Git diffs, rebuilt batch commits and TaskIntent `scope_hint`, produced by a possibly faulty or adversarial Executor or Loop session that may try to rewrite Kernel authority state or the project's own no-touch declaration. Supported: Git SHA-1 repositories with UTF-8 paths on macOS and Linux.

## Technical design

**Component interface.** `noTouchPaths(paths, additions)` returns the subset of `paths` equal to or beneath `STATE_RELATIVE` or any addition prefix. `assertNoTouch` throws `no_touch_path_changed: <paths>` on a non-empty result. Error codes, callers and the declaration contract `immune_brain/no_touch/v1` are unchanged.

**Data flow.** Changed or scoped paths → `noTouchPaths` (built-in root ∪ declared additions read at the base commit and in the working tree) → refusal at TaskIntent validation, single-task settlement, batch integration, `policy_auto` Enrollment, Loop guard G3 and repair validation. Paths outside the set flow on to the unchanged risk floor, which may raise Review strength but opens no gate.

## Devil's Advocate Audit

- **Rollback resilience**: The change is one module plus tests and docs; reverting the commit restores the old list. No record, migration or state written by the new behavior depends on it.
- **Verification vanity**: Each acceptance pins both directions at the real seam — formerly refused paths now deliver, integrate or validate, and `.imm/state/**` plus declared additions still refuse. A test that only checks the happy path would miss a regression that also drops the authority root; the negative controls catch it.
- **Spec dilution**: U1 is covered by AC1–AC3 (removal across every refusal surface), U2 by D1/D2 and AC3's declaration cases (protection only through ownership or declaration), and AC4 keeps unattended self-policy protection, so removal does not silently weaken the Loop.

## Acceptance mapping

| AC | Assertion summary | Seam | Source |
| --- | --- | --- | --- |
| AC1 | Single-task delivery of `.env`, `nested/.env.local`, `cert.pem`, `private.key`, `nested/id_rsa.pub`, `id_ed25519`, `.npmrc`, `.netrc`, `.github/workflows/ci.yml`, `.changeset/config.json` returns those changed paths; a force-added `.imm/state/x` still refuses with `no_touch_path_changed`. | `tests/no-touch-paths.test.ts` via `taskDeliveryIdentity` | D1 |
| AC2 | A Lane commit changing `.github/workflows/ci.yml` integrates and advances the Parent; one changing `.imm/state/x` or a declared addition refuses with `no_touch_path_changed` and leaves the Parent unmoved. | `tests/no-touch-paths.test.ts`, `tests/batch-merge-queue.test.ts` via `integrateLaneCommit` | D1 |
| AC3 | `intent validate` accepts a `scope_hint` of `.github/workflows/**` or `.env`; it rejects `.imm/state/x`, ancestor `[".imm", ".imm/state/x"]` and a declared addition with `no_touch_path_changed`; a declaration with a `remove` field is rejected naming the field. | `tests/no-touch-paths.test.ts` via `runKernelCommand` | D2 |
| AC4 | Loop guard G3 and `validatePathsInScope` allow `.github/workflows/ci.yml` and `deploy.pem`, and still block `.imm/state/loop/state.json`, `docs/agents/no-touch.json` and a declared addition. | `tests/loop-daemon-boundary.test.ts`, `tests/loop-daemon-repair.test.ts` | D3 |

## User scenarios

| ID | Actor | Given | When | Then | Mode | AC |
| --- | --- | --- | --- | --- | --- | --- |
| SCN-1 | Maintainer | A TaskIntent whose `scope_hint` is `.github/workflows/ci.yml` | They run `imm-kernel intent validate <path> --json` | The output reports `valid: true` with no `no_touch_path_changed` | automated | AC3 |
| SCN-2 | Maintainer | A TaskIntent whose `scope_hint` is `.imm/state/x` | They run `imm-kernel intent validate <path> --json` | The output reports `valid: false` naming `no_touch_path_changed: .imm/state/x` | automated | AC3 |

SCN-1 and SCN-2 are Spec-local, sourced to U1.
