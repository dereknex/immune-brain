# Runtime layering boundary tests

**Status**: Candidate; planning only.
**Design risk**: Low — the change adds and refactors test code only. No runtime module, persisted state, package surface, or Kernel/Port contract changes; the only new behavior is a test that fails on a forbidden import.
**Output language**: English, following the Planner document-language default.
**Threat model and supported environment**: None beyond the repository's own tooling. Inputs are repository-controlled TypeScript sources read from disk; the supported environment is the existing Bun toolchain on macOS/Linux with UTF-8 paths.

## Outcome

Issue #415: the layering rule from ADR 0004 Decisions 1 and 2 becomes a CI-enforced contract test. A contributor who adds an import from one host adapter into another, or from a host-neutral runtime module into any host adapter, sees `bun test` fail with output naming the importing file and the forbidden target. The five cross-host imports present on `main` today are carried as an exact-edge ratchet baseline owned by #413/#414, so enforcement lands now without changing any import.

## Evidence

| ID | Evidence |
| --- | --- |
| E1 | Cross-host imports on `main` `720a5131f`: `plugins/immune-brain/runtime/antigravity/kernel_ports.ts:1` → `../claude/kernel_ports`; `runtime/antigravity/mcp_server.ts:3` → `../claude/mcp_server`; `runtime/antigravity/interaction.ts:35` re-exports from `../claude/interaction`; `runtime/claude/kernel_ports.ts:115` → `../antigravity/capability`; `.pi-extension/pi-canary-assurance-progression.ts:58` → `../runtime/claude/review_host`. |
| E2 | No file under `plugins/immune-brain/runtime/` outside `claude/` and `antigravity/` imports `runtime/claude/`, `runtime/antigravity/`, or `.pi-extension/` (grep over `from` specifiers, same revision). |
| E3 | The Pi adapter lives at `plugins/immune-brain/.pi-extension/`, not `runtime/pi/` (CONTEXT.md Architecture Map, "Host integration"). |
| E4 | Adapters legitimately import `runtime/unattended/*`, `runtime/config/`, top-level runtime modules, and npm packages (`@earendil-works/pi-coding-agent`, `typebox`); CONTEXT.md names adapters as callers of batch execution. |
| E5 | Precedent: `tests/pi-canary-package-boundary.test.ts:23-41` already extracts static and dynamic import specifiers with regex over source and self-tests the extractor with inline strings (`:96-99`). `tests/kernel-r2c1-boundary.test.ts:102-111` asserts forbidden `from` patterns. |
| E6 | Import forms present in adapter source include `import type` (`runtime/claude/kernel_ports.ts:9`) and type-position `import("…")` expressions (`runtime/claude/mcp_server.ts:125`). |
| E7 | `tsconfig.json` does not include `tests/`; test files are checked by `bun test`, not `bun run typecheck`. |

## Decisions and provenance

| ID | Decision | Source |
| --- | --- | --- |
| D1 | Land the host-to-host assertion now with an exact-edge baseline of the five E1 edges, each tagged with its owning issue (#413 for the probe import, #414 for the other four). | BR-DEC-1 |
| D2 | The inner-layer lock covers every source file under `plugins/immune-brain/runtime/` outside the host directories, with zero allowed violations. | BR-DEC-2 |
| D3 | Host rule is a denylist between host directories; every other import is allowed, including any future neutral core location. | BR-DEC-3 |
| D4 | Type-only imports count as dependencies. | BR-DEC-4 |
| D5 | Host map: `claude` → `plugins/immune-brain/runtime/claude/`, `antigravity` → `plugins/immune-brain/runtime/antigravity/`, `pi` → `plugins/immune-brain/.pi-extension/`. | BR-REQ-2, E3 |
| D6 | Relative specifiers are resolved against the importing file's directory and classified by the host directory that contains the resolved path; bare specifiers (node builtins, npm packages) are never host targets. | BR-REQ-2 |
| D7 | Scan only `.ts` sources under `plugins/immune-brain/runtime/` and `plugins/immune-brain/.pi-extension/`. The generated `plugins/immune-brain-antigravity/` tree is excluded; `scripts/build-antigravity-plugin.ts --check` owns it. | BR-REQ-1 |
| D8 | Edge comparison is a pure function returning `unexpected` and `stale` edge lists, each rendered as `<importing file> -> <target module>` repository-relative strings, so the `bun test` failure diff names the file and target. The real-source test asserts both lists are empty. | BR-SCN-1, BR-SCN-2 |
| D9 | The shared specifier collector lives in `tests/helpers/import_specifiers.ts` and reports each specifier with its form; `tests/pi-canary-package-boundary.test.ts` keeps its runtime-specific filtering (including computed dynamic-import arguments) on top of the collector. | BR-REQ-8; delegated technical choice: one extractor, existing Pi semantics unchanged. |

## Technical notes

- Import forms the collector must report (BR-REQ-7): `import … from "x"`, `import type … from "x"`, `export … from "x"`, side-effect `import "x"`, `import("x")` calls, type-position `import("x").T`, and `require("x")`. Multi-line named-import lists must resolve to their `from` specifier.
- Completeness guard (BR-REQ-6) is also a pure function: given the host map and the scanned file list, it reports any host whose directory is missing or yields zero files. The real-source test asserts an empty report.
- Ratchet (BR-REQ-5): when #413/#414 remove an edge, the stale-entry failure forces the baseline line to be deleted in the same change.

## User scenarios

| ID | Scenario | Mapping |
| --- | --- | --- |
| BR-SCN-1 | Actor: a contributor. Given: a file under `plugins/immune-brain/runtime/antigravity/` gains an import from `../claude/` that is not in the baseline. When: they run `bun test`. Then: the suite fails with output naming the importing file and the forbidden target module. | automated: AC2 |
| BR-SCN-2 | Actor: a contributor landing part of #413. Given: they remove the `probeAntigravityHost` import from `runtime/claude/kernel_ports.ts` but leave its baseline entry. When: they run `bun test`. Then: the suite fails with output naming the stale baseline entry to delete. | automated: AC3 |

## Acceptance and verification mapping

| AC | Seam | Controls |
| --- | --- | --- |
| AC1 | `tests/runtime-layering-boundary.test.ts`: real-source scan of non-host runtime files | Positive: zero host-target edges. Negative: a fixture non-host file importing `../claude/x` is reported. Bound: a fixture importing `../unattended/x` or `node:fs` is not reported. |
| AC2 | Same file: real-source host-to-host edges vs baseline | Positive: observed edges equal the five-edge baseline. Negative: a fixture edge outside the baseline appears in `unexpected` as `<file> -> <target>`. Bound: an adapter import of `../../runtime/assurance/x` or an npm package is not an edge. |
| AC3 | Same file: edge comparison pure function | Negative: a baseline entry absent from observed edges appears in `stale`. Positive: identical lists yield empty `unexpected` and `stale`. |
| AC4 | Same file: completeness guard | Positive: all three real host directories exist and yield files. Negative: a fixture map naming a missing directory and one naming an empty directory are each reported. |
| AC5 | Same file: collector self-test | Each form in Technical notes is reported, including `../../runtime/claude/x`; a string literal that is not an import (for example `const s = "../claude/x"`) is not reported. |
| AC6 | `tests/pi-canary-package-boundary.test.ts` | Its existing assertions pass unchanged while it consumes `tests/helpers/import_specifiers.ts`. |

## Brainstorm Trace

| Item | Mapping |
| --- | --- |
| BR-REQ-1 | D7; AC1, AC2 |
| BR-REQ-2 | D5, D6; AC2 bound control |
| BR-REQ-3 | D2; AC1 |
| BR-REQ-4 | D1; AC2 |
| BR-REQ-5 | D8; AC3 |
| BR-REQ-6 | Technical notes; AC4 |
| BR-REQ-7 | Technical notes; AC5 |
| BR-REQ-8 | D9; AC6 |
| BR-DEC-1 | D1 |
| BR-DEC-2 | D2 |
| BR-DEC-3 | D3 |
| BR-DEC-4 | D4; AC5 (`import type`, type-position `import()`) |
| BR-OUT-1 | Out: no import changes; the five edges stay and are baselined. |
| BR-OUT-2 | Out: no new tooling or dependency. |
| BR-OUT-3 | Out: layering docs, prompts, ADR belong to #418. |
| BR-OUT-4 | Out: the #415 issue body is not edited by this task. |
| BR-DEFER-1 | Deferred: second assertion set (batch-execution sole ownership, dist-docs-sync boundary, `runtime/kernel/` → `assurance/`/`unattended/` direction). |
| BR-SCN-1 | AC2 |
| BR-SCN-2 | AC3 |

## Rollback

Delete the new test and helper and revert `tests/pi-canary-package-boundary.test.ts`; no runtime or persisted state is affected.
