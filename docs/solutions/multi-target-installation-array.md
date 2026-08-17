---
title: "Multi-Target Installation Array Pattern"
type: infra
reusability: medium
next_reuse_scenarios: "When a script needs to operate identically over multiple distinct environments or paths (e.g. Codex and Claude Code destinations), or when unifying disparate install scripts."
date: 2026-05-15
---

# Multi-Target Installation Array Pattern

## Premise
When a repository distributes artifacts (like Agent Skills) to multiple downstream consumers that expect the same structural payload but live at different paths, hardcoding mutually exclusive toggles (`if TARGET_A else TARGET_B`) creates duplicate code, splits documentation, and forces users to run multiple disjoint commands.

By treating the target directories as an array (`TARGET_DIRS`) and auto-detecting the presence of downstream environments, a single script execution can elegantly fan out the payload to all valid targets simultaneously.

## Evidence
- **Consolidated Spec:** `.imm/specs/unified-local-install.spec.md` merged disjoint `claude-code-install.spec.md` and `install-local-copy-default.spec.md`.
- **Script Refactor:** `scripts/install-local.sh` was updated to initialize `TARGET_DIRS=("${TARGET_DIR}")` and conditionally append `CLAUDE_TARGET_DIR` if `~/.claude` exists or `--claude` is explicitly passed.
- **Loop Conversion:** The `install`, `check`, and `uninstall` functions were refactored to iterate over `"${TARGET_DIRS[@]}"`, reusing the exact same managed-copy marker validation (`validate_managed_copy`) for both paths.
- **Result:** Tests passed (`309/309`), redundant `--copy` and `INSTALL_MODE` code was removed, and the `mise.toml` user API was drastically simplified (e.g., `install-claude` and `uninstall-claude` were dropped).

## Best Practices
1. **Auto-detection over Flags:** Detect the destination environment (e.g., `[[ -d "$HOME/.claude" ]]`) to include it automatically, removing cognitive overhead for the user.
2. **Abstract Target Validation:** Refactor path-dependent validation logic (like `validate_managed_copy`) to accept the target path as an argument rather than relying on a global `TARGET_DIR`.
3. **Consolidate Markers:** Ensure the marker contract (`.imm-install-source`) is identical across all array targets to reuse validation and cleanup logic.
4. **Fail Gracefully per Target:** When iterating over `TARGET_DIRS`, capture failures for individual targets but allow the loop to finish so partial successes are still recorded, then aggregate the final exit code.
