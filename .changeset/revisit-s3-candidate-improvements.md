---
"immune-brain": minor
---

`revisit --audit` adds a Candidate improvements evidence section over in-window review findings: repeat groups (the same normalized summary in at least two distinct runs, with run count, finding count and up to three `run-path#finding-id` pointers), infrastructure jitter (a missing or cleaned-up reviewer agent or an empty verdict, kept out of the content rework count) and, for every run with three or more review rework events, one line per round with that round's finding acceptance ids and repeats marked. The analyzer suggests no improvement level or disposition. The `revisit` contract now carries the follow-through method (per-task aggregation, cross-boundary trace, one smallest improvement, the fix ladder architecture > types > lint > test > docs, and the report-only rule), and the project-local `workflow-evidence-retro` Skill is retired.
