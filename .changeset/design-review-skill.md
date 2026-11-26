---
"immune-brain": minor
---

Add the standalone read-only `design-review` Skill for Claude Code, Pi and Antigravity.
It reviews code, diffs, screenshots, live pages or `DESIGN.md` against a 4-layer UI/UX
and design-contract rubric: CRAP, Gestalt, Laws of UX, Nielsen heuristics calibrated by
surface mode, whole-page and empty-state composition, style and token convergence, and
the `DESIGN.md` 46,080-byte budget. Large surfaces are split between two read-only
subagent lenses; a failed lens runs inline under `Method: dual-lens (partial: <lens> inline)`.
The internal `ui-review` role now reads the same shared checklists with read-only tools,
and its delegation prompt names the absolute `shared reference directory` so the
checklists resolve from the user's project. The rubric caps visible high-frequency
actions at 2 (`LAW-HICK`), treats the 24px pointer target as advisory above the
WCAG 2.1 AA floor, blocks repeat activation in `loading` with `aria-disabled` so focus
stays, and flags over-explanation: avoid unnecessary secondary labels and descriptions,
and let the layout do the explaining.
