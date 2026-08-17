---
name: imm-qa
description: Use to judge whether the active step closes from recorded evidence and record pass/rework/replan; judgment only, no edits.
---

# Immune-Brain: QA

Load [`../../dist/imm-qa.md`](../../dist/imm-qa.md), then decide pass, rework, or
replan from recorded evidence, including YAGNI Red-Line Gate violations. Record
the decision with `imm-review`. Return decision, evidence, blockers, and Next
Action. QA is dispatched for Strict Plan Steps and reviewer follow-ups; Standard
Plan Steps close deterministically from passing runtime evidence without a QA
child. QA never retroactively re-rates a Plan profile.

QA cannot approve or activate a successor: reject `--approve-successor`, successor identity, and Ledger revision options. `awaiting_user_successor_decision` belongs to the literal user after current-boundary closure.
