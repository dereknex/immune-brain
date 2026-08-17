---
date: 2026-06-27
topic: roadmap-example-notification-system
scope: example-roadmap
purpose: Validate the `acceptance_criteria` / `promotion_criteria` format from `docs/specs/roadmap-human-acceptance-gating.spec.md`
---

# Example Roadmap: Notification System

This is a worked example of the Roadmap format defined in
`docs/specs/roadmap-human-acceptance-gating.spec.md`. It exercises a concrete,
non-meta domain (an in-app notification system) across four phases so a
developer can independently judge whether each phase's acceptance criteria are
human-verifiable without reading implementation code.

Each phase carries `acceptance_criteria` (is this phase done?) and
`promotion_criteria` (can we start the next phase?). Per the Spec, the two
fields are independent but related, and every criteria entry is an observable
behavior assertion rather than an internal signal.

## Roadmap

### Phase 1: In-app notification feed

**Goal**: Users see notifications inside the app and can mark them read.

**acceptance_criteria**:
- 当用户有未读通知时，导航栏的铃铛图标显示一个未读计数徽章 (verification_mode: observable)
- 点击铃铛图标打开通知列表，列表按时间倒序显示每条通知的标题和摘要 (verification_mode: observable)
- 点击通知项将其标记为已读，徽章计数减一 (verification_mode: observable)
- 点击通知项中的"全部标为已读"按钮，徽章计数归零，列表中所有项不再显示未读样式 (verification_mode: observable)
- The notification bell badge count matches the number of unread notifications returned by `GET /api/notifications` (verification_mode: verifiable)

**promotion_criteria**:
- All acceptance_criteria pass human review.
- The notification data model is stable enough to support the delivery phase (no schema migration blocks delivery work).

**deferred**:
- Notification preferences UI (deferred to Phase 3).
- Push delivery channels (deferred to Phase 2).

---

### Phase 2: Email + push delivery

**Goal**: Notifications reach users through email and mobile push when they are not in the app.

**acceptance_criteria**:
- 当用户的通知触发邮件投递时，配置的收件邮箱收到一封包含通知标题和摘要的邮件 (verification_mode: observable)
- 当用户的通知触发推送投递时，移动设备收到一条包含通知标题的推送 (verification_mode: observable)
- 运行 `python3 scripts/verify_delivery.py --channel email --sample notification-welcome` 后，输出包含 `delivered: email=1` (verification_mode: verifiable)
- 用户在通知偏好设置中关闭某渠道后，该渠道不再投递通知，且日志记录 `suppressed: channel=<name>` (verification_mode: verifiable)
- The delivery log table `delivery_log` contains one row per attempted delivery with `status` of `sent`, `suppressed`, or `failed` (verification_mode: verifiable)

**promotion_criteria**:
- All acceptance_criteria pass human review.
- Email and push provider credentials are provisioned for the production environment.
- The delivery backoff and retry policy is documented and reviewed (no silent retry storms).

**deferred**:
- Per-user quiet hours (deferred to Phase 3).
- Delivery analytics dashboard (deferred to Phase 4).

---

### Phase 3: Notification preferences

**Goal**: Users can choose which notification types they receive and through which channels.

**acceptance_criteria**:
- 通知偏好设置页面显示每个通知类型的开关，以及每个类型下每个投递渠道的开关 (verification_mode: observable)
- 当用户关闭某通知类型的邮件渠道后，该类型的后续通知不再投递邮件，且偏好设置保存后在刷新页面后仍保持关闭状态 (verification_mode: observable)
- 运行 `python3 scripts/verify_preferences.py --user demo --type billing --channel email --state off` 后，输出包含 `persisted: billing.email=off` (verification_mode: verifiable)
- 用户设置每日免打扰时段后，该时段内触发的通知延迟到时段结束后投递，投递日志记录 `held_until=<timestamp>` (verification_mode: verifiable)

**promotion_criteria**:
- All acceptance_criteria pass human review.
- The preference schema migration is backward compatible with existing notification records.

**deferred**:
- Bulk preference import (deferred — may become a follow-up Plan).

---

### Phase 4: Delivery analytics

**Goal**: Admins can see delivery rates, failures, and suppression breakdowns.

**acceptance_criteria**:
- 管理后台的"投递分析"页面显示按渠道分组的投递成功率、失败率和抑制率，数据按选定时间范围刷新 (verification_mode: observable)
- 当某渠道失败率超过阈值时，页面顶部显示一条告警横幅并标注该渠道名称 (verification_mode: observable)
- 运行 `python3 scripts/verify_analytics.py --range 7d` 后，输出包含 `email: success=<n> failed=<n> suppressed=<n>` 且数值与分析页面一致 (verification_mode: verifiable)
- The analytics query returns within 3 seconds for a 7-day range (verification_mode: verifiable)

**promotion_criteria**:
- All acceptance_criteria pass human review.
- Delivery analytics rollup job is scheduled and monitored in production.

**deferred**:
- Real-time streaming analytics (deferred — out of scope for this roadmap).

## Format notes

- Every `acceptance_criteria` entry is an observable behavior assertion. None
  say "tests pass" or "code review passes"; those are internal signals the Spec
  flags at L2.
- Each phase carries both `acceptance_criteria` and `promotion_criteria`.
  `promotion_criteria` always includes "all acceptance_criteria pass human
  review" plus external-readiness conditions (provider credentials, schema
  compatibility, monitoring).
- `verification_mode` annotations are optional and default to `observable`;
  the example shows both modes.
- This is a 4-phase Roadmap (3+ phases), so per-phase `acceptance_criteria`
  are required, not optional.
