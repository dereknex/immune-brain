---
"immune-brain": minor
---

Generate the packaged Claude reviewer definition and stop sending its static rules twice.

- `STATIC_REVIEW_RULES` and `REVIEWER_DISPATCH_RULES` are now exported from the role prompt bridge as the single source for the sentences every Review dispatch carries: the read-only rule, the final-turn single JSON verdict rule, the finding provenance rule, the `inspected_paths` statement, and the BR-REQ-3 dispatch rules.
- `scripts/build-claude-plugin.ts` writes `plugins/immune-brain/agents/immune-brain-reviewer.md` from the `code-review` role prompt plus those rules under fixed frontmatter, and `--check` now fails when the committed definition differs from a fresh generate, so a hand-edit cannot drift from the instructions a dispatched reviewer is meant to carry.
- `ReviewRequest` carries a second projection, `snapshotPrompt`: the per-dispatch facts alone. The coordinator builds the complete prompt as the role contract, the static rules and those facts, so `buildReviewPrompt` keeps every instruction and fact it carried before for the Pi Host, while the Claude envelope prompt is the reservation marker followed by `snapshotPrompt` — it no longer repeats instructions the reviewer definition already holds.
- The one resulting change to the Pi prompt is formatting: the `inspected_paths` sentence now backticks the identifier, because the shared sentence has to satisfy both dispatch shapes.
- Binding, settlement, blocked results with their reason, release decision and `recovery_action`, and the Pi dispatch parameters are unchanged.
