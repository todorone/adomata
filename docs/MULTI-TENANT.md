# Multi-tenancy

Adomata is multi-tenant: every tenant is an **Agency**. Better Auth retains its
vendor names (`organization`, `member`, and `activeOrganizationId`) only at the
authentication boundary; Adomata-authored behavior and UI use Agency.

## Model

- An Agency is a Better Auth organization. A User belongs to it through a
  membership with one of `owner`, `admin`, or `member` roles.
- The active Agency is held on the session. `GET /me` returns the caller's
  memberships and selected Agency; `POST /me/active-organization` only permits
  a switch to one of the caller's own memberships.
- The client reloads after a switch. This deliberately discards cached,
  Agency-scoped data before rendering the new Agency.
- All Fleet Board reads derive the Agency from the authenticated session and
  scope through `client.agencyId`; clients never provide an Agency id.

## Bootstrap and invitations

- Only `SUPERADMIN_EMAIL` may create Agencies. The configured superuser gets a
  real, reserved `hq` Agency on sign-in so it follows the same scoping rules as
  every other user. `hq` cannot be created through the admin endpoint.
- The first owner is invited during Agency creation. Existing verified users
  are added immediately; new users accept their oldest pending invitation when
  they register.
- Agency owners and admins use Better Auth's organization invitation endpoint.
  The plugin sends the same invitation email for both that path and bootstrap
  invitations. Missing email-delivery configuration logs and skips delivery so
  local development can still create invitations.

## Rules for future routes

1. Put `requireAuth` before `requireOrg` on every Agency-scoped route.
2. Take the Agency id only from `c.get('orgId')`; never from a request body,
   path, query, or client cache.
3. Scope every query and mutation to that Agency, including parent-resource
   lookups used to authorize a nested resource.
4. Do not use Better Auth's organization terminology in product-facing copy.
