---
title: "Retired Python link disposition for docs/"
type: chore
date: 2026-07-24
---

# Spec: Retired Python link disposition for docs/

## Task

Dispose of the 228 broken `[text](url)` markdown links left in `docs/`, `plugins/immune-brain/`, and root `README.md` after the Python→TypeScript runtime retirement, plus the stale `key_files` frontmatter in `docs/solutions/contracts.md`. Produce a docs tree with no broken markdown link to a deleted file, with historical artifacts explicitly marked and their paths preserved as inline code (not silently deleted).

**Design risk**: Low — docs-only hygiene; no runtime, test, contract, ownership, security, or persisted-state mutation. Fully git-recoverable.

**Diagram decision**: not_required
**Diagram reason**: Docs hygiene contains no structure, sequence, data flow, or state-transition relationship; a per-document disposition rule in prose suffices.

## Origin

`imm-compounder` handoff after the link-fix batch (483 mechanical rewrites applied; 228 dead links to retired Python files remained with no 1:1 successor). `imm-advisory-reviewer` `docs` lens recommended routing non-trivial cleanup through `imm-planner` as a one-step plan.

## Disposition rule

Classify each dead-link source document, then apply the matching rule.

**Classification**
- `docs/plans/*.md` → historical (point-in-time artifacts).
- `docs/specs/*.md` containing dead `.py` links → historical (a current spec references TypeScript files; a spec referencing `.imm/*.py` describes the pre-migration Python era).
- `docs/solutions/*.md` → active durable hubs, unless the file is already marked `status: superseded` (then historical).

**D1 — Active hub `key_files` frontmatter**
Remove `key_files` entries that point at non-existent files. Where a TypeScript successor is already listed, drop the retired `.py` duplicate. Where no successor exists, drop the entry. Every remaining `key_files` entry must resolve to an existing file. Primary target: `docs/solutions/contracts.md` (70+ stale `.py` and `dist/.imm/*.py` entries; TS successors already listed alongside).

**D2 — Active hub in-body dead links**
For each dead `[text](url)` link to a retired `.py`, `.py` test, or deleted file in an active solution hub:
- If a clear TypeScript successor file exists and the link serves current navigation, rewrite the link to the TS path.
- Otherwise convert the dead markdown link to inline code (`` `path` ``), retaining the path as historical text, and add a `> Historical note` line to the enclosing section.

**D3 — Historical documents (plans + specs with dead `.py` links)**
Add a one-line banner immediately after the frontmatter:
`> Historical note: pre-TypeScript-migration artifact; file paths reference the retired Python runtime/tests.`
Convert each dead `[text](url)` link to inline code (`` `path` ``). Do not rewrite the document prose or restate the Python design.

## Non-goals

- Rewriting historical document prose to describe the TypeScript runtime (documents record past decisions; their prose stays).
- Re-implementing or recreating any retired Python file.
- Touching `upstreams/`, `node_modules/`, `.opencode-plugin/`, or `.imm/` runtime state.
- Silencing `detect-stale-refs.ts` residual reports that are glob wildcards or inline-text references rather than `[text](url)` links (e.g. the 175 `stale_skill_ref` inline mentions). Those are a separate docs-hygiene task.
- The 16 `broken_doc_link` glob false-positives (e.g. `docs/plans/*.md`, `055*.md`) — already inline code, not links.

## Success criteria

1. `bun scripts/fix-broken-links.ts --preview docs/ plugins/immune-brain/ README.md` reports `Dead links reported (NOT rewritten): 0`.
2. `docs/solutions/contracts.md` `key_files` frontmatter: every entry resolves to an existing file.
3. Historical documents (plans + affected specs) carry the `Historical note` banner; their retired paths survive as inline code (grep still finds the `.py` paths, just not as markdown links).
4. `bun test tests/active-runtime-docs-contract.test.ts tests/python-reference-boundary.test.ts` passes (no runtime doc-contract regression).
5. `git diff --check` clean.

## Verification implications

The primary check is `fix-broken-links.ts --preview` because it matches only real `[text](url)` links and can actually fail (it reports any remaining dead link). `detect-stale-refs.ts` is NOT the closure gate here because it matches text patterns broadly and carries pre-accepted glob/inline false-positives; it is used only as a secondary sanity sample.