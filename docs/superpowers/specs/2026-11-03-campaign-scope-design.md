# Campaign-only Footly analytics

The user requested all bot outputs for the recent campaign with four new creators, including a leaderboard when every creator has zero views. The selected campaign was verified in Viral.app: `orgcamp_UrJnb4ms3ZR8`, **Clipping Kampanja 5 Seriozni**. Its four accounts are rayan.soceer, fctazzy, fcianw and richardfc61. The Creator Hub performance UI explicitly reports zero campaign views and videos for all four.

Pin this campaign through `VIRAL_CAMPAIGN_ID`; do not silently select a different campaign later. Use official `/creator-hub/overview` analytics with campaign filters and provider eligibility rules. Filtering organization lifetime totals by account would still include old videos and is unsuitable. Manually hardcoded zero metrics would become stale and are also unsuitable.

Store sanitized campaign snapshots separately from the existing organization tables. Each snapshot contains campaign metadata, the complete roster, all-time and reporting-period metrics, eligible videos, coverage and synchronization time. Missing data remains unknown; explicit zero rows remain visible. Never persist creator contact or payout details.

All commands, AI facts, reports and persistent leaderboards read only the configured campaign. Until a successful campaign synchronization exists, they must fail closed without falling back to organization data. Keep the existing persistent leaderboard message ID so it is edited in place. New report, alert and summary delivery keys include the campaign ID. Recovery ignores pending organization messages while campaign mode is active.

Campaign alert eligibility must be checked against the provider's campaign dataset. Unknown or outside-campaign videos do not produce alerts. The limited top-video endpoint must be labeled as limited and cannot establish full membership beyond its returned set. Campaign-wide creator totals remain based on the complete paginated performance endpoint.

Publish one idempotent current campaign summary in the existing analytics channel after deployment. Scheduled daily and weekly reports continue with campaign-only data; no claims about a winning creator or best format are made when everyone is tied at zero.

Verification covers scope isolation, complete zero roster, missing-data behavior, API pagination, eligible-event filtering, scoped recovery, report keys, formatting, configuration, PostgreSQL persistence and live Discord output. Existing unrelated data and credentials remain unchanged.
