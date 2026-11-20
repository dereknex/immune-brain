---
"immune-brain": minor
---

Add the role-indexed session provider registry (unified-lane-sessions S2, #570): `runtime/session/provider_registry.ts` with pure `resolveSessionProvider({ role, providers, host, env, registry })` selecting the first configured provider whose env check holds and whose executor role admits the host with `find_by_key` and `local_path` workspace, else `lane_session_unavailable`; `herdr` admits `claude-code`, `pi`, `antigravity` with exit proof, `herdr-core` admits none until #495. Extend the port with optional `session_key` (`[a-z0-9-]{1,64}`), trailing-12-char `herdrAgentName`, `findSession`, and idempotent `closeWithProof`, enforced across the conformance suite with a registry-descriptor check.
