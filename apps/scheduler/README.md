# Adomata scheduler

This Cloudflare Worker calls the API's authenticated `/scheduler` endpoint every
five minutes. It is deployed separately from the client SPA.

Set `SCHEDULER_SECRET` as a Cloudflare Worker secret to the same value used by
the API, then deploy with `pnpm --filter @adomata/scheduler deploy`. See the
[deployment guide](../../docs/DEPLOYMENT.md#scheduler-worker) for the complete
production procedure and verification record.
