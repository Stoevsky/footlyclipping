# Footly operations record — 2026-11-03

## Confirmed incident

Railway deployment `3ba58c8a-500f-4ae7-8833-190401ca9598` crashed at `src/config.js:41`. Logs at 16:04 Europe/Skopje show all eleven original required variables missing. Runtime was Node.js 24.10.0; `npm start` correctly invoked `node src/index.js`.

The project contained a staged deletion of its existing Postgres service. The deletion was cancelled using Keep Service. The existing service then showed Online; no database was deleted or recreated.

## Existing resources

- Repository: https://github.com/Stoevsky/footlyclipping
- Deployment branch: `main`
- Railway project: `61c9ac04-21c6-4f56-b1b1-ec6f9380d334` (`mindful-compassion`)
- Production environment: `d3c0daa5-345e-435d-9056-37fa6f6d0fa8`
- Bot service: `dfe65602-e612-41ba-b871-627fae875480` (`footlyclipping`)
- PostgreSQL service: `cd1ae63b-eaab-4969-9a0d-5d77bc1061c8` (`Postgres`)

Channel mappings were discovered from the authenticated Discord sidebar and saved as Railway variables. No new channels were created. Private-channel permissions for the bot still require runtime verification.

| Purpose | Existing channel |
| --- | --- |
| Persistent leaderboard | leaderboard |
| Viral alerts, daily and weekly reports | rezultati |
| Creator growth | accounti |
| AI | promptiranje |

The database is linked by the Railway reference `${{Postgres.DATABASE_URL}}`, without copying or exposing its password. Application/guild/channel IDs are deployment variables, not embedded in source.

## Production verification gate

Check the actual deployment logs, `/health`, `/ready`, source commit, Discord gateway and command registration, all channel permissions, and first successful Viral synchronization. Runtime readiness requires configuration, DB, Discord, analytics freshness and initialized schedules. Missing provider secrets must never be described as a successful bot launch.

The user entered Discord, Viral.app and OpenAI credentials through Railway Variables. Their values were not copied into project files. The Viral webhook endpoint form is prepared and signing-secret entry is in progress. Never create/reset provider credentials or paste them into chat. For optional webhook support, register the public `/webhooks/viral-app` URL in Viral.app, select supported tracking events explicitly, and enter its generated signing secret in Railway.

## Non-destructive recovery

- Never delete the database to fix a bad application deploy.
- Preserve the single bot replica. Delivery workers use database locks, but analytics deployments should not overlap independently configured organizations.
- Roll back code by redeploying a known commit; migrations are additive and old data remains.
- Inspect failed queue rows with read-only SQL before requeueing an identified delivery. Do not erase delivery records: they prevent duplicates.
- Keep `.env*` ignored. Review staged paths and secret-scanner results before every push.

## Local verification before deployment

All 80 tests passed with a disposable local PostgreSQL instance, including migrations, rollback, queue/delivery recovery and forced disconnect fault injection. No tests were skipped. `npm audit --omit=dev` found zero vulnerabilities; `git diff --check` and credential-pattern review passed. Live provider verification follows deployment.
