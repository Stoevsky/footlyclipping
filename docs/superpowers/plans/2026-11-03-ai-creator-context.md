# Conversational Footly AI Plan

The user's follow-up expands AI answers to OpenAI-generated responses using Footly, the wider Viral.app organization, general knowledge and slideshow guidance. It does not expand campaign leaderboard/report/alert scope.

- [x] Read current Footly product information and the user's slideshow production, resources, FAQ and content library references.
- [x] Keep private creator guidance outside the public repository; stage `FOOTLY_KNOWLEDGE_TEXT` in Railway.
- [x] Add public product context and a bounded private runtime context extension.
- [x] Verify separate `createSynchronizer({campaignId:null,milestones:[]})` refreshes organization context without generating alerts or altering campaign snapshots.
- [x] Implement full OpenAI responses for all questions, including zero-activity campaigns, with validated fact references and readable fallback.
- [x] Add `/prashaj` alias, retain `/prasaj`, authorized-guild/channel guards and cooldown, and use a bounded embed for longer creative answers.
- [x] Test context separation, privacy, fact validation, provider errors, zero activity, slideshow output and alias behavior; run the complete PostgreSQL-backed suite.
- [ ] Push and deploy; verify a real OpenAI answer in Discord while the leaderboard still shows only the campaign's four creators.
