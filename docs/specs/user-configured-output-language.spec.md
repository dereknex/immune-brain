# Spec: user-configured output language

**Task ID**: IMM-DOCS-OUTPUT-LANGUAGE-001
**Owner**: Planner
**Status**: Proposed

## 1. Goal

Immune-Brain should let a project declare the default language for user-facing replies and persisted human-readable workflow documents.

The policy should reduce repeated per-turn language instructions while preserving stable machine contracts.

## 2. Problem

Immune-Brain already has a repo-wide natural output contract: user-facing replies should lead with conclusion and avoid dumping raw schema. It does not yet define where a project-level language preference lives or how persisted documents should follow that preference.

As a result, a user can ask for Chinese replies in `AGENTS.md`, but future Brainstorm, Spec, Plan, HANDOFF, and Learning prose can still drift back to English unless each turn repeats the preference.

The risky overcorrection is to translate internal field names, enum values, CLI JSON, State Ledger keys, or canonical workflow vocabulary. Existing repository learnings say user-facing output should be made readable without renaming machine contracts.

## 3. Requirements

### R1. Project language policy

Immune-Brain must document a project-level Output Language Policy that can be declared in project instructions such as `AGENTS.md` and referenced from config guidance when users want a stable default.

The policy must cover:

- conversation replies
- persisted human-readable workflow prose
- generated Immune-Brain planning and learning artifacts

### R2. Persisted document coverage

The policy must explicitly cover newly written human prose in:

- `docs/brainstorms/`
- `docs/specs/`
- `docs/plans/`
- `docs/solutions/`
- `HANDOFF.md`
- user-facing summaries emitted by `imm-*` skills

Existing documents are not migrated by this slice.

### R3. Machine contract preservation

The policy must forbid translating or renaming:

- schema fields
- enum values
- CLI flags and JSON keys
- State Ledger fields
- file paths
- tool names
- code identifiers

Canonical Immune-Brain terms from `CONTEXT.md`, such as `Step`, `Plan`, `Spec`, `Skill`, `Brainstorm`, `Executor`, `QA`, `Compounder`, `Learning`, `ADR`, and `State Ledger`, should remain stable. Local-language explanations may be added around them.

### R4. Precedence and fallback

The policy must state precedence clearly enough for agents to follow without asking every time:

1. explicit user instruction in the current conversation
2. project instruction such as `AGENTS.md`
3. host or user-level config when available
4. repository default output contract

When no policy is declared, existing output behavior remains unchanged.

### R5. Bootstrap template support

`imm-init` project templates should include a concise editable Output Language Policy placeholder so new projects can opt into persistent document-language behavior from the start.

### R6. Regression coverage

Focused contract tests should verify that the repo-facing docs and bootstrap templates describe:

- persisted human prose follows the configured language
- machine contracts are not translated
- current-turn user instruction takes precedence over project defaults

## 4. Acceptance Criteria

- [ ] `README.md` documents Output Language Policy near the default user output contract.
- [ ] `docs/reference/immune-brain-config.md` explains any host or user-level language preference as optional and non-authoritative over project instructions.
- [ ] `skills/BASELINE.md` and packaged baseline guidance tell skills to honor configured language for user-facing prose and persisted human-readable documents.
- [ ] `skills/imm-init/templates/AGENTS.md` includes an editable Output Language Policy placeholder.
- [ ] Packaged plugin source or dist copies stay aligned for the touched skill/template/docs surfaces.
- [ ] Focused contract tests assert the language policy and machine-contract preservation rules.
- [ ] The iteration Plan validates with `imm-plan --json`.

## 5. Non-goals

- No migration or translation of existing historical documents.
- No machine-readable schema rename.
- No language detector or automatic translation service.
- No multi-language synchronization system.
- No runtime State Ledger migration.
- No host-specific UI changes.

## 6. Compatibility

This is an additive docs and contract slice. Existing projects without an Output Language Policy keep current behavior.

Projects that already specify response language in `AGENTS.md` can keep doing so. The new contract only clarifies that persisted Immune-Brain human prose should follow the same language unless a current user instruction says otherwise.
