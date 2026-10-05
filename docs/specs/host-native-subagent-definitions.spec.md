# Host-Native Subagent Definitions

## Status, ownership, and outcome

This is the shared candidate Spec for Initiative `host-native-subagent-definitions`, a four-Slice plan. The user confirmed the Initiative name, slug, the four-Slice decomposition and its dependencies, the revision that withdrew one upstream item, the Claude-only coverage of S4, and the decision not to add a native turn cap in S1. It grants no execution authority; each TaskIntent still requires the current Host's native Enrollment gate.

Outcome: the shape of a subagent (tool boundary, static role instructions, foreground/background, dispatch parameters) is carried by each Host's native agent definition wherever the Host can enforce it. The Kernel keeps authority only: immutable snapshot, receipt authentication, verdict validation and role routing.

Carrier: one GitHub Parent with four native Sub-issues (repository default `Initiative carrier default: github`). S1 and S2 are independent and runnable now. S3 follows S1 and additionally waits for `review-prompt-exact-binding` (#148) and `review-pass-path-coverage` (#149) of Initiative `review-settlement-hardening`. S4 follows S3.

**Design risk**: High. S3 changes the shared Review dispatch request consumed by the host-neutral coordinator, the Claude Host and the Pi extension, and moves reviewer instructions between a generated agent definition and the dispatch prompt. S1 and S4 are Medium: Claude Host dispatch shape and packaged definitions, with no Kernel authority or persisted state. S2 is Low: reference prose only.

**Design views**: service interface (the Review dispatch request and envelope, and the generated agent definitions, are the whole change) and architecture layers (which layer owns static instructions versus per-dispatch facts). Data flow, state transitions and temporal sequence are omitted: no reservation state, release decision, hook event order or evidence pipeline changes in any Slice.

**Diagram decision**: not_required

**Diagram reason**: each Slice moves one definition to a different owner; the ownership table under Technical design expresses it completely.

**Execution posture**: test-first for S1, S3 and S4, whose acceptance is a set of shape and drift controls that pass vacuously unless the test exists first. S2 is a retirement: deletion of the prose is the completion condition.

## Evidence and discovery closure

Current behavior, read from the repository at `856ef49`:

- `plugins/immune-brain/agents/immune-brain-reviewer.md` is the only native agent definition shipped. Its frontmatter is `name`, `description`, `tools: Read, Grep, Glob, Bash`. The allowlist already excludes `Agent`, `Edit`, `Write` and `NotebookEdit`, so nested dispatch and file edits are natively denied; no test pins the allowlist.
- `plugins/immune-brain/runtime/claude/review_host.ts` `prepareReview` returns the dispatch envelope `{ name, prompt, max_turns, run_in_background: false }`. The Claude `Agent` tool has no turn-limit parameter, and the comment above `parseAsyncAgentLaunch` records that `run_in_background: false` is not honoured. Both fields have no receiver. No runtime code reads them back; `tests/claude-host-authority.test.ts` constructs one literal carrying them.
- `plugins/immune-brain/runtime/assurance/coordinator.ts` `reviewTurnBudget` yields 12/16/24 and is passed as `ReviewRequest.maxTurns`. The Pi port forwards it as a native parameter. `buildReviewPrompt` does not state the budget, so on Claude it has no effect today.
- `buildReviewPrompt` concatenates the `code-review` role packet (the text of `runtime/prompts/code-review.md` plus context), the evidence contract, static rules (read-only, final-turn JSON, finding provenance) and snapshot facts (digests, revisions, acceptance, verdict shapes carrying the task id and digest). The read-only rule and the final-turn JSON rule also appear in the agent definition body.
- `plugins/immune-brain/runtime/role_prompt_bridge.ts` `INTERNAL_ROLE_PROMPTS` declares nine roles with a `tool_policy` string that is only rendered into prompt text. `plugins/immune-brain/runtime/loop_contract.ts` `loopRoleSubagentFor` maps roles to Pi agent types; nothing under `runtime/claude/` imports either module, and the Claude MCP server exposes no role dispatch tool.
- `docs/reference/workflow-and-subagents.md` lines 181-357 describe a fourteen-field Subagent Manifest Contract, eight "core subagents" (`context-mapper`, `scope-reviewer`, `planner`, `executor`, `qa-verifier`, `code-reviewer`, `ui-reviewer`, `knowledge-compounder`) and a scenario activation matrix. None has a runtime counterpart; the runtime roles are the nine keys of `INTERNAL_ROLE_PROMPTS`. The advisory lens paragraphs in the same range do correspond to the `advisory-reviewer` role and stay. The file has no packaged mirror; `tests/pi-only-current-contracts.test.ts` and `tests/subagent-activation-contract-retirement.test.ts` only list it as a file that must not contain retired tokens.

Host capability, read from the Claude Code subagent documentation on 2026-10-05: plugin-shipped agents support `tools`, `disallowedTools`, `model`, `maxTurns`, `skills`, `background`, `effort`; they ignore `hooks`, `mcpServers` and `permissionMode`. A read-only Bash boundary therefore cannot be expressed natively and remains covered by snapshot isolation.

Related confirmed decisions:

- `docs/specs/review-settlement-hardening.spec.md` BR-REQ-3 put three sentences into the reviewer definition (no continuation, verbatim reserved prompt, recovery only through the returned recovery action); `tests/claude-host-package.test.ts` asserts them. They stay in every Slice.
- #148 changes `bindsStart` to full prompt equality; #149 adds `inspected_paths` text to `buildReviewPrompt` and the reviewer definition. S3 restructures the same prompt and definition and therefore runs after both.

Consumers and mirrors:

- `plugins/immune-brain/dist/claude/mcp-server.mjs` inlines the runtime; rebuild and check with `bun scripts/build-claude-plugin.ts` (`--check`).
- `ReviewRequest` is constructed once in `coordinator.ts` and consumed by `review_host.ts` and `.pi-extension/pi-canary-assurance-progression.ts`; test doubles build it in `tests/claude-host-authority.test.ts`, `tests/claude-review-host-async-agent.test.ts` and `tests/host-neutral-assurance-coordinator.test.ts`.
- `buildReviewPrompt` is asserted in `tests/host-neutral-assurance-coordinator.test.ts`, `tests/pi-canary-assurance-progression.test.ts`, `tests/pi-canary-assurance-authority.test.ts` and `tests/pi-canary-review-outcome-evidence.test.ts`.
- `runtime/prompts/*.md` mirror to `dist/role-prompts/` (`scripts/dist-sync-manifest.ts`); `tests/dist-docs-sync-contract.test.ts` and `tests/baseline-packaging-contract.test.ts` check the mirror.
- `plugins/immune-brain/dist/imm-loop.md` and `dist/imm-planner.md` are their own authoring sources. `docs/reference/subagent-dispatch-protocol.md` mirrors to `dist/docs/reference/`.

## Analysis Trace

| ID | Upstream item or decision | Coverage |
| --- | --- | --- |
| AN-1 | Reviewer turn budget as a native cap | Decided: not added. A cap would stop a reviewer mid-work and leave a retained reservation with no result (`review_host.ts`, "transcript carries no reviewer result"). The budget stays unenforced on Claude |
| AN-2 | Remove the receiver-less `run_in_background` and `max_turns` from the Claude envelope | S1, HNS-S1-A1 |
| AN-3 | Native reviewer tool boundary | S1, HNS-S1-A2. Already native through the allowlist; the Slice pins it |
| AN-4 | Move Parent duties out of the reviewer definition | Withdrawn: it reverses BR-REQ-3 of `review-settlement-hardening` |
| AN-5 | One source for static reviewer instructions | S3, HNS-S3-A1 and HNS-S3-A2 |
| AN-6 | Enforce the read-only roles' tool boundary natively | S4, HNS-S4-A1 and HNS-S4-A2 (Claude only) |
| AN-7 | Retire the fictional manifest prose | S2, HNS-S2-A1 |
| DEC-1 | S4 covers the Claude Host only; Pi agent configuration is user-owned | S4 |
| DEC-2 | S3 runs after #148 and #149 | Slice decomposition |
| OUT-1 | Whether the `qa` role itself should retire | Not planned |
| OUT-2 | Review authentication chain, verdict schema, model selection | Not planned; already correct |

## Technical design

### Ownership after the Initiative

| Concern | Owner | Enforced by |
| --- | --- | --- |
| Tool boundary of a Claude agent | Agent definition frontmatter | Host |
| Static role instructions on Claude | Agent definition body, generated from `runtime/prompts/` | Host loads it; build check prevents drift |
| Static role instructions on Pi | Dispatch prompt | Unchanged; the Pi agent is user-owned |
| Per-dispatch facts (digests, revision, acceptance, verdict shapes) | Dispatch prompt built by the coordinator | Kernel |
| Receipt authentication, snapshot binding, verdict validation, role routing | Runtime | Kernel |

### Common invariants

- No Kernel schema, TaskRecord field, persisted approval, Enrollment rule, reservation state, release decision or hook event shape changes in any Slice.
- The three BR-REQ-3 sentences remain in the reviewer definition, whether hand-written or generated.
- Pi dispatch parameters and Pi prompt content are unchanged except where S3 states otherwise.
- The generated Claude bundle and every generated definition change in the same Slice as their source.

### S1: Claude reviewer dispatch shape

`prepareReview` returns `{ name, prompt }`. `max_turns` and `run_in_background` are removed from the Claude envelope and from the comment that explains them. `ReviewRequest.maxTurns` stays on the shared type because the Pi port consumes it; the Claude port ignores it. Binding, observation, settlement and every blocked result are unchanged.

A package test pins the reviewer definition: the tool allowlist is exactly `Read, Grep, Glob, Bash`, and the frontmatter declares none of `hooks`, `mcpServers`, `permissionMode`, which a plugin agent ignores and which would otherwise read as enforced.

Compatibility: a Parent that copies the envelope into the `Agent` call loses two parameters the tool never accepted. No stored state refers to them.

### S2: retire the fictional manifest prose

Delete from `docs/reference/workflow-and-subagents.md`: the Subagent Manifest Contract, the core-subagent list and table, the minimal JSON output contract attached to them, and the scenario activation matrix. Keep the authority and routing boundary, the authorization policy, the advisory lens sections and the model selection note. Replace remaining mentions of the retired names (in the authority-class examples and the lens fallback sentences) with the runtime role names, and add one table mapping each runtime role to its authority.

The retirement test asserts that the retired names and headings are absent and that the set of role names in the mapping table equals the keys of `INTERNAL_ROLE_PROMPTS`, so the reference cannot drift into a second roster again.

### S3: one source for static reviewer instructions

Interface: `ReviewRequest` gains `snapshotPrompt: string`, the per-dispatch facts alone. `prompt` keeps its meaning (the complete prompt for a Host whose agent carries no instructions). The coordinator builds both from one function pair so that `prompt` is the static block followed by `snapshotPrompt`. Every sentence of today's `buildReviewPrompt` remains in `prompt`; the order may regroup static text first.

Claude Host: the envelope prompt is the reservation marker followed by `snapshotPrompt`, and binding compares against that same string under the rule #148 establishes. The static block is not sent.

Generation: `scripts/build-claude-plugin.ts` writes the reviewer definition body from `runtime/prompts/code-review.md` plus the exported static review rules, followed by the BR-REQ-3 sentences and the `inspected_paths` statement from #149. The frontmatter is fixed in the generator. `--check` fails when the committed definition differs from the generated one.

Compatibility: the definition and the bundle ship in one plugin version and load from one install, so a session never pairs a new runtime with an old definition. Pi callers read `prompt` and are unaffected. The role packet's prompt digest is computed as today.

Failure behavior: if generation is skipped, `--check` and the package test fail; nothing degrades silently at runtime.

### S4: native definitions for the read-only roles on Claude

The generator from S3 also writes `immune-brain-advisory-reviewer`, `immune-brain-ui-review` and `immune-brain-qa`, each with `tools: Read, Grep, Glob` and a body taken from the matching `runtime/prompts/` file. These roles declare `no tools`; a native definition cannot express an empty allowlist without inheriting every tool, so the strictest expressible boundary is read-only without shell.

A table under `runtime/claude/` maps role to agent name. A test asserts that every mapped role's declared boundary in `INTERNAL_ROLE_PROMPTS` is `no tools` or `read-only tools`, that each mapped definition exists, and that its allowlist contains no write, shell or dispatch tool. `arch-explorer` maps to the Host's own `Explore` agent and ships no definition. `loopRoleSubagentFor` is the Pi mapping and does not change; this deviates from the wording of the confirmed table because the Claude runtime never consumed it.

Contract prose: the Loop and Planner contracts and the dispatch protocol state that on the Claude Host a read-only role is dispatched through the `Agent` tool by its plugin agent type, and that the definition, not prompt text, bounds its tools. Pi wording is unchanged and notes that agent configuration belongs to the Pi user.

S4's scope is re-traced against the tree S3 leaves before Enrollment; the generator and package test are shared with S3.

## Slice decomposition, dependencies, and acceptance mapping

Task IDs are `claude-reviewer-native-shape`, `retire-subagent-manifest-reference`, `reviewer-prompt-single-source` and `claude-readonly-role-agents`.

| Slice | Risk | Closable result | Remaining gap after it | Blockers | Acceptance | Focused verification |
| --- | --- | --- | --- | --- | --- | --- |
| S1 | material | The Claude reviewer envelope carries only fields the Host accepts; the native tool boundary is pinned | Static instructions still duplicated; other roles unbounded | None | HNS-S1-A1, HNS-S1-A2 | Claude host authority, async-agent and package tests |
| S2 | routine | The reference describes only roles that exist | None for the reference | None | HNS-S2-A1 | Subagent retirement contract test |
| S3 | material | Static reviewer instructions have one source; Claude dispatch carries facts only | Other read-only roles unbounded on Claude | S1; #148 and #149 | HNS-S3-A1, HNS-S3-A2 | Claude host and package tests; host-neutral coordinator and Pi review prompt tests |
| S4 | material | Read-only roles have native, generated definitions on Claude | Turn budget unenforced on Claude (AN-1); Pi boundary remains prompt text (DEC-1) | S3 | HNS-S4-A1, HNS-S4-A2 | Claude package test; Loop and Planner contract tests |

Descriptors use `bun test` with explicit file arguments, `prepare` null and no writable paths. `bun` is provided by the QA host; every test dependency is tracked repository content.

This Spec is intentionally absent from every `scope_hint`: no Slice edits it.

## Devil's Advocate Audit

- **Rollback resilience**: every Slice is a single revertible commit with no persisted state. A partially applied S3 (runtime split without regenerated definition) fails `--check` and the package test rather than running a reviewer without instructions. A partially applied S4 leaves unused definitions and no behavior change.
- **Verification vanity**: S1's envelope control asserts the exact key set, so re-adding a field fails. S3's drift control compares generated and committed bytes; its dispatch control asserts that a static sentence is absent from the Claude prompt and present in the Pi prompt, so a prompt that merely grew cannot pass. S4's boundary control reads the shipped frontmatter, not the runtime string. S2's set-equality control fails on both a stale and a missing role. Limit: no test can prove the Host honours a frontmatter field; the tests prove the definition asks for it.
- **Spec dilution**: AN-4 and AN-1 are recorded as decided against, not silently dropped. The remaining gaps in the table name what the Initiative does not deliver: a turn budget on Claude and native enforcement on Pi.
