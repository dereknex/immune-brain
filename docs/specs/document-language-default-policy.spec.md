---
title: "fix: document language default policy"
type: fix
status: proposed
date: 2026-06-22
origin: imm-brainstorm framing - AGENTS.md reply language leaked into document language
---

# Spec: Document Language Default Policy

## Goal

Generated persisted Immune-Brain documents default to English unless the user or project explicitly specifies the language for those documents.

Conversational reply language and persisted document language are related user experience surfaces, but they must not be treated as the same contract.

## Problem

The current Output Language Policy conflates `AGENTS.md` reply-language guidance with persisted workflow document language. A project instruction such as "default to Chinese replies" currently gets interpreted as "write new `HANDOFF.md`, Brainstorm, Spec, Plan, and Learning prose in Chinese."

That behavior is too broad. It makes reply-local preferences leak into durable repository artifacts, and it makes generated documents depend on host conversation style rather than explicit document-language intent.

## Accepted Behavior

### R1. Persisted documents default to English

Newly generated persisted Immune-Brain human-readable documents default to English. This includes, but is not limited to:

- `HANDOFF.md`
- `docs/brainstorms/`
- `docs/specs/`
- `docs/plans/`
- `docs/solutions/`

### R2. Reply language does not imply document language

Project instructions such as `AGENTS.md` may set the default language for conversational replies. That preference affects assistant replies and short user-facing summaries, but it does not change the default language for persisted Immune-Brain documents.

Example: `AGENTS.md` saying "default to Chinese replies" means the assistant should answer the user in Chinese, while new Spec and Plan documents still default to English.

### R3. Explicit document-language instructions win

Persisted document language changes only when the current user instruction, project instruction, or Immune-Brain configuration explicitly says that generated documents or a named document family should use a specific language.

Examples of explicit document-language instructions:

- "Write new Spec and Plan documents in Chinese."
- "Use Chinese for `docs/specs/` and `docs/plans/` prose."
- "Persisted Immune-Brain documents should be bilingual."

Examples that are not document-language instructions:

- "default to Chinese replies"
- "use Chinese when replying"
- "respond in Chinese"

### R4. Machine contracts remain literal

Language policy never translates or renames machine contracts:

- schema fields
- enum values
- CLI flags
- JSON keys
- State Ledger fields
- file paths
- tool names
- API names
- code identifiers
- `CONTEXT.md` canonical terms such as `Step`, `Plan`, `Spec`, `Skill`, `Brainstorm`, `Executor`, `QA`, `Compounder`, `Learning`, `ADR`, and `State Ledger`

### R5. Existing documents are not rewritten

This fix applies to newly generated or newly revised documents. It does not migrate, translate, or normalize historical documents.

### R6. Runtime schema stays stable

This fix must not require State Ledger schema changes, Plan schema changes, MCP tool schema changes, or a new mandatory runtime field.

## Acceptance Criteria

- [ ] Shared baseline guidance says reply language and persisted document language are separate.
- [ ] README and config documentation describe English as the default for persisted Immune-Brain documents.
- [ ] `imm-planner` guidance tells planners to write Spec and Plan documents in English unless document language is explicitly specified.
- [ ] `imm-init` templates no longer teach that a reply-language preference changes persisted document language by default.
- [ ] Plan template defaults `Human-readable prose` to English.
- [ ] `imm-plan` output-language warnings do not fire merely because `AGENTS.md` asks for Chinese replies.
- [ ] Focused tests cover English Plan and Spec documents under Chinese reply-only `AGENTS.md`.
- [ ] Focused tests cover explicit Chinese document-language policy.
- [ ] Packaged plugin copies stay aligned for touched mirrored surfaces.

## Non-goals

- No rewrite of existing historical documents.
- No runtime schema migration.
- No new mandatory `document_language` config.
- No automatic translation service.
- No multilingual synchronization system.

## Compatibility

Existing projects keep their conversational reply preferences. Projects that explicitly documented persisted document language keep that behavior. Projects that only said "reply in Chinese" stop having that preference applied to newly persisted Immune-Brain documents.

The old `user-configured-output-language` Spec is superseded for document defaults by this Spec. Its machine-contract preservation guidance remains valid, but its persisted-document-language coupling is obsolete.
