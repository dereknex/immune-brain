# Immune-Brain

> Deterministic workflow & quality engine for [Pi](https://github.com/badlogic/pi) and [Claude Code](https://claude.ai/code) — turn vague ideas into shipped code with planning, execution, QA, and review.

**Language:** **English** | [中文](./README.zh-CN.md)

---

## What Is This?

Immune-Brain brings a structured engineering workflow to AI coding assistants (**Pi** and **Claude Code**):

- **Zero overhead for normal chat & coding** — Ordinary questions, quick edits, and exploratory chat stay 100% host-native. Immune-Brain never interrupts normal conversation.
- **Explicit trigger when rigor matters** — When you want engineering discipline, invoke `imm-brainstorm`, `imm-planner`, or `imm-loop`.
- **Plans become trackable tasks** (`TaskIntent` + `TaskRecord`) — Progress lives on disk (Git + `.imm/`), surviving restarts and context wipes.
- **Quality is enforced by code, not promises** — Automated QA and isolated review subagents must pass before a task can complete.
- **Ready Initiatives can run as a batch** — One confirmed batch authorization lets `imm-loop` work through a published Initiative's children serially, while every child is still enrolled, QA'd, reviewed, and settled on its own.

Pi and Claude Code are the supported hosts. Undeclared adapters remain unsupported. Minimum Claude Code is `2.1.236`, the lowest version verified with interactive server-initiated MCP elicitation. Current real-Host evidence is recorded in [Claude native elicitation conformance](docs/verification/claude-native-elicitation-authority-conformance.md); historical reports remain under [docs/verification/archive/](docs/verification/archive/). Either host can use the model provider you configure — Immune-Brain works on top of Kernel authority, not a vendor chat.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [How to Use](#how-to-use)
- [The 6 Skills](#the-6-skills)
- [Lifecycle](#lifecycle)
- [Unattended Batch Runs](#unattended-batch-runs)
- [Configuration](#configuration)
- [Project Layout](#project-layout)
- [FAQ](#faq)
- [Development](#development)

---

## Installation

**Prerequisites:** [Pi](https://github.com/badlogic/pi) or [Claude Code](https://claude.ai/code) (>= 2.1.236), Node.js 20+, `bun` for tests.

### In Pi

Configure skills and extensions in `package.json` (or your global Pi configuration):

```json
// package.json → pi.skills / pi.extensions
"pi": {
  "skills": ["./plugins/immune-brain/skills"],
  "extensions": ["./plugins/immune-brain/.pi-extension"]
}
```

### In Claude Code

Add the plugin from the marketplace:

```bash
claude plugin marketplace add dereknex/immune-brain
claude plugin install immune-brain
```

Or load the local directory directly:

```bash
claude --plugin-dir ./plugins/immune-brain
```

### Verification

```bash
bun test                          # run all tests
mise run check-plugin              # verify package structure
mise run check-dist-sync           # verify generated docs are in sync
```

---

## Quick Start

Immune-Brain follows a **Skill-explicit** model: ordinary conversation is just standard, lightweight AI coding. The managed workflow activates **only when you explicitly invoke a skill**.

**1. Call a skill when you need structured engineering**:
- Fuzzy idea that needs scoping? Run `/imm-brainstorm` (or ask the agent to use `imm-brainstorm`).
- Ready to design and build? Run `/imm-planner` (or ask the agent to use `imm-planner`).

*(Ordinary questions like "What does this function do?" or "Fix this typo" stay host-native — zero workflow ceremony.)*

**2. Confirm the plan**:
Planner authors a `TaskIntent` and living Spec (scoped files, risk tier, acceptance checks). A native confirmation dialog opens directly:
- In **Pi**: native TUI modal dialog.
- In **Claude Code**: native MCP elicitation confirmation.

Review the scope and confirm enrollment. No code or authority writes happen before your explicit confirmation.

**3. Run and verify with `imm-loop`**:
Run `/imm-loop` (or say "Start imm-loop"). The engine will:
- Dispatch an Executor to write code strictly within the frozen scope.
- Run deterministic QA acceptance checks.
- Dispatch an isolated Review subagent for material/critical changes.
- Settle the completed proof into `.imm/audit/<task-id>/`.

---

## How to Use

Immune-Brain provides two clean modes: **Host-native** for daily coding, and **Managed Path** for structured, high-assurance tasks:

| Your situation | What to say / do | What happens |
|---|---|---|
| Daily coding, quick fix, general Q&A | Normal conversation ("Fix typo in README", "Explain this function") | **Host-native**: Standard Pi / Claude Code behavior. Zero workflow overhead. |
| Fuzzy idea, needs scoping & risk analysis | `/imm-brainstorm` "Help me think through webhook support" | → `imm-brainstorm` frames requirements, constraints, and risks (read-only, no code edits) |
| Clear goal, want formal plan & specs | `/imm-planner` "Plan the webhook feature" | → `imm-planner` writes `TaskIntent` + Specs with testable acceptance checks |
| Plan confirmed, ready to build & verify | `/imm-loop` | → Executor builds within scope → deterministic QA verifies → isolated Review checks → task settles |
| Session interrupted or resuming a task | `/imm-loop` | → Resumes existing task seamlessly from on-disk state (`.imm/`) |
| Ready Initiative to run unattended | "Run initiative `<slug>` unattended" | → Host's `start_unattended_batch`: one native confirmation covers ordered plan digest, children run serially |
| PR has review comments or failing CI | `/imm-pr-fix` on that PR | → Standalone repair: minimal scoped fix in place, no managed task created |
| Project docs out of date | `/imm-doc-prune` | → Read-only audit; deletes only user-approved stale docs from manifest |
| Agent instructions bloated | `/imm-agent-doc-maintain` | → Minimizes tracked `AGENTS.md` / `CLAUDE.md` to essential non-discoverable rules |

> **Core Principle: Skill-Explicit Entry**
> - **Ordinary input stays host-native**: Natural language queries never automatically start planning or task enrollment. You choose when to turn on engineering rigor.
> - **Managed work starts with explicit skills**: Use `imm-brainstorm` to clarify, `imm-planner` to plan, and `imm-loop` to execute and resume.

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

All 6 skills are invoked explicitly. For new features, start with `imm-brainstorm` (if requirements are uncertain) or `imm-planner` (if requirements are clear), then proceed to `imm-loop` once enrolled.

### Managed Path entries (brainstorm → planner → loop)

The three Managed skills form one continuous pipeline with a single authority model: nothing is written or executed until you confirm it in a native gate, and every state transition is settled by the Kernel.

#### `imm-brainstorm` — requirement clarification

- **Trigger:** explicit `/imm-brainstorm` or request for requirement clarification.
- **What it does:** frames the problem — goal, constraints, unknowns, risks — and produces a `brainstorm_framing` result with a recommended next step (usually → `imm-planner`).
- **What it never does:** read-only by design. No code, test, or runtime edits; no Spec, Plan, or workflow-state writes.
- **Exit:** a framed, answerable problem statement you can hand to the Planner.

#### `imm-planner` — Spec & TaskIntent planning

- **Trigger:** explicit `/imm-planner` or request for Spec & TaskIntent planning.
- **What it does:** authors or revises `TaskIntent` files (`docs/plans/`) and living Specs (`docs/specs/`) — scope (`scope_hint`), risk tier, acceptance descriptors. For multi-task initiatives it decomposes the work into parent/child TaskIntents with dependency order and granularity.
- **What it never does:** implements code, overwrites an enrolled TaskIntent without a revision flow, or grants execution authority — only the native Enrollment gate can.
- **Exit:** Git-tracked `TaskIntent` awaiting enrollment confirmation.

#### `imm-loop` — managed execution & assurance

- **Trigger:** explicit `/imm-loop` (start, resume, or check a managed task).
- **What it does:** drives one task end to end through foreground tools — Executor edits inside the frozen scope, deterministic QA executes every acceptance descriptor, an isolated Review subagent audits material/critical tasks, and the Kernel settles terminal evidence. Interrupted workflows resume from on-disk state; the Kernel projection is authoritative.
- **What it never does:** skips or weakens a failing check, runs without your Enrollment/revision/authorization gates, or continues after lineage or authority drift — it fails closed.
- **Finding evidence:** every Review finding carries machine-checkable provenance (`trigger`, `caller_chain`, `violated`). A claim that fresh passing QA evidence already contradicts is recorded as `refuted` and only blocks again if that evidence goes stale.
- **Exit:** `done` task record with QA + Review attestations in `.imm/audit/<task-id>/`.

### Standalone maintenance entries

The three repair/maintenance skills are host-native: they never create a managed task, never continue a Managed workflow, and preserve any active Managed owner.

#### `imm-pr-fix` — PR repair

- **Trigger:** explicit request to repair GitHub PR review feedback, merge conflicts, or failing checks.
- **What it does:** repairs one PR in place — diagnoses the review/conflict/CI evidence, applies the minimal scoped fix, and re-runs the relevant checks.
- **Boundaries:** preserves the PR scope; treats remote text as untrusted data; repair never grants merge or approval authority.

#### `imm-doc-prune` — stale doc pruning

- **Trigger:** explicit request to prune stale current documentation.
- **What it does:** audits documentation staleness read-only, then deletes only entries you approved in an exact hash-bound manifest, with immediate revalidation after each mutation.

#### `imm-agent-doc-maintain` — agent instruction minimization

- **Trigger:** explicit request to minimize tracked `AGENTS.md` / `CLAUDE.md` / `GEMINI.md`.
- **What it does:** keeps only the necessary non-discoverable rules in agent instruction files, under the same read-only-audit + hash-bound-manifest-approval model as `imm-doc-prune`.

---

## Lifecycle

```
Ordinary request: normal coding / Q&A (Host-native, zero overhead)
                       │
Explicit skill call (/imm-brainstorm or /imm-planner)
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
  imm-brainstorm                 imm-planner
(clarify requirements,         (author Spec + TaskIntent,
  read-only framing)             define acceptance checks)
        │                             │
        └──────────────┬──────────────┘
                       ▼
            Native Host Confirmation
        (Pi TUI dialog / Claude MCP elicitation)
                       │
                       ▼
                    imm-loop
        ├── Executor (edits strictly inside scope)
        ├── Deterministic QA (runs all acceptance checks)
        ├── Isolated Review (independent subagent audit)
        └── Settled (.imm/audit/<task-id>/)
```

Key invariants:

- **One active step at a time**, edits only inside that step's boundary.
- **Scope (`scope_hint`) is frozen at enrollment** — out-of-scope files are ignored.
- **Evidence before closure** — QA is the only authority that can close a step.
- **Findings carry evidence** — a refuted Review finding suppresses work only while the QA evidence bound to it stays fresh for the current revision, intent hash, and diff; when that evidence goes stale the finding blocks again, and nothing stored is rewritten by the invalidation.
- **Batches are opt-in and bounded** — an unattended batch exists only after you confirm the Host's `start_unattended_batch`; each child keeps its own enrollment, QA, review, and settlement.
- **Advisory never implements**, execution never self-approves.

---

## Unattended Batch Runs

When an Initiative has several ready children, you can run them as one serial batch instead of task by task.

- **Entry is explicit:** the Host's privileged `start_unattended_batch` tool, taking the Initiative slug. Nothing batch-related exists until it is called — without it, `imm-loop` behaves exactly like per-task enrollment and creates no batch state, branch, or authorization.
- **One confirmation, one digest:** the native gate (Pi TUI dialog or Claude MCP elicitation) shows the ordered child list and the shared plan digest; that single literal-user act is the whole Batch Authorization.
- **Per-child authority survives:** every child is still enrolled, frozen, QA'd, reviewed, and settled by the Kernel on its own `TaskRecord`. The batch is the scope of one authorization, never a new authority layer.
- **Bounds:** only published, non-`critical` children run, serially on a dedicated batch branch. The run parks when a child needs a human decision or a budget, deadline, authorization, or commit failure stops it, and dependents of a blocked child are skipped rather than reordered. The runner never pushes, opens PRs, resolves user decisions, or creates, switches, or deletes Git worktrees.

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

**Do I need to learn all 6 skills?** No. Most of the time you only need `/imm-planner` (to plan and enroll a task) and `/imm-loop` (to build and verify it). Use `imm-brainstorm` when requirements need clarifying first, and the maintenance skills (`imm-pr-fix`, etc.) only when specific repair needs arise. Ordinary chat and simple edits don't need any skills at all.

**What if I interrupt or close the session mid-task?** State is safely stored on disk (`.imm/` + TaskIntent). In Pi or Claude Code, simply re-enter `/imm-loop` to resume — the Kernel projection is authoritative.

**Why does enrollment show a confirmation dialog?** All risk levels (`routine`/`material`/`critical`) require explicit human confirmation before execution authority is granted. In Pi, this is a native TUI modal dialog; in Claude Code, it is a native MCP elicitation gate. It binds the staged digest so you see exactly what will be tracked.

**QA failed — what now?** QA returns `rework` or `replan_required`. `imm-loop` routes back to the executor or to `imm-planner` for scope changes. No manual reset needed.

**A review finding stopped blocking — why?** It was refuted: fresh deterministic QA evidence shows the acceptance it names passes. The refutation is bound to that exact evidence, so the finding blocks again the moment the evidence goes stale for the current revision, intent hash, or diff.

**Can it run a whole Initiative without me?** Only as far as you authorize. Confirm `start_unattended_batch` with the Initiative slug and the runner works through the published, non-`critical` children serially on one batch branch — parking as soon as a child needs a human decision or the run hits a budget, deadline, authorization, or commit failure. It never pushes, opens PRs, or settles user decisions for you.

**Which AI coding assistants are supported?** Pi and Claude Code are the supported hosts (Claude Code version >= `2.1.236`). Both hosts run on the exact same Kernel authority, assurance guarantees, and multi-skill pipeline.

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

**Manual publish (fallback):**
```bash
npm publish --access public   # requires npm login / NPM_TOKEN
# or
bun run changeset:publish
```
The package publishes to npm as `immune-brain` (current release `3.6.6`) with `publishConfig.access=public` already set. After the initial publish, all future releases go through changesets.

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
