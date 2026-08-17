# gstack borrow P1 guidance

This guidance turns the P1 conclusions from
[`gstack-skills-borrow-insights.md`](../solutions/gstack-skills-borrow-insights.md)
into local Immune-Brain repository rules. It is a docs and contract surface, not
a runtime authority.

## Generated Skill Contract

Immune-Brain does not currently generate `SKILL.md` files from templates. If a
future slice introduces generated Skill artifacts, the source of truth must be
the template or equivalent source file, not the generated output.

Minimum contract:

```text
GeneratedSkillContract:
  source_template: skills/<name>/SKILL.md.tmpl
  generated_output: skills/<name>/SKILL.md
  baseline_ref: skills/BASELINE.md
  allowed_tools: narrow per-skill grants only
  verification: generated output matches source template
```

Rules:

- Resolve merge conflicts in the source template first, then regenerate
  `generated_output`.
- Keep shared behavior in `baseline_ref`; generated per-Skill output should
  carry only role-specific workflow rules.
- Preserve the narrowest `allowed_tools` set for each Skill. Do not copy broad
  tool grants across generated files.
- Verification must prove the generated output matches `source_template` before
  review treats generated files as current.

Non-goals for this P1 slice:

- No template compiler.
- No Bun build pipeline.
- No managed copy runtime.
- No broad `allowed-tools` propagation.

## Preferred Skill routing

These hints route common user intents to existing Immune-Brain Skills. They are
host-bound and trigger-only guidance, not a shared registry, generic dispatcher,
or LLM-only classifier.

| User intent | Preferred Skill | Boundary |
|---|---|---|
| Request is unclear or missing success criteria | `imm-brainstorm` | Clarifies framing only; no implementation. |
| Scope is clear and needs a Plan | `imm-planner` | Creates or revises Spec and Plan only. |
| A validated Plan should continue | `imm-work` | Drives the current Step through executor / QA boundaries. |
| Broad technical review or PR risk | `imm-code-review` | Reviews and routes bounded follow-up; no direct edits. |
| UI, UX, accessibility, or interaction risk | `imm-ui-review` | Advisory UI review only. |
| Documentation may drift from behavior | `imm-advisory-reviewer` (`docs` lens) | Checks docs consistency; no workflow closure. |
| Prompt, Skill, or tool contract risk | `imm-advisory-reviewer` (`prompt_contract` lens) | Reviews prompt and contract surfaces only. |

Routing rules:

- Prefer the smallest Skill that owns the current boundary.
- Conditional advisory reviewers remain trigger-only; do not add them just to
  appear comprehensive.
- If the request would require a new dispatcher, registry, classifier, or
  workflow state field, return to `imm-planner` for a separate Plan.

## Drift guard

This guidance links back to
[`gstack-skills-borrow-insights.md`](../solutions/gstack-skills-borrow-insights.md)
and preserves the rejected boundaries recorded in
[`rejected-shared-registry-generic-dispatcher.md`](../solutions/rejected-shared-registry-generic-dispatcher.md)
and
[`rejected-pro-workflow-sqlite-wiki-authority.md`](../solutions/rejected-pro-workflow-sqlite-wiki-authority.md).

Guard phrases kept for contract tests:

- No duplicate memory: do not add `learnings.jsonl`, SQLite, or FTS as another
  memory authority beside `.imm/memory/` and `docs/solutions/`.
- No shared registry: keep routing host-bound and trigger-only.
- No browser daemon: browser-daemon infrastructure requires a separate Spec and
  Plan.
- No ONNX: prompt-injection classification runtime is out of scope here.
- No Canary: Canary Token runtime is out of scope here.
