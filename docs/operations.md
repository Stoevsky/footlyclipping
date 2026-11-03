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

Channel mappings were discovered from the authenticated Discord sidebar and saved as Railway variables. No new channels were created. Private-channel permissions were verified by production readiness after authorized installation and category-role configuration.

| Purpose | Existing channel |
| --- | --- |
| Persistent leaderboard | leaderboard |
| Viral alerts | viral-videa |
| Daily and weekly reports | dnevni-analytics |
| Creator growth | postignuvanja |
| AI | footly-ai |

The database is linked by the Railway reference `${{Postgres.DATABASE_URL}}`, without copying or exposing its password. Application/guild/channel IDs are deployment variables, not embedded in source.

## Production verification gate

Check the actual deployment logs, `/health`, `/ready`, source commit, Discord gateway and command registration, all channel permissions, and first successful Viral synchronization. Runtime readiness requires configuration, DB, Discord, analytics freshness and initialized schedules. Missing provider secrets must never be described as a successful bot launch.

The user entered Discord, Viral.app and OpenAI credentials through Railway Variables. Their values were not copied into project files. The generated webhook signing secret was entered by the user and a real signed provider test was accepted. Never create/reset provider credentials or paste them into chat. For optional webhook support, register the public `/webhooks/viral-app` URL in Viral.app, select supported tracking events explicitly, and enter its generated signing secret in Railway.

## Non-destructive recovery

- Never delete the database to fix a bad application deploy.
- Preserve the single bot replica. Delivery workers use database locks, but analytics deployments should not overlap independently configured organizations.
- Roll back code by redeploying a known commit; migrations are additive and old data remains.
- Inspect failed queue rows with read-only SQL before requeueing an identified delivery. Do not erase delivery records: they prevent duplicates.
- Keep `.env*` ignored. Review staged paths and secret-scanner results before every push.

## Local verification before deployment

All 80 tests passed with a disposable local PostgreSQL instance, including migrations, rollback, queue/delivery recovery and forced disconnect fault injection. No tests were skipped. `npm audit --omit=dev` found zero vulnerabilities; `git diff --check` and credential-pattern review passed. Live provider verification follows deployment.

## Production verification — 2026-11-03, Europe/Skopje

- Implementation commit: `6ae4c9cb1f62933d4aa8d2bb32a247068fe1e955`, branch `main`; push was fast-forward and remote SHA was verified.
- Railway deployment: `f3543e22-4204-4026-9e09-815277e734a0`, Active/Deployment successful. Node 24.22.2, npm start, one replica, `/ready`, 300-second health timeout, five On Failure retries.
- At 16:39, public `/health` and `/ready` returned HTTP 200. Readiness reported configuration, PostgreSQL, Discord, analytics and jobs true.
- Production logs confirmed repeatable migrations, Discord gateway connection, guild slash-command registration and successful synchronization. The official API inventory (22 accounts, 291 videos) matched the authenticated Viral.app dashboard counts.
- Discord installation originally failed with Missing Access (50001). With the user's explicit approval, the unused code-grant requirement was disabled, the existing Footly Clipping application installed with bot/commands scopes and four needed permissions, and its role granted access to the mapped bot category. No Administrator permission was granted to the bot.
- A persistent real-data leaderboard and the daily/weekly catchup reports appeared in the mapped channels at 16:39. Missing historical metrics and old source observation times were labeled rather than invented.
- A real `/prasaj` response appeared in the AI channel; `[ai] Recommendation selection validated` at 16:38:15 confirmed a successful provider response, not fallback alone.
- Viral endpoint `whep_RQqVGpQZpqvM` is active at the public `/webhooks/viral-app` URL and explicitly subscribes only to the five supported analytics/tracking events.
- A provider-generated `webhook.test` received HTTP 204 on its first attempt at 16:40. An unsigned HTTP request received 401 Invalid signature. The test published no fake Discord milestone.
- A controlled Railway restart at 16:41:44 recovered database connectivity, Discord login, commands, schedules and synchronization. `/ready` returned HTTP 200 with all readiness checks true at 16:42:43. The daily and weekly reports retained their original delivery markers and were not duplicated after restart.

The next genuine video milestone has not occurred during launch verification. Milestone thresholds, source event validation, webhook/poll deduplication and delivery recovery are covered by automated tests; live signed transport and live Discord delivery were separately verified. Absolute exactly-once behavior cannot be guaranteed if an external Discord message is deleted during an ambiguous send/receipt failure.

The Railway UI reported Auto deploy unavailable while the connected public repository and main-branch manual deployments worked. Future pushes should be followed by an explicit source/deployment check; do not assume a push alone rolls out code.
