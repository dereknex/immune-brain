---
"immune-brain": patch
---

Review preparation now reports an invalid user `agents` table as `review_config_invalid`, naming the config file and the key path to fix instead of asking for the deprecated `lanes.review_host`; `review_profile_required` and `review_host_unavailable` recovery texts name `agents.profiles` / `agents.presets`. A round that still runs on the legacy `lanes` fallback returns `review_ready` with a `review_legacy_profile` warning. `drive.md` and the config reference follow.
