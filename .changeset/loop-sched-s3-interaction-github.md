---
"immune-brain": minor
---

Add one Interaction protocol for every question the Loop daemon asks a person: an `InteractionRequest` with an `interaction_id` idempotency key, a kind, a subject and binding, and an authority, sent through an `InteractionChannel` (`accepts` / `post` / `poll` / `withdraw`). The `github` channel posts one marker comment per request (a repost is `already_posted`), retires a request whose `plan_digest`, `record_revision` or `issue_revision` moved by editing it to a withdrawn notice, and applies only the literal-user answers ADR 0039 Decisions 9 and 12 already grant (`/approve <digest>`, a Lane decision reply) through the code that already verifies them. A stop, breaking Intent revision, authorization, credential or risk override is posted as `notice_only` naming the local action, and a reply to it is never applied. Pre-protocol Lane decision and `/approve` markers stay readable ([ADR 0040](docs/adr/0040-loop-interaction-protocol.md)).
