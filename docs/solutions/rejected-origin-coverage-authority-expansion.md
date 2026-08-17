---
rejected: true
reusability: medium
next_reuse_scenarios:
  - brainstorm coverage work proposes letting brainstorm write plans
  - QA closure work proposes re-deciding planner scope
  - origin coverage work proposes a schema store before Markdown trace is exhausted
---

# Rejected: Origin Coverage Authority Expansion

**领域**: Agent workflow / authority boundaries / origin coverage

## Rejected approaches

1. **Let `imm-brainstorm` write Plans or Specs**
   - Rejected because brainstorm is a read-only framing role. Giving it plan-write authority would collapse the brainstorm/planner boundary and make later coverage proof harder, not easier.

2. **Force one Plan Step per `BR-*` item**
   - Rejected because Step remains an independently closable outcome unit. One outcome can legitimately cover multiple origin items when verification still closes that outcome.

3. **Let QA decide whether origin items should be excluded**
   - Rejected because QA owns closure judgment, not scope planning. If origin coverage is unresolved, QA should return `replan` with evidence instead of deciding product scope.

4. **Introduce a persistent schema store before Markdown trace validation is insufficient**
   - Rejected because `Brainstorm manifest` + `Brainstorm Trace` + `imm-plan --json` coverage summary solves the current traceability problem with less ceremony and preserves historical Plan compatibility.

## What to do instead

Use the active pattern in [contracts.md](contracts.md): brainstorm emits a compact manifest, planner maps every declared `BR-*` item, `imm-plan` reports `origin_coverage`, and QA blocks only on unresolved coverage evidence.

*沉淀日期: 2026-05-15 | 来源: origin coverage closure planning and review follow-up*
