# Code Quality Guard

This contract protects correctness and review signal in LLM-assisted implementation. It is a project-specific guard, not a universal style guide.

## Correctness Invariants

### Real implementation

- Do not ship mocks, fixtures, hard-coded success, placeholder output, disabled assertions, or weakened tests as production completion.
- If required behavior cannot be implemented with the available evidence or scope, stop and report the missing condition. Do not manufacture a passing result.

### Error semantics

- Catch only errors that the code can recover from, translate, or enrich.
- Do not turn an unknown or unrecoverable error into `null`, `undefined`, empty output, or a success result.
- When translating an error, preserve its cause and the contract-visible meaning.

### Trust boundaries

- Validate user input, file contents, network payloads, deserialized data, and cross-process data at the boundary where they enter the system.
- Once an invariant is established by a trusted caller or validator, avoid speculative internal guards that hide a violated invariant or change failure semantics.

### Dependency and API authenticity

- Verify new imports against the repository's installed dependencies or the standard library.
- Verify new third-party API calls against the installed version or repository source; do not rely on memory.
- Do not add a dependency for small, clear logic already served by local code or the platform.

### Behavior integrity

- Refactoring preserves observable inputs, outputs, errors, side effects, and ordering unless the accepted task authorizes a behavior change.
- Do not mix unrelated bug fixes, cleanup, or speculative refactors into the task.

### Executable relevance

- Do not add configuration, switches, extension points, exports, or production paths without a current caller or accepted requirement.
- Remove unused imports, dead branches, commented-out implementations, and duplicate domain rules introduced by the change.

## Maintainability Heuristics

Use these as contextual investigation signals, not universal gates:

- Names should communicate the domain meaning in their local context.
- Functions should have a coherent responsibility and a complexity that remains verifiable.
- Parameters should model a real input relationship rather than hide unrelated values.
- Comments should explain constraints or reasons that are not apparent from the code.
- Repetition is a problem when it duplicates domain knowledge, not merely because text looks similar.
- Introduce an abstraction when existing complexity or multiple real consumers justify it; do not add interfaces, factories, strategies, flags, or configuration for hypothetical future use.

There are no hard line-count, parameter-count, nesting, complexity, boolean-parameter, or identifier blacklist thresholds. A heuristic becomes review-relevant only when the current change creates a concrete correctness, regression, security, or material maintenance risk.

## Review Decision Policy

- `blocking`: a concrete correctness, security, error-state, dependency/API authenticity, test-integrity, or unauthorized-behavior defect.
- `advisory`: a concrete task-local maintenance risk worth fixing in this change, with an affected path and failure rationale.
- Pure formatting, naming preference, line count, parameter count, design taste, and hypothetical extensibility produce no finding.
- A passing Review has no findings. Do not turn low-value suggestions into `rework` merely to preserve them.
- Findings identify the affected path and risk. Review reports risks and verification criteria; it does not edit code or generate patches.
