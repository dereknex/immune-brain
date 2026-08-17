# Iteration Plan: Memory Lifecycle and Theme Consolidation

## Task

- Summary: Implement a low-overhead memory management system (MLM) to control context bloat by archiving old history in `.imm/memory/MEMORY.md` and consolidating solutions into theme hubs
- Origin: Brainstorm: "分析随着项目迭代，上下文和记忆会持续膨胀。我们应该如何控制这个问题"
- Spec: `.imm/specs/memory-lifecycle-management.spec.md`

## Research

- Current `.imm/memory/MEMORY.md` is ~221 lines and growing.
- `imm-finish.py` currently handles `dehydrate` and simple appending but no rotation.
- `docs/solutions/` has 70+ files, many of which are small and non-thematic.
- Existing pattern for `dehydrate` uses `re.sub` for status updates (see `.imm/imm-dehydrate.py`).

## Decisions

- D1: Use a fixed limit of 15 history entries for `.imm/memory/MEMORY.md`.
- D2: Archiving target is `docs/archives/history.md`.
- D3: Archiving is mechanical (regex/string split), not LLM-based.
- D4: Theme Hubs are established as preferred targets for `imm-compounder`.

## Assumptions

- Archiving 15+ entries is sufficient for 2 weeks of typical development context.
- Manual management of `Core Context` is preferred over automated extraction to ensure high signal.

---

### Step 1

- Step ID: U1
- Result: `.imm/memory/MEMORY.md` structure includes the static ## 核心上下文 section
- Verification: grep "## 核心上下文" .imm/memory/MEMORY.md
- Verification type: automated
- Depends on: None

### Step 2

- Step ID: U2
- Result: imm-finish.py implements mechanical rotation of the oldest history entries to docs/archives/history.md
- Verification: Create a temporary runtime memory file with 20 entries, run imm-finish logic, and verify exactly 15 entries remain
- Verification type: automated
- Execution note: test-first
- Depends on: 1

### Step 3

- Step ID: U3
- Result: skills/imm-compounder/SKILL.md incorporates the thematic append-first consolidation policy
- Verification: python3 -m unittest tests.test_skill_contracts
- Verification type: automated
- Depends on: 2
