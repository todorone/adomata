# First-connect backfill covers 90 local days

Supersedes [ADR 0015](0015-first-connect-backfill-to-start-of-calendar-month.md). A newly connected Ad Account's first Insights Tier sync backfills daily history from 90 calendar days before its current account-local date through today. This gives an agency director enough immediate trend context to evaluate a newly onboarded Client, even when the connection happens early in a month. The extra first-sync Meta API load is accepted as more valuable than minimizing initial history.

This does not change [ADR 0014](0014-daily-history-with-a-rolling-reconciliation-window.md): the current day and 28 prior complete days remain the only dates that are re-polled and overwritten. Days 29–90 back are written during first sync and then treated as Final.

Existing Ad Accounts stay forward-only by default. A temporary owner-only Agency settings action clears `insightsTierRefreshedAt` for already-synced Ad Accounts in that Agency, allowing the existing Insights Tier path to perform the same 90-day first-sync backfill on a later heartbeat without creating another sync mechanism. Accounts whose first Insights Tier sync is already pending remain untouched.
