---
"immune-brain": minor
---

Add the opt-in `external_approval` seam for single-machine headless Kernel driving (ADR 0043 Slice 2):

- Add strictest-wins boolean `external_approval` (default `false`) to `v2` layered config and admit `external_approval` in Kernel Enrollment confirmation while recording `confirmation_source` on `TaskRecordV4`.
- Add `imm-kernel approve <task-id> [--finding <id> --resolution <text> | --stop <reason>] [--actor <id>] --json` for opt-in headless enrollment and decision resolution, and extend `imm-kernel inspect [--task <id> [--run <run-id>]] --json` to surface open user decisions and verify settled `.imm/audit/` proofs.
