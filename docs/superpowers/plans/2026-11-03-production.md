# Footly Production Implementation Plan

> For agentic workers: use subagent-driven-development and test-driven-development. The user has authorized execution; independent components are delegated with disjoint file ownership.

**Goal:** Repair, configure, test and launch the existing Footly bot, reporting any credential blockers accurately.

**Architecture:** Keep the existing Node/Postgres service. Add durable analytics, bounded retry, secured Discord outputs, and persistent report/alert delivery with recovery.

**Tech Stack:** Node 24, discord.js 14, pg, node-cron, native node:test.

- [x] Inspect repository and baseline tests (3 passing); retrieve actual Railway failure logs.
- [x] Preserve the existing Postgres service by cancelling its staged deletion.
- [x] Runtime owner: src/config.js, src/index.js, src/runtime.js, package/hosting files, runtime/config tests. Reproduce missing-config failure, add safe validation/readiness and dependency retry lifecycle; verify HTTP liveness and readiness separately.
- [x] Analytics owner: src/db.js, src/analytics.js, src/utils.js, migrations and DB/date/analytics tests. Add safe repeatable migration, full inventory/snapshots/sync history, true calendar ranges, explicit missing coverage, and persistence contracts agreed with ingestion and Discord owners.
- [x] Viral owner: src/viral.js, src/sync.js, src/webhooks.js and corresponding tests. Verify OpenAPI response shapes, paginate all accounts/videos, retry 429/5xx, persist clean snapshots, validate signed events and route threshold deliveries through the shared idempotent delivery interface.
- [x] Discord owner: src/bot.js, src/ai.js, src/presentation.js, src/delivery.js, scripts/register.mjs and corresponding tests. Add commands, guild/admin guards, Latin outputs, factual AI fallback, daily/weekly report delivery and message reconciliation.
- [x] Review component contracts and run npm test plus real temporary PostgreSQL integration. Fix actual failures before publishing.
- [x] Configure the existing Railway service and channel mapping; have the user enter credentials directly in the service interface.
- [x] Review diff and secret exposure; commit descriptive change, push fast-forward to authorized GitHub repository and verify remote SHA.
- [x] Deploy through existing main branch; verify /health, /ready, logs, DB, Discord, API and webhook checks. Document incomplete credentials/integrations explicitly.
- [x] Rewrite README and record final evidence/status.
