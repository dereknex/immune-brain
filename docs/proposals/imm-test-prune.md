# imm-test-prune：测试膨胀治理 Skill 契约草案

状态：草案，来源于 [dereknex/immune-brain#205](https://github.com/dereknex/immune-brain/issues/205)。尚未接入 `skills/registry.yaml`、`plugins/immune-brain/`、dist 同步或任何测试；不创建 Managed authority。正式落地需经 `imm-planner` 写 TaskIntent 并通过 Enrollment。下方英文部分为拟放入 `plugins/immune-brain/dist/imm-test-prune.md` 的契约正文，结构沿用 `imm-doc-prune` 与 `imm-doc-slim`。

## 落地前待决问题

1. **与 `imm-doc-prune` 的边界**：doc-prune 的 Mutation Envelope 已允许删除"只断言文档存在或旧措辞"的测试。草案选择：纯文档措辞测试仍归 doc-prune，本 Skill 遇到时标 `DEFER_DOC_PRUNE`，不处理。需在落地时同步修改 doc-prune 契约中的交叉引用。
2. **覆盖证据来源**：`bun test --coverage` 只给文件级 / 行级汇总，不给 per-test 覆盖。草案把"被其他测试包含"降级为需要人工确认的 `UNVERIFIED` 候选，除非逐个用例单独运行得到覆盖证据。是否引入 mutation testing（如 StrykerJS）属依赖变更，不在本 Skill 内决定。
3. **首个切片**：建议先单独完成"5 个测试文件中硬编码技能名数组改为从 `registry.yaml` 派生"，再接入本 Skill，以降低接入成本并验证方法。
4. **生成阶段约束**（单行为、不镜像实现、先查已有覆盖）不属于本 Skill，落位到 AGENTS.md、Executor role prompt 与 Review 检查清单，另立切片。

---

```markdown
---
name: imm-test-prune
description: Use when the user explicitly requests Immune-Brain audit or pruning of redundant, bloated, or orphaned tests.
---
```

# Immune-Brain: Test Prune

Reduce test-suite bloat in one Git repository through explicit invocation,
comprehensive test inventory, evidence-based candidate narrowing, one exact
user-approved manifest, and bounded test-only mutation that never weakens a
live guarantee. This is a standalone host-native maintenance entry, not a
Managed Path continuation and not an `imm-run` internal-role dispatch.

## Authority Boundary

This Skill restructures and prunes tests without creating or mutating
TaskIntent, TaskRecord, Kernel, Spec, or Plan authority. An already active
Managed task remains owned by `imm-run`. Read-only inventory and manifest
production remain available. Classify each candidate overlapping the active
TaskIntent `scope_hint`, or named by an active acceptance descriptor's
verification `argv`, as `BLOCKED_ACTIVE_SCOPE` and continue auditing
unaffected candidates. If the routing owner or scope cannot be read reliably,
fail closed for mutation. This Skill does not invoke `imm-doc-prune`; tests
whose only behavior is asserting document existence or wording remain that
Skill's job and are reported as `DEFER_DOC_PRUNE`.

## Invocation

Requires explicit invocation: `imm-test-prune` or `/imm-test-prune`. Ordinary
"is this test redundant?" questions and routine test maintenance during a
change stay host-native and do not enter this Skill.

- `imm-test-prune audit`: read-only. Produce the manifest and stop.
- `imm-test-prune`: produce the manifest, then wait for exact manifest
  approval before any mutation.
- An optional path argument narrows inventory to the named test files or
  directories; the evidence rules still read the whole repository.

No automatic invocation. No daemon, no cron, no CI gate, no allowlist, no
runtime, no persistent report, no dependency installation, and no automatic
commit.

## Ordered Pruning Protocol

### Inventory and Manifest

1. **Establish repository safety.** Mutation requires a Git worktree. A
   non-Git repository or an untracked candidate is audit-only. Record each
   candidate path, blob/content hash, tracked status, candidate-local
   worktree status, line count, and test-case count. Unrelated dirty files do
   not block the run; a dirty candidate is `BLOCKED`.

2. **Record the baseline.** Run the repository's own test command over the
   inventoried scope once and record pass/fail per file and wall time. A file
   already failing at baseline is `BLOCKED` for mutation and reported; this
   Skill never repairs or deletes a failing test to make the suite green.

3. **Inventory tests and support code.** Enumerate tracked test files,
   fixtures, helpers, and snapshots. Exclude `node_modules`, vendor trees,
   build output, and caches.

4. **Classify test roles.**
   - behavior: asserts runtime or public-surface behavior;
   - documentation contract: asserts document existence, wording, links, or
     sections;
   - packaging and mirror consistency: asserts that registries, generated
     output, and packaged copies agree;
   - historical evidence: protects readers of frozen or archived authority
     evidence;
   - `UNCLASSIFIED`: grouped, not interrogated file by file.

   Historical-evidence and packaging-consistency tests are `KEEP` unless the
   protected reader or consumer is proven retired.

5. **Mechanically narrow candidates.**
   - Find structurally identical cases that differ only in literal inputs.
   - Find repeated setup blocks across cases or files.
   - Find hard-coded lists that duplicate a canonical registry or manifest.
   - Find assertions whose subject (symbol, path, command, Skill, or CLI
     surface) no longer exists in current source.
   - Find orphaned fixtures and helpers with no remaining importer.
   - Find tests that assert private implementation detail (call order of
     mocks, internal function return values) where a public-surface assertion
     already covers the same behavior.

6. **Apply evidence rules.** Age, file length, test count, and intermittent
   failure alone never prove a test redundant.

   `DELETE` requires one of the following:
   - the protected behavior is retired, with the retiring commit or a current
     owner showing it removed;
   - a named surviving test covers the same behavior and assertion strength.

   Subsumption claimed only by reading is `UNVERIFIED` unless isolated
   per-test coverage or a mutation that the surviving test kills supports it.

   `MERGE` and `PARAMETERIZE` must preserve every distinct input and assertion
   from the original cases.

   `RELAX_TO_STRUCTURE` is allowed only where the asserted text is not a
   machine contract consumed by code, a host, or a packaged surface.

7. **Produce one exact manifest.** Classify each entry as one of:
   - `MERGE`
   - `PARAMETERIZE`
   - `EXTRACT_HELPER`
   - `DERIVE_FROM_SOURCE`
   - `RELAX_TO_STRUCTURE`
   - `DELETE`
   - `KEEP`
   - `BLOCKED`
   - `BLOCKED_ACTIVE_SCOPE`
   - `DEFER_DOC_PRUNE`
   - `UNVERIFIED`

   Each entry includes:
   - evidence;
   - the exact file, case, or helper action;
   - for every `DELETE`, the surviving coverage owner or retirement proof;
   - the expected change in case count and line count;
   - the candidate hash.

   Group `UNCLASSIFIED` files.

8. **Gate mutation.** `audit` mode stops after the manifest. Mutation mode
   also stops until the literal user approves exact manifest entries (for
   example, "all recommendations except 4 and 7"). Broad approval such as
   "clean up the tests" is insufficient. Interruption starts a fresh scan; no
   manifest is persisted.

### Approved Mutation

9. **Revalidate and mutate minimally.** Before each approved change, re-read
   the candidate bytes, Git status, importers, and active scope. Drift blocks
   that item. Apply one manifest entry at a time and run that entry's focused
   tests before the next. A failing focused check stops further mutation and
   leaves the inspectable diff.

## Mutation Envelope

This Skill may modify, merge, parameterize, or delete approved test files,
fixtures, helpers, and snapshots, and may add shared test helpers under the
existing test-helper directory. It must stop when completion requires changing
any of the following:
- runtime or production source;
- public API;
- package exports;
- registries or generated output;
- dependencies or lockfiles;
- credentials or network writes;
- Git history;
- any Managed authority.

**Never weaken a live guarantee.** Never do any of the following to make a
check pass or to reduce counts:
- skip, `.only`, or `.todo` a test;
- loosen an assertion's strength (exact to partial, equality to existence,
  specific error to any throw);
- widen a timeout;
- delete a negative assertion that still guards a live boundary.

Snapshot updates are allowed only for cases whose structure the approved entry
changed, never as a blanket refresh.

## Verify and Report

10. **Verify and report.**
    - Re-run every touched test file plus the baseline scope, then
      `bun run typecheck`, the repository's dist or registry consistency
      tests only when touched helpers feed them, and `git diff --check`.
    - The baseline pass set must be preserved: every previously passing
      behavior keeps a passing owner.
    - This Skill does not commit.
    - Report only these sections: `Changed` (with entry IDs), `Deleted`
      (each with its coverage owner or retirement proof), `Blocked`,
      `Deferred to imm-doc-prune`, `Unverified`, `Delta` (case count, line
      count, wall time before and after), `Verification`, and
      `Recovery: git log -- <path>`.

## Recovery

Git history is the archive for removed tests. Every `DELETE` entry reports
`Recovery: git log -- <path>`. Untracked, dirty, baseline-failing, or non-Git
candidates are never mutated.
