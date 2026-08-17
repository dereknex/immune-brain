---
title: fix: sync README installed skills guidance
type: fix
status: planned
date: 2026-05-09
origin: imm-code-review found that README's static installed-skills list no longer matches the dynamic legacy-installer behavior, which now includes ai-eval-planner and other newer skills
---

# Iteration Plan

## Task
- Summary: Sync README installed-skills guidance with the actual dynamic legacy-installer behavior
- Origin: After the `ai-eval-planner` runtime slice completed, `imm-code-review` found that the README still claims a smaller static installed skill set even though `zsh scripts/legacy-installer.sh --list` now exposes a wider dynamically discovered set.
- Research: Checked `IMMUNE.md`, the README section around “当前会安装”, `scripts/legacy-installer.sh`, and the actual output of `zsh scripts/legacy-installer.sh --list`. Conclusion: the bug is not in the installer; it is in stale README prose that has drifted away from the script's dynamic discovery behavior.
- Decisions: D1 keep `Scope Reduction` and treat this as a one-step documentation hotfix; D2 fix only the README installation guidance, not the installer; D3 prefer a wording that points readers to the live `list-skills` / `--list` output instead of maintaining another brittle static list; D4 keep verification command-based and local.
- Assumptions: The script's dynamic `skills/*/SKILL.md` discovery remains the source of truth; removing or rephrasing the static list is sufficient to eliminate the user-facing mismatch; no additional workflow docs need updating for this narrow fix.
- Scope Mode: Scope Reduction
- Engineering Closure Check:
  - architecture_surface: `README.md` only
  - dependencies_known: true
  - verification_path:
      - target: README installation guidance no longer conflicts with `zsh scripts/legacy-installer.sh --list`
      - method: inspect the README install section and run `zsh scripts/legacy-installer.sh --list`
  - blockers: none
  - replan_condition: if fixing the mismatch starts requiring installer behavior changes, generated-doc tooling, or broader README restructuring beyond the install section, stop and return to preplan

## Steps

### Step 1
- Step ID: U1
- Result: README installation guidance is aligned with the actual installed-skill set
- Verification: The README install section no longer presents a stale static skill list and instead matches or defers to `zsh scripts/legacy-installer.sh --list` as the source of truth.
- Test scenarios: Covers IMM-README-001 R1; Covers IMM-README-001 R2; Covers IMM-README-001 R3; Covers IMM-README-001 acceptance criteria 1; Covers IMM-README-001 acceptance criteria 2; Covers IMM-README-001 acceptance criteria 3; Covers IMM-README-001 acceptance criteria 4
- Depends on: none
- Scope: `README.md` install guidance only
- Replan condition: If the README cannot be corrected without changing installer logic, adding generated documentation machinery, or touching unrelated guidance sections, stop and return to `imm-preplan-review` or a broader planner pass.

## Notes
- This is intentionally a one-step plan: the user-visible issue is stale install guidance, not installer behavior.
- Keep the fix durable by reducing the chance of future list drift instead of copying another static enumeration.
