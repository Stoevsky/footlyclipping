# Campaign Scope Implementation Plan

> For agentic workers: use subagent-driven-development and test-driven-development. The user has authorized implementation, push, deployment and campaign output.

**Goal:** Scope every Footly output to the verified four-creator campaign and show its zero-valued leaderboard immediately.

**Architecture:** Official campaign analytics feed separate durable snapshots. Shared analytics access enforces scope, while Discord delivery keys isolate campaign output and retain the existing leaderboard message.

**Tech Stack:** Node 24, PostgreSQL, discord.js, native node:test, official Viral.app API.

- [x] Verify campaign ID, roster and zero performance in authenticated Viral.app UI; inspect official OpenAPI.
- [x] Write and run a failing configuration test; add validated optional `VIRAL_CAMPAIGN_ID`; rerun the test.
- [x] Viral owner: implement campaign API pagination, sanitized ingestion, campaign eligibility and scoped event handling in `src/viral.js`, `src/sync.js`, `src/webhooks.js` and focused tests. Coordinate the snapshot contract with the analytics owner.
- [x] Analytics owner: add non-destructive separate campaign storage and fail-closed `getAnalytics` scope in `src/db.js`, `src/analytics.js`, migration and DB/analytics tests. Explicit zero performance must include all roster members.
- [x] Discord owner: update `src/bot.js`, `src/presentation.js`, `src/ai.js`, `src/delivery.js` and tests for campaign names, zero ties, scoped report/recovery keys and one initial campaign summary.
- [x] Runtime owner: wire initial campaign summary, require successful scoped synchronization for readiness and document configuration/coverage.
- [x] Run `TEST_DATABASE_URL=postgresql://stoevski@127.0.0.1:55439/footly_test npm test`, audit, diff and secret checks. Review integration contracts and fix failures before pushing.
- [ ] Stage the verified campaign variable, commit/push to `main`, deploy the existing Railway service and verify source commit and readiness.
- [ ] Verify the existing leaderboard now shows only the four campaign creators at zero and the scoped summary is delivered once. Record evidence and remaining limits.
