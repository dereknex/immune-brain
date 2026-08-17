# Spec: Memory Lifecycle Management (MLM)

## Background
The `Immune-Brain` system compounds learnings into `docs/solutions/` and tracks task history in `.imm/memory/MEMORY.md`. Over time, these artifacts grow, increasing context token usage and reducing signal-to-noise ratio.

## Goals
- Maintain `.imm/memory/MEMORY.md` as a high-signal, short-term memory source.
- Provide a dedicated slot for long-term project context that doesn't rotate.
- Prevent fragmentation of `docs/solutions/` by favoring fewer, "thicker" thematic hub documents.

## Accepted Behaviors

### 1. .imm/memory/MEMORY.md Structure
- **Core Context**: A new section `## 核心上下文` (or `## Core Context`) at the top of the file. This section is static and managed manually by the planner/reviewer. It holds 3-5 high-level project constraints or active architectural shifts.
- **Task History**: The `## 任务历史` section will have a maximum of 15 entries.
- **Rotation**: When a new task is finished, if the total entries exceed 15, the oldest entries (bottom of the list) are moved to a durable archive.

### 2. Mechanical Archiving
- Trigger: Execution of `imm-finish`.
- Action: 
    - Identify entries in `.imm/memory/MEMORY.md`'s `## 任务历史` section.
    - If count > 15:
        - Cut the excess entries.
        - Append them to `docs/archives/history.md` (creating the file if it doesn't exist).
        - Ensure a separator or timestamp is added to the archive for clarity.
- Mechanism: Non-LLM based, deterministic string/regex manipulation.

### 3. Thematic Consolidation (Thick Docs)
- **Append-first Policy**: The `imm-compounder` skill must prioritize appending new learnings to existing "Theme Hubs" over creating new standalone files.
- **Theme Hubs**: Initial hubs include `workflow.md`, `contracts.md`, `infra.md`, and `architecture.md` under `docs/solutions/`.
- **Indexing**: All solutions must be discoverable via a central index or thematic grouping.

## Non-Goals
- Automated LLM-based summarization of history during archiving.
- Bulk migration of all 70+ existing solution files in this first iteration (this is a separate "Compound Debt" task).
- Multi-project memory synchronization.

## Success Criteria
- `.imm/memory/MEMORY.md` stays under a fixed entry limit after multiple `imm-finish` calls.
- `docs/archives/history.md` contains the displaced entries in chronological order.
- `imm-compounder` skill explicitly instructs for hub-based appending.
- All 296+ existing tests still pass.
