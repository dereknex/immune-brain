---
"immune-brain": patch
---

A lane batch now fixes its Review profile when it starts. `start_unattended_batch` takes `review_host`, `review_model` and `review_effort`, the batch records them as `review_profile`, and the native confirmation shows them. A CLI Review in that batch's Lane runs on the recorded profile instead of whatever `lanes.active` names when Review is prepared. Before this change, a drive request that named a Lane profile changed the Executor but not the reviewer.
