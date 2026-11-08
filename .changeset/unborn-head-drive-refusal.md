---
"immune-brain": patch
---

Refuse `drive` on an unborn Git HEAD and retire the Enrollment Git-base initialization and precondition-commit code (ADR 0036, Issue #401). After drive-always-lanes S7 (#396) nothing in production created an empty root commit or staged an Enrollment precondition, so `initializeEnrollmentGitBase`, `commitEnrollmentPreconditions`, `commitUnbornEnrollmentPreconditions` and their helpers are deleted; a Lane stages the TaskIntent and bound Spec and commits nothing. A repository whose HEAD names an absent branch, or whose branch ref is corrupt, is refused by preflight with the unchanged `git_head_unreadable` reason `enrollment requires a committed Git HEAD` and touches no ref, commit or index byte. The test enrollment helper now mirrors the Lane's staging instead of committing.
