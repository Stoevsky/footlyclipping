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


## Campaign scope correction — 2026-11-03

The user selected the recent four-creator campaign, **Clipping Kampanja 5 Seriozni** (`orgcamp_UrJnb4ms3ZR8`). The campaign setting is pinned in Railway. Implementation `2f449231807b439b481ff1963fa00be91be1a761` passed 108 tests with PostgreSQL, zero skips, and was deployed as `a85f8e10-1835-4220-8147-bacad1ffe2b3`. At 16:55:40 Skopje, production synchronization reported four creators, zero eligible campaign videos and no milestones. `/ready` returned HTTP 200 with all checks true.

The existing leaderboard message was edited in place: exactly four campaign creators, each at zero views, explicitly tied. One campaign summary appeared in the analytics channel with zero campaign views/posts and all four participants. Prior organization data remains stored separately. Pre-participation daily/weekly reports are suppressed; future reports use campaign data. Campaign video lists are limited by the provider's top-300 endpoint, with eligibility failures excluded from alerts.

The user's subsequent AI request authorizes broader organization context for `/prasaj` and `/prashaj` only. It does not change campaign-only leaderboard, report or alert scope. Private creator-guide notes are kept in runtime configuration, not committed to Git.

## Manual code releases

When Railway's GitHub auto deploy is unavailable, staging a non-secret `RELEASE_REVISION` variable with the intended commit SHA and deploying the staged change pulls the latest connected `main` source. Always verify the resulting GitHub source SHA in deployment Details; the marker is only an operator label, not source verification. Keep credential variables collapsed while inspecting deployments.

## Conversational AI verification — 2026-11-03, 17:17 Skopje

Deployed source `ef61230c3119a81e77d76b3a9d5383ae78428cca` as Railway deployment `f31b9081-a556-4788-ade5-e965d2638dbe`. Details showed Deployment successful and the exact GitHub source SHA. `/ready` returned HTTP 200 with configuration, analytics, database, Discord and jobs true.

The initial expanded AI call reached OpenAI but failed the measured-number guard. Safe diagnostics identified `AI_MEASURED_NUMBER_GUARD` after about seven seconds, rather than a credential, timeout or token-limit failure. Regression tests reproduced numbered-list false positives; the guard now distinguishes list numbering from measured statistics. A single corrective retry handles invalid numeric prose or nonexistent fact references, with a safe fallback if validation still fails.

At 17:17:45 the production log recorded `[ai] OpenAI conversational response validated`. The actual `/prashaj` response contained five original Footly slides, a visual suggestion for each, caption and CTA. It contained neither provider branding nor an empty statistics block. The user-facing response is Discord message `1567211169373093958` in the configured AI channel. `/prasaj` remains an alias of the same handler.

The independent AI context refresh loaded 27 organization accounts and 291 videos. The campaign leaderboard remained limited to four creators (five connected accounts), including both current handles for Lazar. Its existing message was updated in place to list the roster and await first posts, without repeated zeros or provider branding. New inactive-campaign reports use the same concise roster format; earlier historical reports were retained.

The final implementation passed 130 PostgreSQL-backed tests with zero skips, dependency audit with zero vulnerabilities, diff checks and a credential-pattern scan of 49 project files. Private creator-guide notes remain runtime configuration, not repository contents. The AI has summarized guide knowledge and selected analytics context; it does not claim to have viewed linked media that has not been loaded.

## Additional creator document — 2026-11-03, 20:43 Skopje

The user supplied `footly_mk (3).docx` for the bot's knowledge. Its complete extracted text (294 nonempty paragraphs) and nine external link references were stored in private Railway variable `FOOTLY_DOCUMENT_TEXT`, alongside the existing guide. No document content was committed to the repository. Embedded form/image placeholders have no loaded contents; the document contains no embedded image files. The temporary extraction was removed and the original DOCX preserved.

Implementation `36666b3bc0b8a72548c9da2dda27ad46c8535ede` was deployed as `9da56488-b77b-47f6-b00c-38ffeb30cd54`; Railway confirmed the exact source SHA and Deployment successful. All 132 PostgreSQL-backed tests passed without skips. An actual-document boundary check confirmed the entire document fits alongside a guide larger than the configured guide, with `knowledgeTruncated:false`. The model receives both as untrusted source material with a 32,000-character knowledge limit and source-attribution guidance.

`/ready` returned HTTP 200 with all checks true. A live `/prashaj` document-specific question produced an OpenAI answer using details from the added material, in Discord message `1567262871392616631`. Existing message-format preferences and campaign scope remain in force.
