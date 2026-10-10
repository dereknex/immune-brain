---
"immune-brain": patch
---

The Reviewer prompt checks that the delivered tests at an acceptance's agreed seam assert the `Then` of every `automated` user scenario the referenced Spec maps to that acceptance, and reports a scenario whose observable result is asserted nowhere as an `acceptance` finding. Manual scenarios and acceptances with no mapped scenario are unchanged, and no finding kind or verdict branch is added.
