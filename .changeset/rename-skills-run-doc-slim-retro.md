---
"immune-brain": major
---

**BREAKING:** rename three public Skills so the suffix names the job (#163). There is no alias layer and no deprecation window: the old names stop resolving on upgrade.

| Old | New |
| --- | --- |
| `imm-loop` | `imm-run` |
| `imm-agent-doc-maintain` | `imm-doc-slim` |
| `imm-review-retro` | `imm-retro` |

Update every invocation (`/immune-brain:imm-run`, `/skill:imm-run`, and the equivalents for the other two) and any personal command or prompt alias that forwards to the old names. `imm-brainstorm`, `imm-planner`, `imm-doc-prune` and `imm-pr-fix` are unchanged.

The Skill directories, the packaged contracts under `dist/`, both registries (`name`, `path`, `next_actions`, plus the `Doc Slim` and `Retro` titles) and the dist sync manifest move with the names. The Loop routing contract's `entry` value in `runtime/loop_contract.ts` is now `"imm-run"`, and the Kernel and Pi Enrollment routing hints name `imm-run`. Internal identifiers without the `imm-` Skill prefix keep their names (`loop_contract.ts`, the `imm_loop_action` Tool, `review_retro.ts`), and historical records (archived docs, Plans, Specs, reports, `.imm/` audit records, the changelog) are not rewritten.
