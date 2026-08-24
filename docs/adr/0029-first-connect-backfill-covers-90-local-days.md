# First-connect backfill covers 90 local days

Supersedes [ADR 0015](0015-first-connect-backfill-to-start-of-calendar-month.md). A newly selected Ad Account's initial import backfills daily history from 90 calendar days before its current account-local date through today. This gives an agency director enough immediate trend context to evaluate a newly onboarded Client, even when the connection happens early in a month. The extra first-import Meta API load is accepted as more valuable than minimizing initial history.

This does not change [ADR 0014](0014-daily-history-with-a-rolling-reconciliation-window.md): the current day and 28 prior complete days remain the only dates that are re-polled and overwritten. Days 29–90 back are written during initial import and then treated as Final.

[ADR 0032](0032-sync-runs-are-durable-and-invisible-when-healthy.md) makes the import durable and independently resumable per account. The account remains outside the Fleet Board until its Account data, hierarchy, today's Insights, and this history are usable; Creative enrichment is non-blocking. The former temporary timestamp-reset action is removed rather than carried into the durable job model.
