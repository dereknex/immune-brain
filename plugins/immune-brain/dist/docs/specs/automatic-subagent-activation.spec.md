# Spec: Packaged automatic subagent activation reference

This packaged copy exists so the plugin-only runtime can validate
`subagent-trigger-catalog.yaml` references without shipping the full repository
spec graph.

The canonical development spec lives in the source repository at
`docs/specs/automatic-subagent-activation.spec.md`. The packaged runtime contract
is intentionally narrower:

- Host-bound review skills consume the packaged catalog, policy, and dispatch
  protocol; there is no packaged CLI planner entrypoint.
- `dist/docs/reference/subagent-trigger-catalog.yaml` is the packaged trigger
  catalog used by host-bound activation.
- `dist/docs/reference/automatic-subagent-activation-policy.md` documents the
  activation input and output contract.
- `dist/docs/reference/subagent-dispatch-protocol.md` documents dispatch
  lifecycle and fallback meanings.
- `dist/docs/reference/immune-brain-config.md` documents local user config.

Do not expand this packaged spec into the full source spec dependency graph.
If the runtime needs another packaged reference, add it deliberately and keep
relative Markdown links resolvable inside `dist/docs`.
