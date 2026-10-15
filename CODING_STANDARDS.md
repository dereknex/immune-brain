# Coding Standards

The single source of review and coding rules for this repository is the
[Code Quality Guard](docs/reference/code-quality-guard.md). Generic review tools
apply it instead of their own default smell baseline.

A code smell or maintainability heuristic is reported only when it creates a concrete correctness, regression, security, or significant maintenance risk in the reviewed change.

A review `pass` may carry advisory notes, which are archived and never require action; a `rework` contains only blocking findings.
