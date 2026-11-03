# Footly Growth Bot

A Node.js 24 Discord bot for the existing Footly creator community. It stores real Viral.app analytics in PostgreSQL and publishes Macedonian Latin-script leaderboards, milestone alerts, daily/weekly reports, and data-grounded growth answers.

Production leaderboards, reports and alerts use the selected **Clipping Kampanja 5 Seriozni** campaign through `VIRAL_CAMPAIGN_ID`. Its roster remains visible even before the first campaign video or view. AI answers can also use separately labeled organization analytics for wider context.

## Architecture

- `src/index.js`: HTTP-first startup, dependency recovery, Discord registration, readiness, synchronization and schedules.
- `src/viral.js` and `src/sync.js`: official API client, complete inventory pagination, rate-limit handling, normalization, transactional snapshots, polling milestone fallback.
- `src/db.js`, `migrations/`: additive migrations, inventories, metric history, webhook queue and durable delivery records.
- `src/analytics.js`: repeatable-read analytics, calendar periods, weighted engagement and explicit coverage.
- `src/webhooks.js`: signed HTTP ingestion, validation, replay protection, queue leases and retries.
- `src/delivery.js`: per-message database locks, Discord receipt storage and interrupted-send reconciliation.
- `src/bot.js`, `src/presentation.js`, `src/ai.js`: commands, bounded reports, deterministic facts and conversational OpenAI answers.

HTTP starts before provider initialization. Missing configuration keeps `/health` alive and `/ready` unready, with variable names in logs. Database migrations retry with capped exponential backoff. Discord login/channel validation retries. Initial transient synchronization failures retry without bypassing provider cooldown; rejected credentials wait for a later scheduled run or configuration redeploy. Jobs do not overlap in one process. Use one production replica.

## Local installation

```sh
npm ci
cp .env.example .env
# Enter local development credentials in .env, never commit it.
npm run dev
```

Use a separate test guild/database for development. `npm start` reads injected environment variables, as Railway provides. To run without watch using a local file: `node --env-file=.env src/index.js`. Registration happens at startup; `npm run register` can register commands separately.

## Configuration

The full template is `.env.example`. Enter production secrets directly in Railway's service Variables tab. Never paste credentials into chat, logs, issues or commits.

| Variable | Purpose |
| --- | --- |
| `DISCORD_BOT_TOKEN` | Existing Discord bot token; required |
| `DISCORD_CLIENT_ID`, `DISCORD_GUILD_ID` | Application and authorized server IDs; required |
| `VIRAL_API_KEY` | Existing organization's API key; required |
| `DATABASE_URL` | PostgreSQL connection string; Railway reference `${{Postgres.DATABASE_URL}}` |
| `DATABASE_SSL` | `false` for the existing Railway private network; `true` uses verified TLS for a provider requiring it |
| `CHANNEL_VIRAL_ALERTS` | Existing milestone channel |
| `CHANNEL_LEADERBOARD` | Existing persistent leaderboard channel |
| `CHANNEL_DAILY_ANALYTICS` | Existing daily report channel |
| `CHANNEL_WEEKLY_ANALYTICS` | Optional; defaults to daily channel |
| `CHANNEL_CREATOR_GROWTH` | Existing follower milestone channel |
| `CHANNEL_FOOTLY_AI` | Existing AI command channel |
| `CHANNEL_NEW_VIDEOS` | Optional; omitted means no new-video posts |
| `VIRAL_WEBHOOK_SECRET` | Exact generated endpoint signing secret; optional when using polling only |
| `VIRAL_ORG_ID` | Optional additional incoming organization-ID check |
| `VIRAL_CAMPAIGN_ID` | Pin a campaign (`orgcamp_…`); all analytics use its official eligible campaign data with no organization fallback |
| `OPENAI_API_KEY` | Optional; analytics answers remain available without it |
| `OPENAI_MODEL` | Supported Responses model; default `gpt-4.1-mini` |
| `FOOTLY_KNOWLEDGE_TEXT` | Private Footly/slideshow reference notes for AI; store in Railway, never commit their contents |
| `FOOTLY_DOCUMENT_TEXT` | Additional private creator document text; stored in Railway alongside the guide |
| `PORT` | HTTP listener, default `3000` |
| `REPORT_TIMEZONE` | Default `Europe/Skopje` |
| `DAILY_REPORT_CRON` | One fixed daily time; default `0 9 * * *` |
| `WEEKLY_REPORT_CRON` | One fixed Monday time; default `0 9 * * 1` |
| `SYNC_INTERVAL_MINUTES` | Default `60`, valid 1–1440; respect the organization's request quota |
| `STARTUP_RETRY_MS` | Initial dependency retry delay; default `5000` |
| `MIN_VIRAL_VIEWS`, `MIN_FOLLOWERS` | Minimum eligible alert thresholds; default `10000` |
| `VIRAL_MILESTONES` | Default `10000,50000,100000,250000,500000,1000000,5000000,10000000` |

All five primary channel variables are required even when destinations share an existing channel. IDs stay in deployment configuration; the bot never creates channels.

## Discord setup and commands

Install the existing application with `bot` and `applications.commands` scopes in the authorized guild. Give it View Channel, Send Messages, Embed Links, and Read Message History in each destination. The bot only requests the Guilds gateway intent; privileged message-content/member intents are unnecessary. Startup validates guild ownership and channel permissions before readiness.

Current deployment mapping: leaderboard → `leaderboard`; alerts → `viral-videa`; daily/weekly → `dnevni-analytics`; growth → `postignuvanja`; AI → `footly-ai`.

| Command | Behavior |
| --- | --- |
| `/leaderboard`, `/top` | Rank views, followers, engagement, posting frequency or observed follower growth |
| `/topvideos` | Lifetime video views or gains in a selected period |
| `/kreator username platforma? period?` | Tracked creator statistics; platform disambiguates accounts |
| `/statistika period?` | Aggregate counts and measured gains |
| `/izvestaj tip?` | On-demand daily/weekly report preview |
| `/prasaj prashanje`, `/prashaj prashanje` | OpenAI answers using campaign facts, organization context, Footly knowledge and slideshow guidance; configured AI channel only |
| `/osvezi` | Synchronize and update the persistent leaderboard; Manage Server required |
| `/status` | Private queue/synchronization status |
| `/test` | Private bot check; Manage Server required |

Periods: today, yesterday, current week, previous week, current month, last 30 days and lifetime. The persistent leaderboard updates after sync; its message ID survives restarts. Replies suppress mentions. Administrative permissions are checked at execution as well as command registration.

Daily reports summarize yesterday at 09:00 Skopje. Weekly reports summarize the completed Monday–Sunday week at Monday 09:00. DST follows the IANA timezone. A minute retry loop catches a missed schedule after restart, but reports wait for a fetched closed-period dataset. Durable keys prevent normal duplicate sends; unfinished older deliveries are recovered independently.

Launch verification covered configured schedules, automated scheduling tests, real catchup reports and restart deduplication. A scheduled 09:00 production execution has not yet been observed.

## Viral.app and data meaning

With `VIRAL_CAMPAIGN_ID`, the bot reads the campaign and creator roster plus the official `/creator-hub/overview` performance, KPI and video endpoints. Campaign assignment and eligibility rules are applied by Viral.app. Performance pagination includes every participant. Before the first activity, the leaderboard shows the complete roster and an awaiting-first-posts message rather than repeated zeros. Failed or missing metrics remain unknown. Campaign snapshots preserve the original organization data separately, and pending organization deliveries are excluded from campaign recovery. The existing leaderboard message is edited in place; one current campaign summary is posted after its first successful synchronization.

The campaign video endpoint returns up to 300 videos. Rankings and alert eligibility are limited to the returned campaign video set and labeled accordingly; creator totals come from the paginated performance dataset. A video absent from that eligible set cannot trigger a campaign alert. Period boundaries follow the provider's reported timezone, with differences from Skopje disclosed. A newly configured campaign never falls back to old organization totals while synchronization is pending.

When no campaign is configured, organization mode works as follows:

Integration uses the [official API reference](https://viral.app/api/v1/docs) and [webhook guide](https://viral.app/docs/brands/api/webhooks). Inventory uses `/accounts` and `/videos`, checks every page against source totals, and never replaces good data after an incomplete fetch. Creator period metrics use filtered batches of up to 100 IDs, requesting every tracked account; unavailable period metrics remain explicitly unknown. Competitor accounts/videos are excluded.

Register this production endpoint:

`https://footlyclipping-production.up.railway.app/webhooks/viral-app`

Explicitly subscribe to these opt-in events (All Events alone does not include them):

- `video.views_milestone`
- `account.followers_milestone`
- `video.published`
- `organization.synced`
- `sync.completed`

Copy the endpoint's generated signing secret into `VIRAL_WEBHOOK_SECRET`, then redeploy. Standard Webhooks signatures validate the raw request body, ID and timestamp with a five-minute tolerance. Requests are bounded to 1 MiB, validated, and persisted before acknowledgement. Database event IDs suppress retries; durable per-video/threshold delivery keys deduplicate webhooks against polling. Sync notifications are debounced. Unsupported signed event types are acknowledged without storing their unrelated contents. `webhook.test` is accepted without publishing a Discord alert.

Hourly polling provides video milestone alerts even without webhooks. The first complete sync establishes a baseline and does not announce historical milestones. Each later crossed threshold is processed once under the same delivery key. Follower milestone and new-video notifications depend on provider webhooks. New-video posting requires its optional channel.

Data limitations are shown in Discord:

- Viral period aggregates use UTC calendar days. Report scheduling and publication-day counts use Europe/Skopje. UTC period gains are never blended with local snapshot deltas.
- The provider's period video ranking is limited to its top 100; lifetime inventory is fully paginated.
- Missing values remain unknown, never synthetic zero. Partial rankings are labeled.
- Engagement consistently means `(likes + comments) / views`; unavailable shares do not alter this formula.
- Follower growth requires observed history; initial deployment cannot invent prior follower snapshots.
- Source `loadAt` freshness is separate from successful fetch time. Stale/unknown source timestamps are disclosed.
- Instagram numeric IDs are not public shortcodes. Missing source URLs remain absent rather than producing invented links.

## AI grounding and creator knowledge

OpenAI Responses answers actual questions, including creative slideshow requests even when campaign metrics are zero. It receives the question, separately labeled campaign/organization facts, source timestamps and coverage, public Footly product context, and optional private creator guidance from `FOOTLY_KNOWLEDGE_TEXT`. A separate organization synchronization supplies broader AI context with milestone generation disabled; it cannot change campaign leaderboard/report scope. User-facing messages omit provider branding. Creative answers focus on useful ideas and omit empty statistics blocks.

The model returns conversational guidance plus references to supplied analytics facts. The application validates fact references and renders those facts itself. Prompts distinguish recorded performance from suggestions and general model knowledge, prohibit invented statistics, and keep campaign totals separate from organization history. Responses remain Macedonian Latin. The bot does not browse live trends or inspect the contents of linked videos; missing information must be disclosed.

Private slideshow reference notes are stored only in Railway configuration. They cover hooks, slide structure, captions, CTAs and source links; contracts, creator contact information and credentials are excluded. Current product facts take precedence over older creative claims, and conflicting older posting targets are not presented as current campaign rules.

Additional user-supplied document text is stored separately in `FOOTLY_DOCUMENT_TEXT`. Both sources are included in the AI knowledge context with a combined 32,000-character limit and explicit truncation flag. Document content is reference material, never executable instructions; its claims and program terms are attributed to the document. Forms and image placeholders do not imply their contents were loaded or submitted.

`store:false` is set. Source text and usernames are treated as untrusted data. Provider failures preserve deterministic facts and a clearly labeled fallback; a per-user cooldown limits repeated requests. `/ready` does not depend on the optional AI provider or wider organization refresh. Verify the AI provider separately with a controlled command and its safe success log.

## PostgreSQL

Startup applies numbered SQL migrations under an advisory lock and transaction. Existing tables and legacy milestone/report records are preserved. Tables include creators, tracked videos, creator/video metrics, period snapshots, synchronization history, webhook events, bot state, and notification deliveries. UTC `TIMESTAMPTZ` values retain exact observation times. Queries are parameterized; analytics reads use a consistent transaction.

Back up the Railway volume before manual maintenance. Never delete the database to fix application configuration. Do not erase notification or milestone records: they are the deduplication history. Historical metrics grow with synchronization frequency; review storage periodically and design a backed-up retention policy before pruning.

## Railway deployment

Use repository `Stoevsky/footlyclipping`, branch `main`, Node 24, Railpack build (lockfile-based npm installation), start command `npm start`, one replica, sleeping/serverless disabled, and restart On Failure with five retries. The repository includes `railway.json`; mirror settings in Railway UI where config-as-code is unavailable.

Keep the existing Postgres service/volume. Set the database reference and other variables, public domain target port 3000, healthcheck `/ready` with 300-second timeout, then deploy the tested main commit.

- `GET /health`: HTTP process liveness, 200.
- `GET /ready`: 200 only with valid configuration, live migrated DB, connected/configured Discord, recent successful analytics sync and initialized jobs. Otherwise 503 with safe booleans.
- `POST /webhooks/viral-app`: signed event endpoint; unsigned requests are rejected.

Verify the running source commit, migration completion, gateway readiness, command registration, first successful sync counts, initialized schedules, and both HTTP probes. Inspect one real leaderboard/report and one AI request. Use the provider's non-publishing test event to verify webhook delivery. A build alone is not proof of a working deployment.

## Testing

```sh
npm test
TEST_DATABASE_URL=postgresql://localhost/footly_test npm test
npm audit --omit=dev
```

The optional integration URL must name a disposable local test database. Tests create isolated schemas and remove only their own schemas. Fault injection terminates only the connection created by the test. Without the URL, PostgreSQL integration cases are skipped. Tests cover configuration, DST/calendar math, complete pagination, rates/retries, real migrations and rollback, database disconnect recovery, signed/replayed/duplicate webhooks, polling milestones, delivery crash reconciliation, schedules, bounded Latin text, accurate context and provider fallback. Fixtures are synthetic and never used for production metrics.

The local simulator requires `FOOTLY_TEST_WEBHOOK_SECRET` and an explicit loopback URL; it refuses production URLs and emits only `webhook.test`. It is not a production alert generator.

## Troubleshooting and maintenance

- Missing/invalid variables: logs show names only. Correct Railway Variables, save and deploy; do not reset unrelated credentials.
- `VIRAL_HTTP_401`/`403`: verify the organization's existing API key and access. `402`: inspect plan restrictions without purchasing. `429`: honor provider cooldown and avoid repeated manual refreshes.
- `/ready` analytics false: inspect the last synchronization error. Previous successful data remains available; stale coverage is disclosed.
- Discord channel errors: verify existing channel IDs, guild membership and the four required permissions. Do not create duplicate channels.
- `AI_UNAVAILABLE` or HTTP fallback: standard analytics continue. Verify model access and API billing through the provider's secure interface.
- Queue failures: inspect `viral_events.status`, `attempts`, `available_at`, and sanitized `error`. After 12 attempts events stay failed for operator review. Requeue only identified corrected failures, retaining original IDs.
- Pending deliveries: the minute recovery job checks bot-owned message markers before retrying. Failed history reads or more than 5,000 messages to reconcile fail closed. External message deletion/network ambiguity prevents an absolute exactly-once guarantee across Discord and PostgreSQL.
- Deploy upgrades with `npm ci`, full tests and secret review, then verify `/ready` and live logs. Use additive migrations. Roll back application code without destroying persistent data.

See `docs/operations.md` for the incident and verification record. No token, password or analytics export belongs in this repository.
