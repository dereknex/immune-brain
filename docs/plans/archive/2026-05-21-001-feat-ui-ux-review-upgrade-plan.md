- Summary: UI/UX Heuristic and Experience Review Upgrade

## Task
- Origin: Brainstorm session identifying UI/UX experience check upgrade opportunities.
- Spec: docs/specs/archive/ui-ux-review-upgrade.spec.md
- Brainstorm manifest: BR-REQ-001, BR-REQ-002, BR-REQ-003, BR-REQ-004, BR-DEC-001, BR-DEC-002, BR-DEC-003, BR-OUT-001

## Research
- `progressive-disclosure-review-lens.md` outlines the thin index pattern where review dimensions are added to `docs/reference/` and referenced by single-line progressive checklist bullet rules.
- Nielsen's 10 Heuristics, Feedback First loops, and visual design rules provide direct criteria for usability testing.
- `test_skill_contracts.py` validates skill boundary rules, codex contract fields, and user-facing output shapes.
- Path drift exists in `tests/test_skill_contracts.py` where contract checks read from `skills/*/SKILL.md` (which are now consolidated 11-line templates) rather than the compiled `dist/*.md` files, causing contract assertions to fail.

## Decisions
- **BR-DEC-001**: Do not create a separate `imm-ux-review` skill. Instead, use the Progressive Disclosure Lens pattern to hook UX heuristics into the existing `imm-ui-review` skill.
- **BR-DEC-002**: Trigger UX checklist checks dynamically using a change surface tailoring matrix. Under complex interactive shifts, delegate to the `ux_heuristic` advisory lens.
- **BR-DEC-003**: The `imm-qa` coordinator retains final arbitration and sign-off authority for UI/UX findings.

## Assumptions
- `imm-ui-review` host will dynamically tailor which heuristics to evaluate based on path patterns in the modified files.
- The `ux_heuristic` advisory lens runs in read-only mode and produces advisory output.

## Brainstorm Trace
| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U2 | Kept imm-ui-review as the single entry host |
| BR-REQ-002 | covered_by_step | U2 | Review remains read-only |
| BR-REQ-003 | covered_by_step | U1 | Thin index for Nielsen heuristics is created in docs |
| BR-REQ-004 | covered_by_step | U2 | The 10-point checklist is enforced in findings |
| BR-DEC-001 | captured_as_decision | BR-DEC-001 | Avoid creating new skill and utilize progressive lens instead |
| BR-DEC-002 | captured_as_decision | BR-DEC-002 | Dynamic tailoring and specialist dispatch delta |
| BR-DEC-003 | captured_as_decision | BR-DEC-003 | Arbitration of UI/UX is handled by QA sign-off |
| BR-OUT-001 | out_of_scope | BR-OUT-001 | Pixel-level visual diff tools are out of scope for the current text agent |

## Steps

### Step 1
- Step ID: U1
- Result: docs/reference/ux-heuristic-checklist.md thin index checklist created
- Verification: cat docs/reference/ux-heuristic-checklist.md | grep "Nielsen 10"
- Depends on: None

### Step 2
- Step ID: U2
- Result: plugins/immune-brain/dist/imm-ui-review.md host skill upgraded
- Verification: cat plugins/immune-brain/dist/imm-ui-review.md | grep "ux-heuristic-checklist.md"
- Discovery cache: plugins/immune-brain/dist/imm-ui-review.md (Host skill updated for UX/UI tailors)
- Depends on: 1

### Step 3
- Step ID: U3
- Result: tests/test_skill_contracts.py skill contract test paths updated
- Verification: python3 -m unittest tests.test_skill_contracts
- Discovery cache: tests/test_skill_contracts.py (Update test contract path drift)
- Depends on: None

### Step 4
- Step ID: U4
- Result: tests execution confirms all skill contracts green
- Verification: python3 -m unittest discover -s tests
- Depends on: 2, 3

## Test Scenarios
1. **Catalog Integrity Test**: Verify that `ux-heuristic-checklist.md` is valid markdown and matches required check headers.
2. **Contract Compliance Test**: Run `python3 -m unittest tests.test_skill_contracts` to verify the updated skill meets standard boundary requirements.
