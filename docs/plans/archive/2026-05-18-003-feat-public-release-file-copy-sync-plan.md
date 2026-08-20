---
title: "feat: rewrite public-release sync to file-level copy"
type: feat
status: proposed
date: 2026-05-18
origin: "docs/specs/archive/public-release-engine-sync.spec.md"
---

# Iteration Plan

## Task
- Summary: Rewrite `scripts/sync-to-public.sh` to use pure file-level `cp` instead of `git-filter-repo`. Zero git operations. Output is a clean file tree containing install content + user docs + deploy scripts.
- Origin: docs/brainstorms/2026-05-18-public-release-brainstorm.md (revised BR-DEC-1)
- Spec: docs/specs/archive/public-release-engine-sync.spec.md (IMM-RELEASE-002, supersedes IMM-RELEASE-001)
- Research: Existing script at `scripts/sync-to-public.sh` (79 lines) already defines `KEEP_PATHS`, `EXCLUDE_PATHS`, `PUBLIC_TEMPLATES` arrays — reuse these whitelists. `--dry-run`, `--output-dir`, `--force` flag contracts carry forward. Remove all git operations (`git clone`, `git filter-repo`, `git init`, `git commit`, `git add`).
- Decisions:
    - D1: Use `cp` with whitelist arrays, no git operations at all
    - D2: Reuse existing `KEEP_PATHS` / `EXCLUDE_PATHS` / `PUBLIC_TEMPLATES` array structure from current script
    - D3: Output is a plain directory; `--force` safety gate still requires marker file
- Assumptions: `bash` and `cp` are available (POSIX baseline). No external dependencies needed.
- Scope Mode: Selective Rewrite
- Engineering Closure Check:
  - architecture_surface: `scripts/sync-to-public.sh`
  - dependencies_known: true (none beyond bash+cp)
  - verification_path: `--dry-run` output + end-to-end sync + file listing diff
  - blockers: none
  - replan_condition: if file-copy approach misses some path edge case (symlinks, empty dirs), adjust whitelist handling

## Brainstorm Manifest
| ID | Item |
|----|------|
| BR-REQ-1 | Physical isolation: only whitelisted files enter output dir |
| BR-REQ-2 | Output = install content + user docs + deploy scripts |
| BR-REQ-3 | `upstreams/` excluded; no auto-pull tools |
| BR-DEC-1 | REVISED: File-level `cp`, zero git operations |
| BR-DEC-2 | Engine scripts degrade gracefully without internal dirs |
| BR-OUT-1 | No auto-pull tools for upstreams |
| BR-Q-1 | RESOLVED: Output is plain dir, no git operations |

## Brainstorm Trace
| Item | Status | Target | Reason |
| ---- | ---- | ---- | ---- |
| BR-REQ-1 | covered_by_step | U1 | Path whitelist/blacklist in sync script |
| BR-REQ-2 | covered_by_step | U1 | Content categories mapped in KEEP_PATHS + PUBLIC_TEMPLATES |
| BR-REQ-3 | covered_by_step | U1 | `upstreams/` in EXCLUDE_PATHS |
| BR-DEC-1 | covered_by_step | U1 | File-level cp replaces git-filter-repo |
| BR-DEC-2 | out_of_scope | out_of_scope | Separate concern; not part of this sync-mechanism change |
| BR-OUT-1 | out_of_scope | out_of_scope | No auto-pull tools |
| BR-Q-1 | resolved_as_assumption | U1 | Plain dir output, no git init |

## Steps

### Step 1
- Step ID: U1
- Result: `scripts/sync-to-public.sh` rewritten to pure file-level copy with zero git operations
- Verification Type: automated
- Verification: `bash scripts/sync-to-public.sh --dry-run` lists kept/dropped paths and template mappings; `rm -rf /tmp/test-public && bash scripts/sync-to-public.sh --output-dir /tmp/test-public` completes without error; `find /tmp/test-public -name '.git' -o -name 'upstreams' -o -name 'IMMUNE.md' -o -name 'CONTEXT.md' | grep -q . && exit 1 || exit 0` confirms no excluded paths; `test -f /tmp/test-public/README.md && test -f /tmp/test-public/mise.toml && test -f /tmp/test-public/scripts/legacy-installer.sh && test -d /tmp/test-public/.imm && test -d /tmp/test-public/skills` confirms required content present
- Depends on: none
- Scope: `scripts/sync-to-public.sh`
