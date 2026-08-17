- Summary: UI i18n Review Lens Integration

## Task
- Origin: Brainstorm session establishing i18n and Dark/Light theme usability audit gaps.
- Spec: docs/specs/ui-i18n-review-lens.spec.md
- Brainstorm manifest: BR-REQ-001, BR-REQ-002, BR-REQ-003, BR-REQ-004, BR-DEC-001, BR-DEC-002, BR-DEC-003, BR-OUT-001, BR-DEFER-001

## Research
- `docs/reference/ux-heuristic-checklist.md` proves the thin index checklist pattern for `imm-ui-review`.
- `docs/reference/subagent-trigger-catalog.yaml` is the deterministic source for `imm-ui-review` advisory lenses and currently lacks `ui_i18n`.
- `.imm/activation_plan.py` emits lens ordering and max parallel behavior from the catalog-backed Activation Plan runtime.
- `plugins/immune-brain/dist/imm-ui-review.md` is the compiled host skill that must name the i18n checklist and delegation behavior.
- `tests/test_activation_plan.py` covers standalone UI lens triggers and max parallel caps.
- `tests/test_skill_contracts.py` is the right home for checklist and host-skill contract assertions.

## Decisions
- **BR-DEC-001**: Do not create a separate `imm-i18n-review` skill. Keep `imm-ui-review` as the host.
- **BR-DEC-002**: Add a deterministic `ui_i18n` Activation Plan lens for i18n and localization change surfaces.
- **BR-DEC-003**: Route complex i18n review through the existing read-only advisory reviewer dispatch path instead of a new runtime.

## Assumptions
- The first implementation keeps translation semantic quality review out of scope and focuses on UI usability, formatting, layout, theme, and implementation hygiene.
- `ui_i18n` can reuse `imm-advisory-reviewer` as its candidate skill, like the other UI advisory lenses.
- Fully automated multilingual visual diff remains deferred; this slice validates routing, checklist quality, and host behavior.

## Brainstorm Trace
| Item | Status | Target | Reason |
| --- | --- | --- | --- |
| BR-REQ-001 | covered_by_step | U3 | `imm-ui-review` gains `ui_i18n` routing and host checklist loading |
| BR-REQ-002 | covered_by_step | U1 | Checklist is created in docs/reference |
| BR-REQ-003 | covered_by_step | U1 | Checklist covers hardcoded strings, interpolation, overflow, RTL, and formatting |
| BR-REQ-004 | covered_by_step | U1 | Checklist covers localized assets plus light and dark theme legibility |
| BR-DEC-001 | captured_as_decision | BR-DEC-001 | Single host avoids skill proliferation |
| BR-DEC-002 | captured_as_decision | BR-DEC-002 | `ui_i18n` is deterministic catalog routing |
| BR-DEC-003 | covered_by_step | U2 | Specialist dispatch is represented as a read-only advisory lens |
| BR-OUT-001 | out_of_scope | BR-OUT-001 | Deep semantic translation quality review needs human or translation-specialist review |
| BR-DEFER-001 | deferred | BR-DEFER-001 | Pixel-level multilingual visual diff is a later slice after routing and checklist semantics exist |

## Steps

### Step 1
- Step ID: U1
- Result: docs/reference/i18n-review-checklist.md review source created
- Verification: python3 -c "from pathlib import Path; text=Path('docs/reference/i18n-review-checklist.md').read_text(); assert all(term in text for term in ['Hardcoded', 'Interpolation', 'RTL', 'P0', 'false-positive'])"
- Verification type: automated
- Depends on: None

### Step 2
- Step ID: U2
- Result: ui_i18n Activation Plan lens wired
- Verification: python3 .imm/activation_plan.py --host imm-ui-review --changed-path app/locales/en.json | grep ui_i18n
- Verification type: automated
- Discovery cache: docs/reference/subagent-trigger-catalog.yaml (Add `ui_i18n` trigger surface and rationale code); .imm/activation_plan.py (Confirm lens ordering and max parallel behavior); docs/reference/automatic-subagent-activation-policy.md (Document allowed lens and output schema); docs/reference/immune-brain-config.md (Document lens override key)
- Depends on: 1

### Step 3
- Step ID: U3
- Result: imm-ui-review host loads ui_i18n checklist
- Verification: cat plugins/immune-brain/dist/imm-ui-review.md | grep i18n-review-checklist.md
- Verification type: automated
- Discovery cache: plugins/immune-brain/dist/imm-ui-review.md (Host skill i18n tailoring and Delegation Packet mapping)
- Depends on: 1, 2

### Step 4
- Step ID: U4
- Result: ui_i18n regression coverage added
- Verification: python3 -m unittest tests.test_activation_plan tests.test_skill_contracts
- Verification type: automated
- Discovery cache: tests/test_activation_plan.py (Standalone keyword and locale path trigger coverage); tests/test_skill_contracts.py (Checklist and host contract coverage)
- Depends on: 2, 3

### Step 5
- Step ID: U5
- Result: full i18n lens validation passes
- Verification: python3 -m unittest discover -s tests
- Verification type: automated
- Depends on: 4

## Test Scenarios
1. **Checklist Integrity Test**: Assert `i18n-review-checklist.md` contains hardcoded text, interpolation, RTL, formatting, theme asset, false-positive, and P0-P3 guidance.
2. **Standalone i18n Trigger Test**: Assert `app/locales/en.json` and `i18n` task summary trigger only `ui_i18n` when no other UI surface is present.
3. **Mixed UI Trigger Test**: Assert component plus locale changes keep deterministic UI lens ordering and respect the host max parallel cap.
4. **Host Contract Test**: Assert `imm-ui-review` references `ui_i18n`, `i18n-review-checklist.md`, and the read-only advisory dispatch boundary.
