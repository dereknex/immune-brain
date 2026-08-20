# Spec: Agent-native Discovery Navigation Layer

## Problem
Agents spend excessive tokens and turns traversing directories (via `ls -R`, `find`, or multiple `grep`) to locate relevant files for a task. This is inefficient and prone to missing context.

## Solution
Implement a three-tier discovery system that provides high-signal pointers to relevant files.

### 1. Static Layer (CONTEXT.md)
- **Purpose**: Global project navigation.
- **Section**: `## Architecture Map`
- **Format**:
  ```markdown
  - Domain Name: path/to/root, path/to/entry_file (Reason)
  ```

### 2. Dynamic Layer (.imm/memory/current_iteration.json)
- **Purpose**: Task-specific hot paths.
- **Schema Update**:
  ```json
  "steps": {
    "1": {
      "discovery_cache": [
        {"path": "skills/imm-init/SKILL.md", "reason": "Target for bootstrap updates"}
      ]
    }
  }
  ```
- **Lifecycle**: `imm-brainstorm` identifies likely hot paths -> `imm-planner` records them in the plan when useful -> `imm-plan.py` syncs them into runtime state -> `imm-executor` reads them before broad searching. New hot paths discovered during execution feed the next planner or compounder update; runtime mutation is a separate follow-up, not part of this slice.

### 3. Pattern Layer (docs/solutions/)
- **Purpose**: Heuristic discovery based on past learnings.
- **Frontmatter**:
  ```yaml
  key_files:
    - path/to/core_file
    - path/to/tests
  ```

### 4. Entry Pointers (CLAUDE.md / AGENTS.md)
- **CLAUDE.md**: "Navigation Protocol: Always check CONTEXT.md ## Architecture Map and current_iteration.json discovery_cache before searching."
- **AGENTS.md**: Lightweight index of discovery sources.

## Success Criteria
- [ ] `imm-init` bootstraps all three files with discovery templates.
- [ ] `imm-plan.py` preserves and supports `discovery_cache` in JSON output.
- [ ] `imm-compounder` instructions include updating maps and key_files.
- [ ] Brainstorm manifest maps discovery-related `BR-REQ-*` and `BR-DEC-*` items through `Brainstorm Trace`.
