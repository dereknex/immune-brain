---
"immune-brain": patch
---

Resolve a Review profile in the layered lane configuration. `lanes` accepts `review_host` (`pi`, `claude-code` or `antigravity`), `review_model` and `review_effort` in user Lane profiles and in the project file, with the active-profile → project precedence; the model and effort apply only in the layer that sets `review_host` and otherwise report `not_applied`, as the executor keys do. `chooseReviewer` in `runtime/config/layered_config.ts` returns `{ host, model?, effort? }` or `null`, with no model-distinctness check. No Review dispatch change.
