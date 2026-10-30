---
"immune-brain": patch
---

`revisit` session finding totals now count a `submit_review` that omits its verdict: the analyzer applies the observed Review receipt (the verdict JSON in the latest Review `Agent` toolResult), as the Kernel does, and each submit consumes that receipt so findings are not counted twice. Previously these findings, the common case, were missing from blocking and advisory totals.
