# Workflow Decision Closure and Delivery Fidelity

## Status, ownership, and outcome

This is the shared candidate Spec for Initiative `workflow-decision-closure`, approved by the user as a seven-Slice, plan-only publication. Approval covers local candidate authoring/staging and one complete GitHub Parent/Child publication to `dereknex/immune-brain`. It does not authorize implementation, Enrollment, Git commits/pushes, deployment, rewriting authority/audit evidence, or changes to the original application projects. Each Child still requires its own native Enrollment before execution. Persisted documents use English; user-facing interaction remains Chinese.

Outcome: relevant decision dependencies are traversed before Brainstorm handoff; Planner preserves the complete approved outcome and stage relationships; recovery never expands a side-effect grant or mistakes a summary for authority; acceptance checks cover material invariants and executable environments; outbound publication has bounded, truthful recovery; behavioral evidence validates the workflow rather than merely the presence of instructions.

Carrier: one GitHub Parent with seven native Sub-issues. No Local Initiative carrier is created. Recommended execution is serial S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7. Semantic dependencies permit independent readiness after S1, but shared contract/fixture paths and foreground orchestration make serial execution the default. GitHub parallel groups are readiness observations, not permission to run Managed Tasks concurrently.

## Evidence and discovery closure

The motivating read-only audit inspected only the two user-named Pi sessions `01a10007-02f7-70dd-81d3-8499bcc2b6b6` and `01a100e3-9a00-7539-b3af-7cc82cc2fb79`. Evidence describes those sessions at their recorded end, not the projects' current state. Do not check in raw logs, article bodies, credentials, personal-machine paths, or model payloads. Public Issues use generalized findings and independently written acceptance summaries.

| Finding | Observed evidence | Owned remedy |
| --- | --- | --- |
| F1: decision traversal was not demonstrably closed | Product/phase branches remained implicit before handoff in both sessions | S1; S7 live scenarios |
| F2: complete outcomes became partial deliverables | One full integration became a pairwise CLI; a prototype-first dependency became a prototype-only plan | S1; S7 scope-conservation scenarios |
| F3: staging recovery expanded into a commit | A listed-path staging instruction was followed by a documentation commit without a visible explicit commit request | S2; S7 authority counterexamples |
| F4: summary overstated execution | A compaction heading claimed later Slices were enrolled while receipts proved authoring/publication and an active first Slice | S3; H1; S7 recovery scenario |
| F5: many tests missed acceptance invariants | Two Review rounds caught six combination/boundary classes | S4; S7 verification scenario |
| F6: read-only research blurred outbound effects | Public article model experiments used a separate channel before the project Gateway preference was made explicit | S2; S7 research-channel scenario; no claim of a proven private-data leak |
| F7: CLI contract was discovered by failed calls | Missing author destination and an unknown descriptor field required correction | S5 |
| F8: publication partially succeeded before a retry failure | Parent/Children were incrementally created; an outer retry loop obscured partial state and exceeded its shell budget | S5; S7 publication-recovery scenario |
| F9: investigation and output were unnecessarily expensive | A bounded probe consumed 114 tool calls/163.4k tokens; multi-file output was truncated | S6; telemetry is comparative evidence, not a cap |
| F10: host readiness did not prove isolated QA readiness | Prototype/App verification depended on browser, simulator, settings, output paths and preparation ownership | S4; S7 verification scenario; no claim of a demonstrated environment failure |

Current source/consumer closure:

- `plugins/immune-brain/dist/imm-brainstorm.md` is the canonical self-sourced Brainstorm contract. `plugins/immune-brain/skills/imm-brainstorm/SKILL.md` is its minimal section-route loader. Relevant existing tests are `tests/brainstorm-decision-probing-contract.test.ts` and `tests/exhaustive-decision-tree-contract.test.ts`; the existing behavior fixture is `tests/fixtures/imm-brainstorm-behavior-benchmark.json`.
- `plugins/immune-brain/dist/imm-planner.md` is the canonical self-sourced Planner contract; its loader is `plugins/immune-brain/skills/imm-planner/SKILL.md`. Candidate authoring, complete manifest mapping, verification discipline and publication are protected by `tests/imm-planner-kernel-intent-contract.test.ts`, `tests/planner-ensemble-contract.test.ts`, and `tests/carrier-enrollment-gate-contract.test.ts`.
- `plugins/immune-brain/BASELINE.md` owns shared side-effect/local-recovery rules; `plugins/immune-brain/skills/BASELINE.md` and `plugins/immune-brain/dist/BASELINE.md` are generated. `tests/baseline-packaging-contract.test.ts`, `tests/plugin-package-runtime.test.ts`, `tests/skill-dist-consistency.test.ts` and `tests/dist-docs-sync-contract.test.ts` protect package/route/mirror contracts.
- `plugins/immune-brain/dist/imm-loop.md` and `plugins/immune-brain/skills/imm-loop/SKILL.md` own the consumer-side recovery instructions. Existing Kernel projections/receipts remain authoritative; no new store or lifecycle is required. `tests/loop-contract-v4-alignment.test.ts` protects alignment.
- `plugins/immune-brain/runtime/prompts/qa.md` and `code-review.md` own internal evidence checks; corresponding `plugins/immune-brain/dist/role-prompts/qa.md` and `plugins/immune-brain/dist/role-prompts/code-review.md` copies are generated. `tests/role-prompt-bundled-layout.test.ts` and `tests/role-prompt-bridge.test.ts` protect packaging and role boundaries.
- `docs/reference/subagent-dispatch-protocol.md` owns bounded foreground discovery; `plugins/immune-brain/dist/docs/reference/subagent-dispatch-protocol.md` is its generated mirror. Pi owns provider/model defaults; the repo does not introduce model routing or override Host policy.
- `plugins/immune-brain/runtime/v4_runtime.ts` and `runtime/commands/kernel.ts` own public command dispatch/author invocation diagnostics; `runtime/verification_descriptor.ts` remains the existing strict descriptor parser. Improve discoverability without changing the Kernel Intent/reducer/store schema.
- `plugins/immune-brain/runtime/github_issue_tracker.ts` owns canonical-intent publication binding, idempotency markers, native ownership/topology readback and transport timeouts. Extend this path only. Relevant tests include `tests/github-issue-projection-contract.test.ts`, `tests/kernel-intent-authoring.test.ts` and `tests/v4-runtime-launchers.test.ts`.
- Runtime modules are inlined in `plugins/immune-brain/dist/claude/mcp-server.mjs`; S5 scope includes this generated delivery. Rebuild with `bun scripts/build-claude-plugin.ts` before affected tests.
- `scripts/benchmark_eval.ts` already exports `BenchmarkCollector`, `buildRunRecord` and evidence persistence, with `tests/benchmark-eval-runner.test.ts`. Its current subprocess prompt asks for parallel child dispatch; the new workflow cohort must use serial foreground dispatch and no recursive child spawning. Reuse the collector, not that incompatible orchestration. Non-interactive subprocesses cannot exercise real authority gates.

Every Child's exact `scope_hint` is in its canonical TaskIntent. New named workflow test/fixture/report paths in those scopes are planned outputs, not missing existing dependencies. Existing sibling sources above are resolved. No implementation is performed during planning.

## Brainstorm Trace

The approved conversation supplied a closed framing; no second interview or invented user answers are needed. The identifiers below preserve that framing for Planner coverage, rather than falsely claiming a historical machine manifest existed.

| ID | Approved requirement/decision | Coverage |
| --- | --- | --- |
| BR-REQ-1 | Traverse every relevant decision dependency before handoff, including zero-question requests | S1, S7 |
| BR-REQ-2 | Preserve the complete final outcome and all required phases; first does not mean only | S1, S7 |
| BR-REQ-3 | Separate stage/commit/push and research-channel/data grants | S2, S7 |
| BR-REQ-4 | Recover from fresh authority rather than inaccurate summaries | S3, S7 |
| BR-REQ-5 | Derive acceptance invariants, counterexamples and executable isolated prerequisites | S4, S7 |
| BR-REQ-6 | Discover CLI contracts and safely report/recover partial remote success | S5, S7 |
| BR-REQ-7 | Bound investigation/output and recover only unfinished operations | S6, S7 |
| BR-REQ-8 | Validate real multi-turn behavior, not just instruction strings | S7 |
| BR-DEC-1 | One GitHub Initiative, approved slug and complete seven-Child publication | Carrier/publication section |
| BR-DEC-2 | Serial Managed execution; no unattended batch is started by this approval | All Slices |
| BR-DEC-3 | Live behavior evaluation is required later, with disclosed bounded model/call budget | S7 execution preflight |
| BR-OUT-1 | No Kernel core rewrite, new scheduler/store, default parallel Managed work, or permanent compatibility layer | All Slices |
| BR-OUT-2 | No edits to original application projects, raw session publication, authority/audit rewriting, or Git history manipulation | All Slices |
| BR-DEFER-1 | Fix summary production in the external Host rather than pretending this repo owns it | H1; S3 supplies consumer-side protection |
| BR-Q-1 | No unresolved product decision blocks candidate publication; live model availability/budget is checked at S7, before any paid run | S7 preflight; material authorization delta blocks that run only |

## Technical design

### Common invariants

Maintain one source for each rule and revise the existing procedural step/completion criterion before adding reference text. Shared guards stay in BASELINE; Skills link the applicable rule. Preserve explicit-only workflow activation, native gates, canonical authoring, Kernel-owned deterministic QA and snapshot-bound Review. Textual instruction checks are contract evidence, not proof a provider obeyed them. No prompt rule is represented as a hard sandbox for generic bash.

Keep the shared Spec immutable after execution starts. A new concrete scope/design need uses the existing breaking revision path; it is not silently folded into another Child. Task-owned candidates may be staged during planning without commit. Sibling candidates and shared-contract commits must not be changed while a later Child's Enrollment baseline is active; settle the current owner and obtain any needed Git-operation authorization first.

### S1: relevant traversal and conserved handoff

A relevant decision branch comes from a literal requirement, repository fact, or a confirmed parent decision. Traverse dependencies, solve delegated technical/factual nodes autonomously, and ask only user-owned material choices. A question's completion may unlock another branch; continue until each necessary branch is resolved, explicitly excluded, explicitly deferred, or blocked. A blocking node prevents only its dependent commitment. Independent read-only evidence gathering continues.

All requests, including clear zero-question requests, require the same relevant-coverage completion check. Exhaustive-interview mode remains opt-in and concerns interview breadth, not permission to skip relevant branches. Preserve existing batch decisions, non-blocking correction windows and no fixed question cap. The manifest conserves final outcome, phase ordering, current Slice result, remaining gap and ownership of every required future outcome. Planner maps all identifiers exactly once to covered/decisioned/deferred/out with reasons; it asks only newly exposed material deltas.

### S2: exact effects and outbound research

Consume the smallest existing grant that covers operation, target and impact. Staging recovery grants staging only. Commit/push/publication are distinct; an existing exact approval or valid batch capability remains usable without another chat gate. Article-publicness does not select a provider, nor does local database read-only status eliminate outbound effects. Check the existing project channel first; authorize only a genuinely new channel/data/effect delta. Distinguish docs/mock/real-channel/model-quality evidence. No product-owned provider routing is added.

### S3: authoritative recovery consumer

After an uncertain interruption, bind to exact task/run identity and fresh lifecycle/artifact/obligation/claim facts. Consume a successful operation's fresh projection directly instead of redundantly querying status. Summaries and Issue state cannot create authority; authored, validated, published, enrolled, assured and completed are distinct. When prose conflicts with receipts, correct the prose and resume the existing owner without replaying successful mutation, opening a new owner, or rewriting a store. A summary-generation bug is H1, not a locally resolved producer defect.

### S4: verification by invariant and environment

Planner traces each acceptance to an observable seam; test positive, negative and bound combinations relevant to that invariant. The six generalized motivating classes are normalization-to-retrieval, validation-before-merge, whole-lifecycle deadline, ranking under missing embeddings, full serialized request budget, and duration evidence for success/failure/timeout. These are workflow-quality fixture inputs, not requests to edit the original applications.

A descriptor names exact focused files, prerequisite provenance, preparation and writable outputs. Structural Enrollment readiness proves only descriptor validity, not successful execution. Preparation does not hide downloads, credential use, production writes or system changes. Require cleanup on failure/interruption and restoration of any explicitly authorized settings. Zero matched checks, skipped required checks, absent dependencies and a missing simulator are failures, not a pass. Separate automated behavior/geometry evidence from human motion-quality judgment. Prefer existing descriptors and role checks; do not change the verifier engine or install a browser/iOS subsystem.

### S5: discoverable commands and bounded publication

Document/return the canonical destination+stdin author shape and strict v2 descriptor structure using existing help/examples before adding any new information surface. Keep unknown-field rejection and exclusive creation. Runtime changes are limited to public command guidance and the existing tracker transport/publication path, not authority semantics.

Represent confirmed remote writes, unfinished steps and result uncertainty truthfully. Use exact ownership/topology readback before replaying the same approved idempotent manifest. Never infer zero writes from `retryable_failure`. Bound the whole publication across transport calls; do not introduce an outer blind shell loop. Lost-response, partial success, stale ownership/hash, ambiguous matches, deadline and cancellation tests must prove no duplicate Issues, no wrong ownership-edge mutation and no Enrollment before complete readback. Preserve single error-specific recovery guidance and existing tracker compatibility.

### S6: bounded discovery and partial local results

State the question, bounded paths, expected evidence and stop criterion. Prefer known-path reads and architecture navigation; expand only along proved callers/state owners. Use `Promise.allSettled` for independent local calls, sequence dependent actions, and inspect successful partial edits before retrying unfinished work. Read truncated material in bounded pages when it remains necessary. Keep research to named projects/logs and preserve foreground/no-nesting/empty-footer rules. No hard token/call cutoff can replace required evidence; telemetry reports efficiency without asserting comparability to the original heterogeneous sessions.

### S7: behavior evidence and release closure

Use one sanitized cohort containing ten multi-turn scenarios: complete integration handoff; prototype-first/full-App handoff; newly unlocked branches after bulk approval; clear zero-question request; staging-only recovery with a separately already-authorized commit counterexample; existing Gateway/new outbound-channel delta; incorrect summary/owner recovery; partial publication receipt recovery; invariant/prerequisite/visual-evidence boundaries; bounded discovery/truncation/partial-edit recovery. Each scenario is evaluated against concrete transcript decisions and observable calls, not a child's self-awarded pass.

Reuse existing benchmark record/collector concepts and tests. The new fixture uses one supported Host-resolved model, ten serial foreground scenario dispatches, one run per scenario, no automatic retry, no workflow fan-out, and no scenario child spawning. Resolve and disclose exact model identity and cost/call limits before launching. Use parent-mediated multi-turn transcripts within each scenario; bounded correction after a failure requires a newly authorized run, not an automatic loop. Missing model availability, host telemetry or an authorized budget blocks the dependent live run without fabricating a success or silently switching providers.

Provider experiments run outside deterministic QA and only after implementation, using copied sanitized fixtures/read-only evidence and simulated authority/publication seams. Never perform real commits, GitHub writes or Enrollment just to test a scenario. Do not invoke a detached/non-interactive subprocess to impersonate native confirmation. Use an existing foreground Host path for observed Agent results; adapt the existing runner's scenario dispatch only as needed for this serial cohort, without a new scheduling framework. Preserve existing benchmark modes and mark contract-only records as such.

Record the relevant contract/fixture/source content hashes, exact model, scenario set, observed outcomes, provenance, tool/call metrics and unavailable cost/telemetry explicitly. Missing metrics are unknown, not zero. Persist only sanitized structured evidence and a concise report; neither raw secrets/logs nor self-reported footers qualify as trusted runtime metrics. Independently review concrete outcome evidence. A focused offline verifier checks complete scenario coverage, hash bindings, failed/duplicate/missing outcomes and evidence provenance in the checked-in report. It must fail if live evidence is absent or contract-only, rather than making model calls during QA. Reject drifted fingerprints; avoid Git HEAD-only bindings because the synthetic reviewed revision differs from the execution workspace.

Final delivery also runs the affected typecheck/build/release checks outside bounded acceptance descriptors. Run the provider cohort only after the workflow contracts stabilize. A static-only result is explicitly incomplete for S7 and the Initiative; the report is not allowed to claim all Host/model behavior is universally proven by one bounded cohort.

## Slice decomposition, dependencies, and acceptance mapping

All Children are `material`. Stable task IDs are `workflow-decision-closure-s1` through `workflow-decision-closure-s7`; Slice IDs are `S1` through `S7`.

| Slice | Closable result | Semantic blockers | Focused verification owners |
| --- | --- | --- | --- |
| S1 | Relevant decision traversal and conserved complete Planner handoff | None | Existing Brainstorm/Planner contracts plus new `tests/workflow-decision-closure.test.ts` |
| S2 | Side-effect grants and outbound research stay within exact authorization | S1 | BASELINE packaging and new `tests/workflow-effect-boundaries.test.ts` |
| S3 | Summary drift cannot corrupt recovery or duplicate mutation | S1 | Loop alignment and new `tests/workflow-authoritative-recovery.test.ts` |
| S4 | Acceptance invariants and isolated-environment obligations are explicit | S1 | Descriptor/role packaging plus new `tests/workflow-verification-invariants.test.ts` |
| S5 | Author invocation is discoverable and partial publication is safely bounded | S2, S3 | Author/launcher/publication tests plus new `tests/github-initiative-recovery.test.ts` |
| S6 | Discovery/output are bounded without dropping necessary evidence | S1 | Dispatch/mirror/route tests plus new `tests/workflow-bounded-discovery.test.ts` |
| S7 | The stabilized workflow passes ten observed multi-turn scenarios with truthful report | S1, S2, S3, S4, S5, S6 | Collector tests plus new `tests/workflow-behavior-evidence.test.ts`; live provider run and release checks are additional pre-Review evidence |

Each Child has one consolidated acceptance covering its result, negative controls and packaging closure. Its descriptor uses `bun test` with explicit focused file arguments, a 180-240 second limit and 196608 output bytes. `prepare` is null and `writable_paths` is empty; deterministic tests use disposable temp fixtures, no production/project-state or network writes. New named tests are implemented in that Child before assurance. Candidate validation checks structure only and does not execute descriptors.

## Devil's Advocate Audit

- Rollback resilience: documentation changes have one canonical source and regenerable mirrors; S5 runtime remains in existing command/tracker seams and does not mutate persisted schema. Restore only task-owned changes before settlement; do not revert shared contracts while a subsequent owner is active. No permanent bridge or dual store is introduced.
- Verification vanity: phrase-presence tests alone cannot establish behavior. S7 requires real observed multi-turn outputs, independently judged concrete decisions/calls and provenance, with an offline absence/drift/duplicate negative suite. Native authority is simulated in benchmark scenarios; no claim that simulation proves live dialog correctness.
- Spec dilution: phase-first is not outcome-only; all F1-F10 and BR items map to a Child/H1. QA pass is not provider compliance, a published Issue is not Enrollment, and a completed first Slice is not the complete Initiative.
- Authority leakage: text cannot sandbox arbitrary bash. Preserve existing Host authority gates and validate observable refusal/approved-counterexample behavior without claiming an absolute execution barrier.
- Research cost/privacy: sanitized prompts only; one model/ten serial scenarios/no automatic repeat. A material channel, payload or budget change needs exact authorization before that run.
- Scope closure: packaged mirrors, role copies, changed tests and the generated Claude bundle are named in the responsible Intent. Any newly discovered affected owner outside scope blocks that edit until an approved revision; do not weaken tests to keep scope small.
- Publication uncertainty: planning publication uses the current complete-batch tool once. A failure retains candidates and reports one same-batch recovery action; no auto-retry, separate `gh issue create`, progressive publication or execution handoff.

## Assumptions and outstanding external item

A1: the existing active routing policy and claimless workspace permit candidate authoring; recheck immediately before authoring. A2: required GitHub labels and authentication must be observable before first write; a failure blocks publication only. A3: original-project findings are bounded observations, not requests to repair their business code. A4: supported model identity and actual metering are Host facts checked at S7; unavailable billing is reported, not invented.

H1 owner: external Magic Context Host maintainer. Prepare a minimal sanitized producer-bug report referencing authored/published-versus-enrolled distinction, retain consumer-side protection in S3, and request a separately scoped Host fix. Closure signal is externally verifiable upstream fix/release plus the relevant summary regression; this repo does not mark H1 fixed by updating its own prompts. No external Host write is authorized by this plan.

## Planning completion and execution handoff

Author all seven canonical candidates through `imm-kernel intent author <path> --stdin --json`, stage only the shared Spec and seven newly produced Intents, and require `valid: true` plus `enrollment_ready: true` for every candidate. Validate trace coverage, scope/reference closure, strict descriptor bounds and public-summary ID parity without executing acceptance tests. Publish all seven through one `imm-tracker publish-initiative --stdin --json` call and require complete open topology, native Sub-issue/blocker ownership, exact canonical-intent hash binding and complete batch success. Report first Issue, stable order, semantic parallel groups and serial recommendation. Stop plan-only delivery here. Enrollment/execution requires a later explicit trigger and the mandatory native gate; no commit or unattended batch is included.
