# Immune-Brain Benchmark Fixture

This is a deliberately small workspace for measuring the Immune-Brain plugin.
It avoids upstream repositories, generated logs, and unrelated project history
so benchmark runs measure workflow behavior instead of repository scale.

## Runtime Adapter Contract

The packaged plugin runtime entrypoint is `plugins/immune-brain/runtime/v4_runtime.ts`.

## Workflow Boundary

Use Immune-Brain for repo-scoped planning, bounded execution, review, QA, and
learning capture. Small one-off copy edits, generic chat, and asset creation
should stay outside the full lifecycle workflow unless the user explicitly asks
for that structure.

## Open Task

Document a focused plan for keeping runtime adapter references aligned across
README, tests, and plugin manifests.
