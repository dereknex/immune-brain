---
title: "BASELINE.md install coverage"
type: fix
status: active
date: 2026-05-12
---

# Spec: BASELINE.md install coverage

## Problem

`legacy-installer.sh` copies each `skills/<name>/` subdirectory to `plugin skill registry/<name>/` but
does not copy the sibling `skills/BASELINE.md` file. Every SKILL.md references `../BASELINE.md`,
which resolves to `plugin skill registry/BASELINE.md` at runtime — a path that does not exist after
install. Agents report a graceful fallback warning ("BASELINE.md not found") and continue with
the inlined skill content, but the shared guards in BASELINE.md are invisible to them.

## Accepted Behaviors

1. After `legacy-installer.sh` (copy mode), `plugin skill registry/BASELINE.md` exists and matches the
   source `skills/BASELINE.md`.
2. `legacy-installer.sh --check` reports success only when `plugin skill registry/BASELINE.md` is
   present as a regular file.
3. `legacy-installer.sh --uninstall` removes `plugin skill registry/BASELINE.md` when it is present.
4. `test_install_local.py` asserts presence after install and absence after uninstall.

## Non-Goals

- Inlining BASELINE.md content into each individual SKILL.md at build time.
- Changing the `../BASELINE.md` relative-path convention in skill files.
- Managed-copy marker infrastructure for single-file targets (unconditional copy/delete is
  sufficient here since this path is exclusively owned by this install script).
