# Immune-Brain

> Deterministic workflow & quality engine for [Pi](https://github.com/badlogic/pi) — turn vague ideas into shipped code with planning, execution, QA, and review.

**Language:** **English** | [中文](./README.zh-CN.md)

---

## What Is This?

Immune-Brain adds a structured engineering workflow on top of Pi:

- **You describe what you want** in natural language — the agent figures out whether to clarify, plan, or execute.
- **Plans become trackable tasks** (`TaskIntent` + `TaskRecord`) so progress survives across sessions, not just chat history.
- **Quality is enforced by code, not promises** — automated QA and isolated review must pass before a task is marked done.

Pi and Claude Code are the supported hosts. Undeclared adapters remain unsupported. Minimum Claude Code is `2.1.236`, the lowest version verified with interactive server-initiated MCP elicitation. Current real-Host evidence is recorded in [Claude native elicitation conformance](docs/verification/claude-native-elicitation-authority-conformance.md); historical reports remain under [docs/verification/archive/](docs/verification/archive/). Either host can use the model provider you configure — Immune-Brain works on top of Kernel authority, not a vendor chat.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [How to Use](#how-to-use)
- [The 6 Skills](#the-6-skills)
- [Lifecycle](#lifecycle)
- [Configuration](#configuration)
- [Project Layout](#project-layout)
- [FAQ](#faq)
- [Development](#development)

---

## Installation

**Prerequisites:** [Pi](https://github.com/badlogic/pi) installed, Node.js 20+, `bun` for tests.

This repo is a Pi package — Pi discovers Skills and extensions from `package.json`:

```json
// package.json → pi.skills / pi.extensions
"pi": {
  "skills": ["./plugins/immune-brain/skills"],
  "extensions": ["./plugins/immune-brain/.pi-extension"]
}
```

No extra server config is needed. Installing the package via Pi makes all 6 Skills available automatically. Verify with:

```bash
bun test                          # run all tests
mise run check-plugin              # verify package structure
mise run check-dist-sync           # verify generated docs are in sync
```

---

## Quick Start

**1. Describe the change you want** — just talk to Pi in natural language:

> "Add dark mode to the settings page"

Pi routes it automatically: vague requests go to clarification, clear requests go to planning.

**2. Confirm the plan** — Planner writes a `TaskIntent` (scope, risk, acceptance checks). Review it, then confirm enrollment in the TUI dialog (required for all risk levels). No writes happen before you confirm.

**3. Let it run** — `imm-loop` executes the plan, runs QA, and triggers review. Stage your owned files when prompted:

```bash
git add -- <file-owned-by-task> <another-file>
```

QA and review run as foreground tools and report back to the host. When the tool returns `phase=done`, the task is complete.

---

## How to Use

You rarely need to remember skill names — **just describe your intent**:

| Your situation | What to say / do | What happens |
|---|---|---|
| Idea is fuzzy, needs scoping | "Help me think through a notification system" | → `imm-brainstorm` clarifies questions, no code changes |
| Goal is clear, needs a plan | "Plan the dark-mode feature" or let Pi route there | → `imm-planner` writes `TaskIntent` + specs in `docs/plans/` |
| Plan is approved, ready to build | "Start building" / `imm-loop` | → Executor builds, QA verifies, Review checks |
| PR needs fixes after review | `imm-pr-fix` on that PR | → Standalone repair, no new managed task |
| Docs are stale after changes | `imm-doc-prune` with manifest | → Prunes only approved stale docs |
| Agent instruction files are bloated | `imm-agent-doc-maintain` with manifest | → Keeps only necessary non-discoverable rules |

> **Rule:** Managed work (brainstorm → plan → loop) starts only from explicit `imm-brainstorm`, `imm-planner`, or `imm-loop`. Ordinary Q&A or read-only requests stay host-native and never enroll a task.

---

## The 6 Skills

| Skill | Type | When to use | What it does |
|---|---|---|---|
| `imm-brainstorm` | Managed entry | Requirements are ambiguous | Frames the problem, surfaces open questions, no code edits |
| `imm-planner` | Managed entry | Goal is clear | Authors / revises `TaskIntent` and specs; does not enroll or build |
| `imm-loop` | Managed coordinator | Plan is validated | Drives execution → QA → Review → completion via foreground tools |
| `imm-pr-fix` | Standalone | CI failed / review comments on a PR | Repairs one PR in place, no managed authority |
| `imm-doc-prune` | Standalone | Stale current docs | Deletes only the hash-approved manifest entries |
| `imm-agent-doc-maintain` | Standalone | Bloated agent instructions | Minimizes tracked AGENTS/CLAUDE/GEMINI.md to necessary context |

Internal roles (Executor, QA, Review, Compounder) are dispatched by `imm-loop` — you never invoke them directly.

**Recommended default:** let natural-language routing pick brainstorm vs. planner for you. Explicitly invoke a skill only when you want to force that phase.

---

## Lifecycle

```
You: natural language request
        │
        ├─── vague ──→ imm-brainstorm (clarify, no edits)
        │
        └─── clear ──→ imm-planner ──→ TaskIntent (Git-tracked)
                              │
                         TUI confirm (enrollment)
                              │
                          imm-loop
                              ├── Executor (edits inside scope)
                              ├── QA (deterministic checks must pass)
                              ├── Review (material/critical: isolated subagent)
                              └── done
```

Key invariants:

- **One active step at a time**, edits only inside that step's boundary.
- **Scope (`scope_hint`) is frozen at enrollment** — out-of-scope files are ignored.
- **Evidence before closure** — QA is the only authority that can close a step.
- **Advisory never implements**, execution never self-approves.

---

## Configuration

Immune-Brain has **no separate config file**. Preferences live in your host's agent instruction file at the repo root — `AGENTS.md` (Pi) or `CLAUDE.md` (Claude Code):

```md
## Immune-Brain Preferences

- Initiative carrier default: github   # or: local
```

| Preference | Options | Default | Notes |
|---|---|---|---|
| Reply language | any natural language | repo `AGENTS.md` | Machine contracts / paths stay literal |
| Initiative carrier | `local` / `github` | none — Planner asks | Only matters when a proposal splits across multiple TaskIntents |
| Advisory subagents | allowed / solo | allowed | Respects Pi host policy + explicit user instruction |

Precedence: **current message > repo agent instruction file > user-level agent instruction file > ask**. Skills read these files directly, so a preference works even when the host does not auto-load that file.

See [`docs/reference/immune-brain-config.md`](docs/reference/immune-brain-config.md) for details.

---

## Project Layout

```text
package.json                          # Pi package manifest (skills + extensions)
plugins/immune-brain/
├── .pi-extension/                    # Pi TUI + Kernel authority extension
├── skills/                           # 6 public Skills (trigger shims)
├── dist/                             # Built skill contracts & references
├── runtime/                          # Bun + TypeScript runtime & Kernel
└── bin/                              # CLI wrappers (→ runtime/v4_runtime.ts)

.imm/                                 # Task state (worktree-local, git-ignored)
docs/plans/                           # Active TaskIntents (*.intent.json)
docs/specs/                           # Living specs (updated in place)
```

- `.imm/state/` — active work; `.imm/audit/<task-id>/` — settled evidence (tracked).
- `docs/plans/*.intent.json` must be **Git-tracked** before enrollment.
- `CONTEXT.md` is vocabulary / navigation only — not a runtime state source.

---

## FAQ

**Do I need to learn all 6 skills?** No. Just describe what you want — Pi routes to the right skill. Learn `imm-planner` and `imm-loop` first; the other four are occasional.

**What if I interrupt or close Pi mid-task?** State is on disk (`.imm/` + TaskIntent). Re-enter `imm-loop` to resume — the Kernel projection is authoritative.

**Why does enrollment show a TUI dialog?** All risk levels (`routine`/`material`/`critical`) require explicit confirmation. It binds the staged digest so you see exactly what will be tracked.

**QA failed — what now?** QA returns `rework` or `replan_required`. `imm-loop` routes back to the executor or to `imm-planner` for scope changes. No manual reset needed.

**Can I use it outside Pi?** Yes. Local interactive Claude Code is supported from version `2.1.236`; its plugin uses a digest-bound native MCP elicitation gate for the same Kernel-backed workflow.

---

## Release

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

| Task | Command |
|------|---------|
| Add a changeset | `bunx changeset` — pick bump (patch/minor/major) and write summary |
| Bump version | `bun run changeset:version` — updates `package.json` + `CHANGELOG.md`, then syncs and validates the Claude plugin manifest |
| Publish (local) | `bun run changeset:publish` — validates manifest versions, then publishes to npm (needs `NPM_TOKEN` or `npm login`) |

**Automated flow (recommended):**
1. Push changesets to `main` → workflow opens a “Version Packages” PR.
2. Merge that PR → workflow publishes to npm, creates GitHub Release, and tags `immune-brain-vX.Y.Z`.

Setup: add `NPM_TOKEN` (npm access token with publish permission) to GitHub repo secrets. Workflow is `.github/workflows/release.yml` using `changesets/action@v1`.

**Initial publish (2.8.1):**
```bash
npm publish --access public   # one-time, requires npm login / NPM_TOKEN
# or
bun run changeset:publish
```
The package is scoped `@immune-brain/agent-skills` — `publishConfig.access=public` is already set. After initial publish, all future releases go through changesets.

See `CHANGELOG.md` and `.changeset/config.json` (changelog: `@changesets/changelog-github`, repo: `dereknex/immune-brain`).

---

## Development

For contributors working on Immune-Brain itself:

```bash
bun test                    # full test suite (canonical check is bun test, not tsc)
mise run check-plugin       # plugin structure + version
mise run check-dist-sync    # generated dist docs sync
```

- Runtime is `runtime/v4_runtime.ts` (Bun + TypeScript). Python under `scripts/` is reference-only.
- Production CLI: `plugins/immune-brain/bin/imm-kernel` — see [`plugins/immune-brain/README.md`](plugins/immune-brain/README.md) for the full command table.

---

*License: MIT*
