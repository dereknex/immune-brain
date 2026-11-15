---
"immune-brain": minor
---

Bind every agent role to one Host profile through `agents.{profiles,presets,active}`
in the user configuration, with the project file and `projects.<key>` selecting a
preset through `agents.active`. Roles are `executor`, `code-review`,
`review-verifier`, `advisory-reviewer`, `judging`, `clarify`, `plan` and `repair`;
a role's host, model and effort always come from one profile, so no role mixes a
host from one layer with a model from another. `imm-kernel config --json` reports
`agents.roles.<role>` with `{ host, model, effort, transport, preset, layer }` and
`agents.max_parallel`. The Lane executor, the Review profile and its transport and
the review-verifier model now read the resolved roles. Legacy `lanes` profiles and
`active` map into the same table and are reported as `deprecated_config_source`;
a layer that sets both uses `agents` and reports `legacy_source_ignored`. An error
in the section (`unknown_profile`, `unknown_preset`, `preset_incomplete`,
`transport_invalid_for_role`, `review_verifier_host_mismatch`) falls it back to
`lanes`, else to built-in resolution.
