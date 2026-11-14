---
"immune-brain": patch
---

Antigravity Managed native gates no longer refuse based on `toolPermission` or the `agy` ancestor process flags; `PreToolUse` always returns `force_ask` and leaves dialog surfacing to `agy`. `permissions.allow` is still read (best effort) for `allow-rule` provenance.
