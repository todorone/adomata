# Adomata Client

TanStack Router + Vite single-page app for the Adomata platform. Built as a
static bundle and **deployed separately** from the API (no server runtime).

## Tenancy

The sidebar reads the active Agency from `GET /me`. Switching Agency reloads the
SPA so TanStack Query cannot show cached data from the previous Agency. See
[the multi-tenancy model](../../docs/MULTI-TENANT.md) before changing this flow.
