# OpenCode Work-Probe Contract Repair Specification

## Summary

Repair the OpenCode and packaged Skill boundary for the TypeScript work-probe lifecycle after QA found that the prior activated Step omitted the two implementation owners from Scope. This Spec is a successor design baseline; it does not modify or reinterpret the superseded lifecycle Spec.

**Design risk**: High

**Design risk rationale**: The slice changes a cross-host tool schema and argument bridge for a persisted workflow transition. Incorrect wiring can bypass strict result validation, expose a command that cannot be called by OpenCode, or let host inputs diverge from the package CLI contract.

**Diagram decision**: not_required

**Diagram reason**: The runtime state sequence is already defined by the original lifecycle Spec. This repair is a narrow host adapter mapping whose four interfaces are clearer as an explicit table than a second state or sequence diagram.

## Origin

Strict QA returned `replan` for Step U2 of `docs/plans/2026-08-09-001-fix-typescript-work-probe-lifecycle-plan.md`. The Step promised OpenCode argument translation and structured `record-probes` ingestion, but its immutable Scope omitted `plugins/immune-brain/.opencode-plugin/index.ts` and `plugins/immune-brain/.opencode-plugin/runtime.ts`, the actual schema and argv owners.

## Relationship To The Original Design

The accepted lifecycle and security requirements remain authoritative in `docs/specs/2026-08-09-typescript-work-probe-lifecycle-repair.spec.md`. This successor Spec corrects only the host integration boundary:

- `imm-work continue` creates or resumes the durable probe checkpoint and returns provider-free envelopes or an ingestible fallback packet.
- `imm-work record-probes` is the only host-facing ingestion command and delegates all identity, freshness, completeness, replay, and scope checks to the TypeScript runtime.
- OpenCode defines typed tools and translates arguments; it never writes the Ledger or normalizes child evidence itself.
- Packaged `imm-work` and `imm-executor` prose names the TypeScript module and real CLI commands, not retired Python symbols.

## Technical Design

### Components And Ownership

| Component | Owner | Responsibility |
| --- | --- | --- |
| OpenCode tool schema | `plugins/immune-brain/.opencode-plugin/index.ts` | Expose `imm_work_continue` and `imm_work_record_probes` with typed, bounded inputs. |
| OpenCode argv bridge | `plugins/immune-brain/.opencode-plugin/runtime.ts` | Translate tool inputs to the existing TypeScript CLI without validation duplication. |
| TypeScript CLI | `plugins/immune-brain/runtime/immune_brain_runtime.ts` and `commands/work.ts` | Remain the sole parser and mutation authority established by the original Spec. |
| Packaged workflow contract | `plugins/immune-brain/dist/imm-work.md` and `imm-executor.md` | Describe the host handoff, fallback packet, structured ingestion, and advisory-only evidence boundary accurately. |
| Package and host tests | Existing package/OpenCode/loop contract tests | Prove schema, argv, CLI, Skill prose, and authority boundaries stay synchronized. |

### OpenCode Tool Contract

`imm_work_continue` accepts optional `coding_agent`, `activation_mode`, `dispatch_available`, `authorized`, and `explicit_subagents` inputs. It emits argv for `imm-work continue` and adds only the flags represented by supplied values. OpenCode does not perform dispatch inside the TypeScript runtime; the returned envelopes remain host work instructions.

`imm_work_record_probes` accepts one structured payload with `step_number`, `step_id`, `expected_ledger_revision`, and `results`. The adapter serializes the complete payload to `--results-json=<json>`. It must not flatten results into free text, accept caller-provided probe scope, or create a second validation model.

### Failure Behavior

- Missing required `record-probes` fields fail in the OpenCode schema or adapter before CLI invocation.
- Runtime validation remains authoritative; stale, cross-Step, incomplete, duplicate, unknown, scope-bearing, or conflicting result packets fail closed in the TypeScript CLI.
- Unsupported host dispatch is represented by the runtime's classified fallback payload and ingested through the same `record-probes` command.
- A host tool cannot close execution, QA, final review, or the Plan from probe evidence.

### Compatibility And Rollback

The repair adds OpenCode tools and package prose but does not change schema v3, State Ledger records, Step transitions, or existing tool names. Existing OpenCode consumers remain compatible. Rollback removes the two additive OpenCode tools and synchronized prose/tests as one unit; the TypeScript CLI remains directly callable and existing persisted Steps remain readable.

### Security Invariants

1. OpenCode adapters are translation-only and never become a Ledger writer.
2. Probe `scope`, `readonly`, identity, and expected outputs come from the immutable Plan-derived envelope.
3. `expected_ledger_revision` crosses the adapter unchanged and is checked under the runtime lock.
4. Results remain structured JSON; no free-text evidence compatibility path is introduced.
5. Probe evidence remains advisory executor input and cannot grant execution, QA, review, Plan mutation, or scope-expansion authority.
6. Tests use fake results and never call provider SDKs or dispatch agents.

## Requirements

### R1. Expose the two OpenCode tools

The plugin registers typed `imm_work_continue` and `imm_work_record_probes` tools and includes them in session onboarding text.

### R2. Translate to the existing CLI exactly

The argv bridge maps the two tools to `imm-work continue` and `imm-work record-probes --results-json=<json>` without provider calls or duplicated lifecycle mutation.

### R3. Keep package prose executable

Packaged `imm-work` and `imm-executor` instructions name `plugins/immune-brain/runtime/work_probes.ts`, the real CLI commands, the host envelope/result flow, fallback ingestion, and executor consumption boundary.

### R4. Preserve the full lifecycle authority chain

Package and loop tests prove that probe evidence does not replace execution evidence, Strict QA, final code review, Compounder, or finish gates.

### R5. Prevent another runtime-retirement regression

Contract tests fail when packaged prose names retired Python APIs, when OpenCode tools disappear, when argv translation diverges, or when tests attempt provider calls.

## Acceptance Criteria

1. OpenCode exposes both additive tools with bounded schemas and documents them in injected session context.
2. Adapter tests prove exact argv for dispatch and fallback-oriented `continue` calls plus success, failure, timeout, and fallback result payloads.
3. Package-installed CLI tests prove `continue` and `record-probes` use the same TypeScript runtime path and validator.
4. Packaged Skill tests prove the TypeScript module/command names and advisory boundary while rejecting retired Python contract references.
5. Full-loop contract tests still require execution evidence and the configured QA/review authorities after probe evidence.
6. Focused U1 and U2 tests, Plan validation, and `git diff --check` pass without provider calls.

## Non-Goals

- Generic subagent dispatch or provider SDK integration.
- New State Ledger schema or probe-run persistence object.
- Changes to the activation policy or authorization protocol.
- Additional host adapters beyond the existing OpenCode surface.
- Reworking thin `SKILL.md` discovery shims.
- Refactoring the OpenCode plugin outside the two additive tool paths.
