# Antigravity Harness: third first-class host adapter for Immune-Brain

## Problem Statement

Immune-Brain currently supports Pi and Claude Code as first-class harnesses (ADR 0004). Developers and automated workflows operating in Google Antigravity—either through the terminal-based Antigravity CLI (`agy`) or the Antigravity 2.0 desktop application and IDE—cannot run Immune-Brain's Managed Path under native host governance. 

While Antigravity provides a rich customization ecosystem (skills, rules, lifecycle hooks, and MCP servers), it differs significantly from Pi and Claude in its hook lifecycle events (`SessionStart`, `PreToolUse`, `PostToolUse`, `PreInvocation`, `PostInvocation`, `Stop`), subagent orchestration primitives (`define_subagent` and `invoke_subagent`), and headless batch execution capabilities (`agy --print`). Without a dedicated harness adapter, Antigravity users cannot benefit from Immune-Brain's Assurance Kernel, native enrollment gates, deterministic QA, independent code reviews, run continuation, or isolated batch lanes.

## Solution

Implement `antigravity` as the third first-class harness for Immune-Brain, maintaining strict parity with Pi and Claude Code while honoring Kernel neutrality.

The solution provides:
1. A unified host identity (`"antigravity"`) across the Assurance Host Port, configuration resolvers, and unattended lane supervisors.
2. An integrated native Antigravity plugin packaged within the existing repository structure, governed by root manifest versioning.
3. Dual execution surface support:
   - **Interactive Frontend (CLI & Desktop App)**: Native enrollment gate enforcement using `PreInvocation` and `PreToolUse` hooks (`force_ask`), read-only reviewer subagent dispatch using `define_subagent` (`EnableWriteTools: false`) and `invoke_subagent`, and session-bound run continuation driven by the `Stop` hook.
   - **Headless Unattended Execution (`LaneSupervisor`)**: Background worker execution automatically routed to `agy --print --dangerously-skip-permissions` with explicit model and effort flags for isolated Git worktree lane children.
4. Dual-mode status visualization: Terminal-friendly Markdown tables for MCP tool responses, coupled with native Markdown Artifacts written to the session artifact directory to illuminate the Antigravity 2.0 Auxiliary Pane.

## User Stories

1. As an Antigravity developer, I want to invoke `/drive <task_id>` in my terminal or chat canvas, so that I can initiate a managed task under Kernel authority.
2. As an Antigravity developer, I want the host to present a native confirmation gate when an agent attempts Enrollment, so that workspace claims cannot be established without explicit human approval (ADR 0019).
3. As an Antigravity developer, I want `PreInvocation` hooks to capture my explicit `/drive` prompt as a session-bound Run Entry Token, so that unauthorized tool calls are rejected before mutating Kernel state (ADR 0025).
4. As an Antigravity developer, I want the runtime to define a dedicated `immune-brain-reviewer` subagent with write tools disabled, so that code reviews are strictly read-only and cannot mutate workspace files (ADR 0003).
5. As an Antigravity developer, I want the reviewer subagent to be dispatched via `invoke_subagent` with an immutable review packet, so that the review receipt is cryptographically bound to the evaluated snapshot.
6. As an Antigravity developer, I want the `Stop` lifecycle hook to intercept turn completion when an active task has open obligations, so that the agent loop continues executing without manual re-prompting.
7. As an Antigravity developer, I want the `Stop` lifecycle hook to release loop execution when a task settles (`done` or `stopped`) or requires human input (`awaiting_user`), so that the host does not run unnecessary model cycles.
8. As a developer running an unattended batch or single-task Lane, I want `LaneSupervisor` to launch `agy --print --dangerously-skip-permissions`, so that child lane workers execute non-interactively in clean worktrees without hanging on permission prompts.
9. As a developer configuring lane preferences, I want to set `executor_host: "antigravity"`, so that background child tasks run using the Antigravity agent engine.
10. As a developer configuring lane preferences, I want my declared `executor_model` and `executor_effort` settings forwarded as `--model` and `--effort` flags to `agy`, so that reasoning capacity matches my specifications.
11. As an Antigravity 2.0 Desktop App user, I want task status and verification results to appear in the Auxiliary Pane's Artifacts tab, so that I have immediate graphical visibility into assurance progression.
12. As an Antigravity CLI user, I want status commands to return structured Markdown tables in stdout, so that I have a clean terminal overview without needing a GUI.
13. As a developer, I want `PreToolUse` and `PostToolUse` hooks to observe review lifecycle events, so that review receipts are verified and submitted to the Kernel without trusting self-reported model claims.
14. As a plugin consumer, I want Antigravity manifest files (`plugin.json`, `mcp_config.json`, `hooks.json`) to ship alongside Pi and Claude artifacts in the same npm package, so that distribution remains consolidated.
15. As a maintainer, I want `scripts/plugin_versioning.ts` to validate Antigravity manifest version parity against root `package.json`, so that version drift across hosts is caught during release verification.
16. As a maintainer, I want multi-host assurance conformance tests to verify that Antigravity produces identical Kernel state transitions to Pi and Claude Code across Enrollment, QA, Review, and Settlement, so that host parity is mathematically assured.

## Implementation Decisions

### 1. Unified Host Identification and Capability Extension
- Add `"antigravity"` to the supported host type union in the Assurance Host Port, Lane Supervisor, and Layered Configuration:
  ```typescript
  // prototype-derived host union
  export type ExecutorHost = "claude-code" | "pi" | "antigravity";
  ```
- The runtime maps `"antigravity"` to Antigravity-specific hook behaviors, subagent dispatch protocols, and the `agy` CLI binary.

### 2. Plugin Packaging and Manifest Colocation
- Following ADR 0004 multi-host principles, place Antigravity manifests within the primary plugin directory:
  - Root plugin manifest declaring plugin name, version, author, and description.
  - MCP configuration pointing to the compiled stdio server bundle.
  - Lifecycle hook configuration defining handlers for `PreInvocation`, `PreToolUse`, `PostToolUse`, `Stop`, and `SessionStart`.
- Release scripts validate that the Antigravity manifest version matches the root package manifest and Claude manifest.

### 3. Native Enrollment Gate (ADR 0019 / ADR 0025)
- **Token Capture**: `PreInvocation` monitors `lastUserInput`. When explicit `/drive` or `/immune-brain:drive` commands are observed, a session-bound and workspace-bound run entry token is recorded.
- **Tool Interception**: `PreToolUse` intercepts calls to `enroll` and `start_unattended_batch`. If an unadmitted call is detected, the hook returns:
  ```json
  {
    "decision": "force_ask",
    "reason": "Enrollment requires literal user authorization: <task_id> (<summary>)"
  }
  ```
- In interactive environments (App and CLI TUI), this forces the host to present its native permission gate. In headless print mode, unapproved calls fail closed.

### 4. Read-Only Reviewer Subagent Dispatch (ADR 0003 / 0004 / 0030)
- On first review dispatch or session initialization, the adapter registers the reviewer role using the host's `define_subagent` facility:
  - Tool restrictions: `EnableWriteTools` set to `false`, granting read-only inspection tools (`read_file`, `grep`, `glob`, `bash` read operations).
  - Instructions: Role prompt composed from the base review prompt and static review rules.
- Review obligation triggers dispatch via `invoke_subagent`.
- `PreToolUse` and `PostToolUse` hooks observe execution, write the immutable review packet, collect the reviewer output receipt, and submit the evidence to `AssuranceCoordinator`.

### 5. Session Continuation via Stop Hook (ADR 0019)
- The `Stop` hook observes termination signals (`NO_TOOL_CALL`).
- It inspects the SQLite Kernel assurance projection for the active task bound to the current `conversationId`:
  - If the task lifecycle is `active` and open obligations exist for automated steps (QA, Review, Finding resolution, autocommit): returns `{ "decision": "continue", "reason": "..." }`.
  - If the task lifecycle is `done`, `stopped`, or has obligation `awaiting_user`: returns `{}` allowing clean termination.

### 6. Lane Supervisor Headless Execution
- When `LaneSupervisor` spawns an executor for host `"antigravity"`:
  - Executable: `agy` discovered from `PATH`.
  - Command arguments:
    ```typescript
    // prototype-derived argument formatting
    [
      "--print",
      "--dangerously-skip-permissions",
      ...(choice.model ? ["--model", choice.model] : []),
      ...(choice.effort ? ["--effort", choice.effort] : []),
      `/drive ${taskId}`
    ]
    ```
  - Standard process monitoring tracks PID, exit codes, and signals without manufacturing artificial events.

### 7. Dual-Mode Status and Artifact Output
- Standard tool responses emit structured Markdown summaries and obligation instructions.
- Simultaneously, status updates write `assurance-status.md` into `<artifactDirectoryPath>`, automatically surfacing task progression cards and diagrams in the Antigravity Desktop App Auxiliary Pane.

## Testing Decisions

### Testing Philosophy
- Tests must verify observable external behavior across host boundaries, not internal module implementations or mocked database state.
- Existing seams must be reused. The primary seam is the `AssuranceCoordinator` and `AssuranceHostPort` contract suite.

### Modules Tested
- **Host Port Conformance**: Testing `AntigravityHostAdapter` across the complete task lifecycle (Enrollment -> QA -> Review -> Settlement).
- **Gate Enforcement**: Proving that unadmitted `enroll` calls trigger `force_ask` and that pre-invocation tokens admit authorized calls.
- **Reviewer Dispatch**: Verifying that `define_subagent` configures write-tool restrictions and that receipts match snapshot digests.
- **Stop Hook Continuation**: Asserting that active tasks trigger loop continuation and settled tasks exit cleanly.
- **Lane Supervisor**: Testing that `agy` process arguments and generation states conform to supervisor invariants.

### Prior Art
- `tests/dual-host-assurance-conformance.test.ts`: Primary conformance test for Pi and Claude Code adapters.
- `tests/claude-run-continuation.test.ts`: Lifecycle hook stop and continuation verification.
- `tests/single-task-lane-batch.test.ts`: Lane supervisor dispatch and exit observation.

## Out of Scope

- Developing proprietary Electron UI extensions or custom DOM webviews (Antigravity 2.0 does not admit external webview plugins; native Artifacts are used).
- Modifying Kernel SQLite schemas, `TaskRecord` state definitions, or `TaskIntent` contracts.
- Altering existing `pi` or `claude-code` host adapters.
- Implementing remote agent execution without a local worktree claim.

## Further Notes

- Once this specification is implemented, [ADR 0004](docs/adr/0004-dual-host-assurance-adapters.md) will be amended or superseded by a new ADR documenting the evolution to multi-host assurance adapters.
