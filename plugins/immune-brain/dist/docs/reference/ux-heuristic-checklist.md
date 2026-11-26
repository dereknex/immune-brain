# UI/UX Usability Heuristic & Experience Checklist

This document is the style-neutral usability rubric shared by the `design-review`
Skill and the `imm-ui-review` role. Load only the sections the review surface
needs. An approved project `DESIGN.md` overrides any generic default here; the
accessibility floor in section 6 is never waived.

Cite findings by principle ID: `N1`-`N10` (Nielsen), `CRAP-*`, `GES-*`
(Gestalt), `LAW-*` (Laws of UX), `STATE-*`, `MOTION-*`, and `A11Y-*`.

---

## 1. Nielsen Heuristics by Intent

The ten usability heuristics, grouped by what they protect.

### Perception and Feedback

| ID | Heuristic | Checkpoints |
| :--- | :--- | :--- |
| `N1` | Visibility of System Status | Every click, submit, navigation, and long task shows it was received. Async containers use skeletons that match the final layout; long tasks show progress; active tabs and selections are visible. |
| `N2` | Match Between System and the Real World | Labels express user intent in the user's language, not column names or internal jargon; order and grouping follow real-world expectations. |

### Control and Error Prevention

| ID | Heuristic | Checkpoints |
| :--- | :--- | :--- |
| `N3` | User Control and Freedom | Cancel, undo, back, or dismiss is clearly available; long-running work can be cancelled; every screen has a stable way back and no dead end. |
| `N5` | Error Prevention | Constraints, previews, and field-level validation prevent mistakes before commit; submit is guarded against double submission; destructive actions require confirmation or offer undo. |
| `N9` | Help Users Recognize, Diagnose, and Recover from Errors | Errors sit next to their cause, avoid raw codes and stack traces, and offer a recovery action. |

### Cognitive Load Reduction

| ID | Heuristic | Checkpoints |
| :--- | :--- | :--- |
| `N4` | Consistency and Standards | One term, color role, and component behavior per meaning; platform conventions are followed. |
| `N6` | Recognition Rather than Recall | Options, context, and prior choices stay visible; inputs keep persistent labels rather than placeholder-only labels. |
| `N8` | Aesthetic and Minimalist Design | Nothing competes with the primary goal: remove low-value controls, duplicate explanations, and decorative clutter. |

### Efficiency and Fallbacks

| ID | Heuristic | Checkpoints |
| :--- | :--- | :--- |
| `N7` | Flexibility and Efficiency of Use | Shortcuts, bulk actions, remembered preferences, and smart defaults serve repeat users without blocking new ones. |
| `N10` | Help and Documentation | Contextual help sits beside unfamiliar controls; first-time features explain the next step. |

### Surface-Mode Calibration

Classify the surface before scoring, because the same rule weighs differently.

| Mode | Surface | Weigh most | Often `n/a` |
| :--- | :--- | :--- | :--- |
| Operate | Dashboards, forms, tools, admin | `N1`, `N3`, `N5`, `N7`, `N9` | none by default |
| Read | Docs, articles, reference | `N2`, `N4`, `N6`, `N8` | `N7` shortcuts, `N5` without input |
| Persuade | Landing, pricing, onboarding offers | `N2`, `N4`, `N8` | `N7`, `N10` |
| Experience | Games, showcases, immersive media | `N1`, `N3` | `N6`, `N10` when the interaction is the content |

A heuristic that cannot apply to the surface is marked `n/a` with a one-line
reason and removed from the denominator before any coverage or score is stated.
`n/a` never excuses an accessibility obligation.

---

## 2. CRAP and Gestalt Principles

Pair each composition judgment with the principle it serves.

| ID | CRAP principle | Check |
| :--- | :--- | :--- |
| `CRAP-C` | Contrast | Emphasis follows priority: primary content and action differ clearly from secondary material; text meets the contrast floor. |
| `CRAP-R` | Repetition | Spacing, type scale, radii, icon style, and state treatment repeat consistently. |
| `CRAP-A` | Alignment | Elements share a grid: text left-aligned, numbers right-aligned, centers optically aligned. |
| `CRAP-P` | Proximity | Related items sit closer to each other than to unrelated items. |

| ID | Gestalt principle | Check |
| :--- | :--- | :--- |
| `GES-SIM` | Similarity | Things that behave alike look alike; interactive and static elements are distinguishable. |
| `GES-CON` | Continuation | The eye follows one path through steps, lists, and timelines without breaks. |
| `GES-CLO` | Closure | Partial shapes such as steppers, skeletons, and clipped carousels read as one whole and signal that more exists. |
| `GES-PRO` | Proximity | Labels, fields, help, and errors group with the control they describe. |
| `GES-FIG` | Figure/Ground | Foreground layers such as dialogs, popovers, and selection separate from the background in every theme. |
| `GES-SYM` | Symmetry | Paired or comparable content is balanced; asymmetry is deliberate and marks hierarchy. |
| `GES-REG` | Common Region | A border or surface encloses only items that belong together; avoid cards nested only for decoration. |
| `GES-FAT` | Common Fate | Items that move, expand, or update together are related, and unrelated items do not. |

Information architecture follows from the same principles: categories are
comprehensible at a glance, essential content comes first, navigation paths are
stable, and whitespace guides the eye rather than filling a template.

---

## 3. Laws of UX

Each law has a measurable check. Report the observed value with the finding.

| ID | Law | Measurable check |
| :--- | :--- | :--- |
| `LAW-FITTS` | Fitts's Law | Touch targets are `>= 44x44px`; desktop pointer targets are `>= 24x24px` (WCAG 2.2 AA minimum); destructive actions are separated from frequent ones. |
| `LAW-HICK` | Hick's Law | Each decision area shows `1` primary action plus `1-2` secondary visible actions; the rest move behind progressive disclosure (menu, drawer, advanced section). |
| `LAW-MILLER` | Miller's Law | Groups hold `<= 4` items ideally and `<= 7` at most; long digits, keys, and codes are formatted into groups. |
| `LAW-JAKOB` | Jakob's Law | Controls follow standard mental models: `Enter` submits, `Escape` dismisses, and returning to a list keeps scroll position and filters. |
| `LAW-TESLER` | Tesler's Law | The system absorbs unavoidable complexity: auto-trim input, offer smart defaults, and infer what it already knows instead of asking. |
| `LAW-PEAK` | Peak-End Rule | Key flows end with clear completion feedback and a next step; there is no blank screen or raw error at any low point. |

---

## 4. Interactive State Matrix and Content

### Eight Control States

Every interactive control defines the states it can reach. A missing reachable
state is a finding; an unreachable one is `n/a`.

| State | Expectation |
| :--- | :--- |
| `default` | Affordance shows it is interactive. |
| `hover` | Pointer feedback that does not move layout. |
| `:focus-visible` | A visible focus indicator for keyboard users. |
| `:active` | Immediate pressed feedback. |
| `disabled` | Visibly inert, with the reason discoverable. |
| `loading` | `disabled` against repeat activation and announced with `aria-busy`, keeping its size. |
| `error` | Message tied to the control and announced. |
| `success` | Confirmation that the action took effect. |

Feedback scales with duration: under 100 ms an instant state change, up to 1 s a
spinner or busy control, longer a skeleton or progress with a retry path on
failure.

### Content and Copy

- **Error microcopy** states what happened, why, and the recovery action.
- **Empty states** explain what is missing, why it matters, and the single next
  useful action.
- **Restorable truncation**: text cut with an ellipsis or `line-clamp` can be
  read in full through expansion, a detail view, or an accessible tooltip.
- **Honest content**: no invented metrics, testimonials, logos, or activity, and
  no fake browser or phone chrome framing a screenshot as a product.
- **Localization**: user-facing copy tolerates expansion, plurals, locale
  formats, and RTL direction. Use the
  [i18n review checklist](i18n-review-checklist.md) when localization is in
  scope.

---

## 5. Motion

- `MOTION-1`: no animation on high-frequency or keyboard-initiated actions.
- `MOTION-2`: UI transitions are `<= 300ms` and enter with `ease-out`; they
  never block input.
- `MOTION-3`: animate only compositor-friendly `transform` and `opacity`.
- `MOTION-4`: honor `prefers-reduced-motion` by removing or replacing movement
  while keeping state changes visible.
- `MOTION-5`: gate hover motion behind
  `@media (hover: hover) and (pointer: fine)`.
- Motion communicates a state or spatial change; state is never conveyed by
  motion alone.

---

## 6. Accessibility

WCAG 2.1 AA is the floor.

- `A11Y-1`: native elements and correct roles; every control has an accessible
  name; headings and landmarks describe structure.
- `A11Y-2`: all functions work by keyboard in a logical order, focus stays
  visible, and dialogs trap and restore focus.
- `A11Y-3`: text contrast is at least 4.5:1 (3:1 for large text and for UI
  boundaries and states), in every theme.
- `A11Y-4`: state is never color-only; pair it with text, icon, or shape.
- `A11Y-5`: do not block zoom (no `user-scalable=no` or restrictive
  `maximum-scale`); content survives `200%` zoom and reflows at `320px` width
  without clipping or two-direction scrolling.
- `A11Y-6`: status changes and errors are announced to assistive technology.

---

## 7. Acceptance Checklist

1. [ ] Every async container shows a skeleton or progress, never a blank box.
2. [ ] Actions disable or show busy state to prevent double submission.
3. [ ] Every modal and form step can be cancelled without losing navigation.
4. [ ] Raw exceptions are replaced with guidance that names a recovery action.
5. [ ] Validation errors appear on the specific field.
6. [ ] The layout holds on desktop and narrow viewports without horizontal scroll.
7. [ ] Interactive states use the approved theme tokens.
8. [ ] Every page has a clear way back.
9. [ ] Complex configuration has smart defaults.
10. [ ] Empty states carry one clear call to action.
11. [ ] Visible actions respect `LAW-HICK`, and form inputs are width-bounded
    (about 448px or a grid) so they do not stretch on wide screens.

---

## 8. Design Tier Validation Rules

When auditing against a pre-implementation `page_design` contract, verify the
implementation according to its declared `design_tier`.

### Standard Tier
- [ ] **Grid & Hierarchy**: layout matches the section map and information hierarchy.
- [ ] **Color Contrast**: contrast meets WCAG AA.
- [ ] **Width Safety**: inputs respect `form_stretching_limits`.
- [ ] **Action Collapsing**: at most two high-frequency `visible_actions`, with
  low-frequency actions collapsed behind `collapsed: true` metadata.

### Rich Tier
In addition to all Standard Tier checks:
- [ ] **Motion Contract**: durations and easing match the `motion_contract`.
- [ ] **Aesthetic Genre**: styling reflects the declared `aesthetic_genre`.
- [ ] **Image Strategy**: imagery matches the `image_strategy` guidance.
