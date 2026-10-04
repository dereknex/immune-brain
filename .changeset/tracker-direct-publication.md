---
"immune-brain": minor
---

Publish GitHub Initiatives with a direct create-then-relate write flow.

- **Direct write flow (S1):** `imm-tracker publish-initiative` reads the repository identity, the Issue listing, and the label listing once at start, then creates each absent Issue in dependency order, attaches each Child as a native Sub-issue, and writes one `blocked_by` relation per dependency edge. Issue numbers come from the create responses; no repository listing, attachment confirmation, dependency confirmation, ownership confirmation, or closing topology pass follows a write. The number of repository-wide reads is constant in the number of Children, so a large Initiative no longer grows its call count or its runtime with the batch.
- **Start-only deduplication:** a rerun of the same approved batch adopts whatever the start listing already carries and writes only the missing relations, so a partial run, a lost create response, or a repeated complete batch never creates a duplicate Issue and never repeats a completed write. Concurrent edits made during a run are no longer detected within that run; they surface as drift at the start of the next run.
- **No whole-operation deadline:** the 120-second publication budget and its expiry refusal are removed. One publication call is a finite step sequence that stops at its first failed call, each call keeps its own 20-second timeout, and the caller's cancellation signal still stops the run at the next call. A failure is reported as uncertain with its confirmed steps, pending steps, and exactly one recovery action — rerun the same approved batch.
- **Unchanged surfaces:** local preflight, Issue body and marker format, `mark-terminal`, `observeGithubInitiative`, the tracker result contract, Kernel authority, and Enrollment are untouched.
