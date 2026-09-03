---
"immune-brain": major
---

Replace incremental GitHub Initiative Issue creation with one complete publication batch.

Planner now presents the full Parent/Child decomposition, granularity, dependencies, and execution order for one user decision before any remote mutation. After approval, `imm-tracker publish-initiative --stdin --json` validates every tracked TaskIntent and the complete dependency graph, idempotently publishes and verifies all native Issue relationships, links each Child to its Parent, and returns the recommended first Issue, stable order, and parallel groups.

The former `create-initiative` and `upsert-task` CLI entrypoints are removed. Existing terminal Issue projection remains unchanged.
