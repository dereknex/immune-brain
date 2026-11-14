---
"immune-brain": patch
---

Derive unique <=32-char backend session names from the folded label plus a 12-hex ownership token slice in the `herdr` and `herdr-core` `SupervisedSessionPort` providers (#502), preserve token identity across exited-Host `herdr` `--resume`, and enforce live duplicate-name guards in `fake-herdr` and `fake-herdr-core`.
