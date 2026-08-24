# Meta-mock testing stops at the sync layer for now; board E2E waits for Onboarding

The connect flow now exists, so the prerequisite that originally blocked real-flow Fleet Board coverage
no longer holds. [ADR 0032](0032-sync-runs-are-durable-and-invisible-when-healthy.md) requires a
connection → Initial Import → fresh-board Playwright path while retaining this ADR's prohibition on
test-only seeding endpoints.

Today's Meta-mocking effort is scoped to API-level integration tests (vitest, inside `apps/api`) that run the heartbeat against the fake Meta ([ADR 0014](0014-meta-api-faked-via-network-interception.md)) and assert directly against the database — not Playwright coverage of the Fleet Board itself. This is a direct consequence of [issue #2](https://github.com/todorone/adomata/issues/2) listing Onboarding (how an Agency connects a Business Manager, how an Ad Account gets attached to a Client) as not yet specified: there is no real endpoint yet that could put a fixture Ad Account under a Client the way [apps/client/e2e/fixtures.ts](../../apps/client/e2e/fixtures.ts) requires ("seeded through the real API, no test-only endpoints"). Building a throwaway stand-in connect endpoint just to unblock Playwright now was considered and rejected — it would either become permanent test-only surface that contradicts that rule, or have to be built and then discarded once real Onboarding ships. Once Onboarding is designed, Playwright E2E of the board becomes possible by driving that real flow pointed at fake Meta, with the "no test-only endpoints" rule holding without exception.
