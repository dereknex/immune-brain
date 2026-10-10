# Historical cohort sources

`imm-planner.md` preserves the measured Planner bytes from commit `f8c69e1`, with SHA-256 `ebb03bfb9be43d1c37166e80382886615f3480df5af97c32cd9c373cb7b3248d`, matching the unchanged workflow-decision-closure evidence.

The historical evidence tests independently hash these bytes and materialize a temporary source tree for the offline verifier. Other bound sources still match their checked-in bytes. Current-source verification continues to reject this cohort because today's Planner has drifted. These tests validate historical evidence integrity; they do not claim a fresh measurement of current contracts. Preserve this fixture for as long as the historical cohort is tested; a future measurement must produce separate evidence rather than refresh this cohort's hashes.
