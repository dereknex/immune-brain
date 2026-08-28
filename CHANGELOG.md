# Changelog

## 2.8.3

### Patch Changes

- [`61ccc29`](https://github.com/dereknex/immune-brain/commit/61ccc29c175edc29af7c485f795c8c33e4be8c1f) Thanks [@dereknex](https://github.com/dereknex)! - fix(tracker): avoid gh output limit exceeded by paginating snapshot and raising MAX_GH_OUTPUT

  - paginate GitHub Issues snapshot (100/page, up to 100 pages) instead of single --paginate --slurp blob
  - raise MAX_GH_OUTPUT 1MiB -> 8MiB to handle 65KB bodies without per-page overflow

## 2.2.0

### Removed

- The temporary Canary Slash Commands are removed from the Pi extension and npm package. Enrollment, assurance, authorization, interruption recovery, and successor state transitions no longer have command fallbacks or replacement aliases.

### Changed

- Repository mutation requests now enter Managed Path from natural language automatically. `imm-brainstorm`, `imm-planner`, and `imm-loop` remain the public workflow Skills.
- Enrollment and assurance continue through the foreground `imm_canary_enrollment` and `imm_kernel_canary` Tools with native TUI authorization and persistent Kernel `next_action` results.
