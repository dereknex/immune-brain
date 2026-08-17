# Pocock Ripple: Doc Alignment

## Origin

Brainstorm ripple analysis after Pocock-inspired improvements (plans 064–066) and mattpocock-skills submodule addition. Three research probes identified 5 concrete gaps where existing governance documents have not yet been updated to reflect the new system-level artifacts and rules.

## Accepted Behaviors

### 1. IMMUNE.md directory structure + compounder boundary

- §2 目录结构 lists `CONTEXT.md` (repo root, shared domain vocabulary) and `HANDOFF.md` (repo root, cross-session convenience, not source of truth) and `docs/adr/` (ADR directory, created lazily by compounder).
- §3 写入边界 for `imm-compounder` includes `docs/adr/` as a permitted write target (alongside `docs/solutions/` and `MEMORY.md`), resolving the contradiction between IMMUNE.md and imm-compounder/SKILL.md.

### 2. BASELINE.md repo vocabulary pointer

- A short "Repo Vocabulary & Artifacts" entry is added to BASELINE.md pointing all skills at `CONTEXT.md` for shared domain terms and noting `HANDOFF.md` as a coordinator-maintained optional continuity artifact.

### 3. addy-agent-skills-contrast.md cross-link

- A "Related upstream contrasts" section is added at the end of `docs/reference/addy-agent-skills-contrast.md` linking to `docs/reference/mattpocock-skills-contrast.md`.
- Reciprocally, `docs/reference/mattpocock-skills-contrast.md` links back to `addy-agent-skills-contrast.md`.

### 4. subagent-dispatch-protocol.md Phase 3 CONTEXT.md pointer

- The Phase 3 `shared_context_summary` template adds an optional `domain_vocabulary` field noting that if `CONTEXT.md` exists at the repo root, hosts should include relevant canonical terms so child reviewers use consistent vocabulary.

## Out of Scope

- imm-heal.py REQUIRED_FILES update (product choice on strictness; deferred)
- agent-quality-checklists.md update (optional; deferred)
- Pocock spec template normalization (content correct; format drift acceptable)
- Verification type / Prototype tooling (already intentionally deferred)
