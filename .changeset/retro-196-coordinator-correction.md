---
"immune-brain": patch
---

In lane mode, a child that reaches its QA failure limit no longer parks at once: the report hands it to the coordinator (`role: "coordinator", action: "correct"`), which sends one design-level correction to a new Lane session as `lane_instruction` kind `correction`. The runner counts at most two corrections per child and parks a third exhaustion as `batch_correction_limit_reached` while independent siblings continue. Single tasks and serial batches are unchanged.
