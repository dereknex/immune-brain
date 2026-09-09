---
"immune-brain": patch
---

Unattended batch runs: Git branch preflight and scope-bounded child commits

Batch preflight now requires a clean tree (including untracked files and dirty
submodules), a committed HEAD, a verified top-level repository root, and the
absence of `imm/<initiative-slug>` before any state is written. Child commits
are created only after Kernel settlement, staged strictly within the child's
TaskIntent scope plus its audit directory, verified against branch/HEAD
lineage and the committed tree delta, and backed by durable commit evidence so
crash recovery can distinguish its own commits from forged external ones.
Also fixes the bun runner resolution under mise/asdf shims.
