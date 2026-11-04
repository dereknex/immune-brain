# Review eval run — 2026-11-03 — gpt-6.1-sol

- Prompt: `plugins/immune-brain/runtime/prompts/code-review.md`
- Model: `nextty/codex/gpt-6.1-sol`

| Split | Gold true cases | Recall | Clean cases | Clean-case FP rate | New-anchor rate |
| --- | --- | --- | --- | --- | --- |
| tuning | 0 | unmeasured | 2 | 0 | unmeasured |
| validation | 0 | unmeasured | 0 | unmeasured | unmeasured |

0 of 141 corpus cases carry a human gold label, so recall and confirmed-false matching are unmeasured and only the clean-case FP rate is measured; the baseline cannot supply the recall half of the merge gate.

offline reviewer replay in an isolated checkout; no live Kernel state, no Managed role, no TaskRecord
