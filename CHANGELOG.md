# Changelog

## 2.2.0

### Removed

- The temporary Canary Slash Commands are removed from the Pi extension and npm package. Enrollment, assurance, authorization, interruption recovery, and successor state transitions no longer have command fallbacks or replacement aliases.

### Changed

- Repository mutation requests now enter Managed Path from natural language automatically. `imm-brainstorm`, `imm-planner`, and `imm-loop` remain the public workflow Skills.
- Enrollment and assurance continue through the foreground `imm_canary_enrollment` and `imm_kernel_canary` Tools with native TUI authorization and persistent Kernel `next_action` results.
