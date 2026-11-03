# Footly production repair design

The user approved autonomous completion through deployment in the supplied master request. Retain Node.js, Discord.js, PostgreSQL and Railway; avoid an unnecessary framework rewrite. Repair the existing application in four coordinated components: runtime/configuration, paginated Viral ingestion, persisted analytics, and Discord/report/AI presentation.

Confirmed incident: Railway deployment 3ba58c8a failed at config.js:41 because all eleven required variables were absent. Node 24.10.0 executed npm start correctly. A pre-existing staged Postgres deletion was cancelled to preserve the database before deployment.

HTTP starts before dependency initialization. /health checks process liveness; /ready reports dependency readiness without secrets. Invalid configuration remains visibly unready; transient DB/login/network failures retry with capped backoff. Shutdown stops schedules, HTTP, Discord and the pool.

Viral ingestion uses official paginated accounts/videos endpoints, finite retries and only supported signing/events. A successful sync atomically replaces current inventory and adds UTC snapshots and history. Unknown fields remain null. Reporting uses Europe/Skopje calendar periods and labels incomplete history. Discord delivery uses durable idempotency records with deterministic markers and reconciliation to recover send/write interruption. A single production replica is enforced operationally.

All commands read persisted analytics. Every channel is checked against the authorized guild. Administrative commands check permissions at runtime. AI receives selected computed facts without emails or secrets, distinguishes advice, and falls back to deterministic analytics. Reports run daily and weekly at 09:00 with persistent period keys and restart recovery.

Validation includes test-first regressions, repeatable real PostgreSQL migration tests, HTTP readiness/error tests, mocked external responses with production-shaped fixtures, and live read-only integration checks. Production alerts require genuine source events; no fabricated metrics are sent.
