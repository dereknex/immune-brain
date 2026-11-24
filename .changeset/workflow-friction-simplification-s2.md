---
"immune-brain": patch
---

Single-task `checkout_delivery` no longer refuses coordinator copies that already match the delivery. A staged or untracked regular file whose bytes and executable mode equal the delivered blob counts as delivered in both `manual` and `auto` modes; untracked copies are staged only after every refusal check passes (and unstaged again if staging or the fast-forward fails), so a `staged` result always means the paths are in the index. Byte, mode, symlink and deletion mismatches still fail closed with `checkout_delivery_overlap`, and the replay guard still requires indexed paths. A later Slice's Lane now keeps a shared Spec that an earlier Slice updated on the Parent branch when the coordinator copy is unchanged since the batch `base_head`.
