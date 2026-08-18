---
name: imm-init
description: Use automatically before the first repository-mutating Managed Path request to ensure Immune-Brain project files and directories (memory, specs, plans); it is idempotent for complete state and fail-closed for partial or incompatible state. It is not a user-facing setup prerequisite.
---

# Immune-Brain: Init

The host invokes this bootstrap contract automatically for a repository-mutating
request; users do not need a separate setup command. Load
[`../../dist/imm-init.md`](../../dist/imm-init.md), then create only the minimum
Immune-Brain project files. Do not copy runtime engine files. Return bootstrap
report and Next Action. Complete state must remain untouched; partial or
schema-incompatible state must fail closed before any write.
