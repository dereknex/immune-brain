---
title: Rejected generic dispatcher for fixture adapters
rejected: true
rejection_reason: A generic dispatcher would add platform machinery while this fixture has only one host adapter and no repeated dispatch drift.
reconsider_if:
  - At least three host implementations exhibit the same dispatch drift.
  - Host-specific adapters can no longer preserve contract parity.
reusability: medium
key_files:
  - README.md
next_reuse_scenarios:
  - A proposal introduces a shared dispatcher for fixture adapters
---

<!-- markdownlint-disable-next-line MD025 -->
# Rejected: Generic Dispatcher for Fixture Adapters

## Rejected approach

Introduce a shared generic dispatcher instead of keeping the fixture's single host adapter local.

## Rejection reason

The fixture has one adapter and no evidence of repeated host-level drift. A generic dispatcher would add an unsupported abstraction.
