# Meta sync with a user token that lacks the Ad Account `MANAGE` task

**Research date:** 2026-07-27  
**Question:** Can Adomata continue to read `act_1230665330444136` with the
current user token when the user cannot obtain the Ad Account `MANAGE` task?

## Bottom line

Yes, with a deliberately lower-privilege sync. The current token can read the
baseline account state, campaign hierarchy, ads, creatives, and ad-level
insights. It cannot read `funding_source_details`, which is why Adomata's
single all-fields account request fails and incorrectly records the whole
connection as lost.

There is no token scope, app setting, or Business-portfolio association that
turns this existing user token into an Ad Account `MANAGE` task. A system-user
token is a valid *agency-admin-operated* alternative, but it is a separate
credential that must be created in the owning Business and assigned the Ad
Account asset; it is not available using only the current token.

## What the app requests today

[`apps/api/src/meta/client.ts`](../../apps/api/src/meta/client.ts) asks for one
Ad Account response containing:

```text
id,name,currency,timezone_name,account_status,disable_reason,balance,
is_prepay_account,funding_source_details
```

The last two fields have special task requirements:

| Field | Meta's documented task requirement | Result with the current token |
| --- | --- | --- |
| `is_prepay_account` | `ADVERTISE` or `MANAGE` on the specific Ad Account | Read succeeds. |
| `funding_source_details` | `MANAGE` on the specific Ad Account | `(#10) Permission Denied`. |

Meta documents both restrictions in its [Ad Account reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account). As Graph rejects a request containing an inaccessible field, the combined request fails even though its other fields are readable.

## Live development verification

Using the configured development token on 2026-07-27, without logging or
copying the token or account data:

| Request | Result |
| --- | --- |
| Baseline account fields: `id`, `name`, `currency`, `timezone_name`, `account_status`, `disable_reason`, `balance` | HTTP 200 |
| `is_prepay_account` | HTTP 200 |
| `funding_source_details` | HTTP 400, Meta error `(#10) Permission Denied` |
| Current app field set for campaigns, ad sets, and ads | HTTP 200 for each |
| Current ad-level daily-insights field set | HTTP 200 |
| Current creative field set for a live ad | HTTP 200 |

This verifies that the token is usable for a reporting-only integration. It
does **not** grant access to funding-source metadata or billing administration.

## Viable options

### 1. Lower-privilege read-only sync — recommended now

Omit `funding_source_details` for this account/token and persist its value as
unknown (`null`). Keep the successful baseline fields, hierarchy, creatives,
and insights. In this concrete test token, retain `is_prepay_account` because
it is readable; the general implementation should also tolerate it being
unavailable and make it unknown rather than mark the connection lost.

Meta's [assigned-users reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/assigned_users)
defines `ANALYZE` as running reports and distinguishes it from `MANAGE`, which
includes billing and account permissions. This matches the boundary observed
above: reporting data remains useful while payment-source detail remains
unavailable.

The product must label the missing fields as unavailable/unknown; it must not
infer an invoice or funding type from spend, balance, or account status.

### 2. Agency-owned system user — viable only with agency participation

An administrator of the owning Business can create a system user, make the app
part of that Business where required, and assign that system user the Ad
Account with the necessary task. Meta's [System User reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user)
states that system-user creation belongs to a Business and reports error
`104001` when the app is not part of that Business. The [assigned-users
reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/assigned_users)
also lists both Business users and system users as asset assignees.

This could provide `MANAGE` and thus the protected field, but it requires an
agency admin to create/assign an asset and to supply a separate token. It is
not a workaround available from the present user token alone.

### 3. Business/partner app association — not a permission escalation

Associating Adomata's app with a Business is a prerequisite for the
system-user path in Meta's model; it does not grant a user token an Ad Account
task. The asset owner still controls assignment. Do not treat an app/business
association or extra `business_management` scope as a substitute for
`MANAGE`.

## Recommended implementation behaviour

1. Separate the baseline account read from protected optional fields, or retry
   a `(#10)` response once without the protected field(s).
2. Persist `isPrepayAccount` and `fundingSourceType` as nullable/unknown where
   a token lacks the respective task.
3. Continue hierarchy, creative, and insights refresh when the baseline read
   succeeds.
4. Reserve `connectionStatus = 'access_lost'` for an inaccessible account or
   invalid/revoked token, not a known optional-field restriction.

This is narrowly scoped to read-only reporting. It must not enable ad writes
or fabricate payment/funding state.

## Primary sources

1. [Meta Marketing API — Ad Account reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account) — field-specific task requirements, including `is_prepay_account` and `funding_source_details`.
2. [Meta Marketing API — Ad Account assigned users](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/ad-account/assigned_users) — Business/system-user assignment and the `ANALYZE`, `ADVERTISE`, and `MANAGE` task meanings.
3. [Meta Marketing API — System User reference](https://developers.facebook.com/documentation/ads-commerce/marketing-api/reference/system-user) — system users belong to a Business and require the app to be part of that Business for creation.
