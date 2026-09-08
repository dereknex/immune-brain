---
"immune-brain": patch
---

Carry the assurance fixes found while running the first real batch

Driving an enrolled batch through both Hosts surfaced five boundaries that
stopped a task with no way forward:

- A user can now authorize rework continuation directly, without escalating a
  routine rework to the reviewer.
- A malformed Review receipt is recovered from durable evidence instead of
  pinning the task in a state no operation can leave.
- The Claude Host exposes `resolve_finding`, so a closed finding on that Host no
  longer requires switching to Pi.
- Published GitHub Issues carry their own public acceptance summary instead of
  the canonical TaskIntent assertion prose. The projected text stays within
  1–500 characters, and the input limit now accepts a summary that matches a
  canonical assertion length rather than rejecting the whole batch.
