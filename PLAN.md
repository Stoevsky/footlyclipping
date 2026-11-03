# Footly production checklist

Implementation and test work is tracked in `docs/superpowers/plans/2026-11-03-production.md`; operational evidence is in `docs/operations.md`.

- [x] Confirm exact Railway crash from logs; preserve existing Postgres.
- [x] Add resilient startup, liveness/readiness, dependency retries and graceful shutdown.
- [x] Implement official paginated Viral inventory, snapshots, period analytics and polling fallback.
- [x] Implement signed webhooks, durable queue/delivery deduplication and restart recovery.
- [x] Implement requested commands, persistent leaderboard, daily/weekly reports and grounded AI.
- [x] Add safe migrations, source coverage labels, Skopje calendar/DST handling and tests.
- [x] Map existing channels and configure Railway database reference/domain/settings.
- [x] Complete final full-suite verification and secret review: 80 passed, zero skipped; audit clean.
- [ ] Push tested main commit and verify remote.
- [ ] Deploy and verify real Railway, PostgreSQL, Discord, Viral and AI integrations.
- [ ] Verify provider webhook signing secret and test delivery.
- [ ] Record final deployment evidence and remaining limits.
