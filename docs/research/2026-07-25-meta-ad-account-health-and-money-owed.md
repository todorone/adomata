# What Meta reports about an Ad Account's health and money owed

**Research date:** 2026-07-25  
**Question:** What can the Meta Marketing API actually show for the interview's
brief account view: account health, money owed, and deferred-payment status?

## Bottom line

The API has a real **amount-due** field (`balance`) and useful account-health
signals (`account_status`, `disable_reason`). It does **not** expose an invoice
ledger, a next payment date, a payment-failure event, a credit limit, or a
definitive `deferred_payment_terms` flag. `is_prepay_account` distinguishes
prepay from postpay; funding-source type can add evidence of extended credit or
invoicing, but neither one is an invoice or a statement of the contractual
terms. This means the owner's desired green/yellow/red mapping must be an
application policy, not a direct rendering of Meta's billing state.

The field inventory and types below come from Meta's generated Business SDK,
whose `AdAccount` object is generated from the Marketing API. The official
reference remains the authority for availability and access control.

## How to read it

Read the accessible account node, requesting only the needed fields:

```http
GET /v25.0/act_{ad-account-id}?fields=account_status,disable_reason,balance,amount_spent,spend_cap,currency,is_prepay_account,funding_source,funding_source_details,extended_credit_invoice_group,failed_delivery_checks
```

This is an Ad Account node read, not a Business-Manager billing API. Meta's
official Marketing API collection identifies the node as `act_{account_id}` and
documents the token/app prerequisites. [Meta Marketing API collection](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi?entity=request-31691153-3a5ad088-3918-4c1e-9d1d-1a7cf57bbdd9)

All example values in this note are **synthetic**, solely to make the response
shape concrete. Do not treat a sample number as a live value or evidence of a
currency scale.

## Access model

Every row requires a valid Marketing API access token and visibility of the
specific Ad Account. For an app acting on other people's accounts, Meta says
the relevant `ads_read` and/or `ads_management` permission requires Advanced
Access; the same collection distinguishes user and system-user tokens. The
table calls out the additional **Ad Account task** restriction only where
Meta's field documentation states one. [Meta Marketing API collection —
permissions](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi?entity=request-31691153-3a5ad088-3918-4c1e-9d1d-1a7cf57bbdd9)

`ads_read` is the least-privilege app permission for a read-only dashboard;
`ads_management` is needed only if the product will also change ads or account
configuration. The Meta SDK's setup instructions independently show that a
Marketing API app needs a token with the appropriate Marketing API permission.
[Meta Business SDK — access token](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/README.md#obtain-an-access-token)

| Field | API type and synthetic example | What it can establish | Permission / account task | Source |
| --- | --- | --- | --- | --- |
| `account_status` | unsigned integer; `1` | The account's high-level state. Meta defines: `1` `ACTIVE`; `2` `DISABLED`; `3` `UNSETTLED`; `7` `PENDING_RISK_REVIEW`; `8` `PENDING_SETTLEMENT`; `9` `IN_GRACE_PERIOD`; `100` `PENDING_CLOSURE`; `101` `CLOSED`; `201` `ANY_ACTIVE`; `202` `ANY_CLOSED`. A row should not equate `ACTIVE` with financially healthy. | Baseline read access; the reference does not state an extra field task. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [generated type](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py#L4644-L4653) |
| `disable_reason` | unsigned integer; `3` | Why Meta has disabled/restricted the account when a reason is supplied. Defined codes: `0` `NONE`; `1` `ADS_INTEGRITY_POLICY`; `2` `ADS_IP_REVIEW`; `3` `RISK_PAYMENT`; `4` `GRAY_ACCOUNT_SHUT_DOWN`; `5` `ADS_AFC_REVIEW`; `6` `BUSINESS_INTEGRITY_RAR`; `7` `PERMANENT_CLOSE`; `8` `UNUSED_RESELLER_ACCOUNT`; `9` `UNUSED_ACCOUNT`; `10` `UMBRELLA_AD_ACCOUNT`; `11` `BUSINESS_MANAGER_INTEGRITY_POLICY`; `12` `MISREPRESENTED_AD_ACCOUNT`; `13` `AOAB_DESHARE_LEGAL_ENTITY`; `14` `CTX_THREAD_REVIEW`; `15` `COMPROMISED_AD_ACCOUNT`. They are reason labels, not a payment ledger. | Baseline read access; no extra field task documented. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [generated type](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py#L4665-L4673) |
| `balance` | numeric string; `"12345"` | Meta describes this as the **bill amount due** for the Ad Account. This is the correct field for the requested "money owed" fact. Fetch `currency` with it. The reference does not document the denomination/scale for this field, so preserve it as a decimal string and verify its display conversion against a controlled account before shipping. | Baseline read access; no extra field task documented. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [generated type](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py#L4648-L4655) |
| `currency` | string; `"USD"` | The Ad Account currency. It supplies the currency context for `balance`, `amount_spent`, and `spend_cap`; it does not itself establish a monetary scale. | Baseline read access; no extra field task documented. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [generated type](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py#L4661-L4667) |
| `amount_spent` | numeric string; `"250000"` | Spend relative to `spend_cap`, or total spend when there is no cap. It is **not** an amount currently owed and must not drive the debt indicator. | Baseline read access; no extra field task documented. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [generated type](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py#L4648-L4653) |
| `spend_cap` | numeric string; `"500000"`; `"0"` means no cap | The account-level delivery ceiling, not a credit limit or remaining balance. Meta documents read values in basic currency units (for example, USD cents), and says that only spend after the cap was set counts toward it. The write parameter uses the standard denomination, so do not reuse a read value unchanged in an update. | Baseline read access; no extra field task documented. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [generated type](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py#L4703-L4711) |
| `is_prepay_account` | boolean; `false` | The direct prepay/postpay signal: `true` is prepay and `false` is postpay. It is the best available first filter for the owner's yellow state, but `false` alone does not document the account's exact contractual deferred-payment terms. | **`ADVERTISE` or `MANAGE` task on this Ad Account** in addition to baseline access. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [generated type](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py#L4685-L4692) |
| `funding_source` | string ID; `"987654321"` | A payment-method identifier. It can be absent for disabled accounts. It is not a payment status, bill, or due date. | Baseline read access; no extra field task documented. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [generated type](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py#L4673-L4679) |
| `funding_source_details` | `FundingSourceDetails`; `{ "id": "987654321", "type": 4, "display_string": "…" }` | Funding-source metadata. Its generated object has `id`, `type`, `display_string`, `coupon`, and `coupons`. Meta's type includes `4` `FACEBOOK_EXTENDED_CREDIT`, `6` `INVOICE`, and `20` `STORED_BALANCE`, among other payment types. Types `4`/`6` are supporting evidence of a credit/invoice arrangement—not evidence of an amount due or a due date. | **`MANAGE` task on this Ad Account** in addition to baseline access. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [FundingSourceDetails generated object](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/fundingsourcedetails.py) |
| `extended_credit_invoice_group` | `ExtendedCreditInvoiceGroup`; object/relation | The invoice group to which the Ad Account belongs. Its object provides group metadata, billing addresses, email(s), name, and member accounts—not individual invoices or settlement state. | Baseline read access; no extra field task documented. Any linked-object read may still fail if the token lacks access to that object. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [Extended Credit Invoice Group reference](https://developers.facebook.com/docs/marketing-api/reference/extended-credit-invoice-group/) |
| `failed_delivery_checks` | list of `DeliveryCheck`; `[]` | Machine-readable delivery checks (`check_name`, `description`, `summary`, optional `extra_info`). It can support a generic operational warning, but it is not documented as a billing/payment-failure feed. | Baseline read access; no extra field task documented. | [Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) · [DeliveryCheck generated object](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/deliverycheck.py) |

## What is not obtainable from this documented surface

The Ad Account field/edge inventory contains the closest signals above but no
documented resource or field for the following. Treat each as unavailable until
Meta documents an additional endpoint and access model—not as a null that can
be reconstructed from `amount_spent` or `spend_cap`.

- A next-bill date, payment threshold, or invoice due date.
- An unsettled-invoice list, invoice amount, or invoice settlement/payment
  state.
- A payment-failure event or a reliable "payment method declined" boolean.
- Credit limit, remaining credit, or repayment terms.
- An explicit `deferred_payment_terms` / net-terms flag.
- A financial definition of "healthy." `account_status=ACTIVE` can coexist
  with a positive `balance`; it only reports the account's lifecycle state.
- A guarantee that every readable account exposes funding-source fields; Meta
  documents account-task restrictions for `is_prepay_account` and
  `funding_source_details`, and `funding_source` can be unavailable when the
  account is disabled.

The absence conclusion is deliberately limited to the documented Ad Account
surface examined here. It does not claim that a Meta Ads Manager screen, a
support workflow, or a future privileged/partner API cannot show such data.

## Consequences for the brief traffic light

| Desired meaning | Evidence available now | Safe product treatment |
| --- | --- | --- |
| Green: active account | `account_status=ACTIVE`, plus no adverse available signals | Label as **active**, not as financially settled. Do not show green as a debt guarantee when `balance > 0`. |
| Yellow: deferred payment terms | `is_prepay_account=false`; stronger supporting hint where readable: `funding_source_details.type` is `FACEBOOK_EXTENDED_CREDIT` or `INVOICE` | Call this **postpay/credit signal** unless business validation establishes a stronger contractual mapping. Never present it as a due-date or credit-limit state. |
| Red: blocked or money owed | Non-active/risk status; `disable_reason`; positive `balance` (after integration validation) | Show the raw Meta state/reason and the amount due separately. `RISK_PAYMENT`, `UNSETTLED`, `PENDING_SETTLEMENT`, and `IN_GRACE_PERIOD` are operationally meaningful warnings, but are not substitutes for invoice data. |

Campaigns-running is intentionally out of scope: it requires campaign/ad-set
status research rather than an Ad Account billing field.

## Primary sources consulted

1. [Meta Marketing API — Ad Account reference](https://developers.facebook.com/docs/marketing-api/reference/ad-account/) — authoritative fields, enums, field-specific access tasks, and descriptions.
2. [Meta Marketing API — Extended Credit Invoice Group reference](https://developers.facebook.com/docs/marketing-api/reference/extended-credit-invoice-group/) — scope of invoice-group data.
3. [Meta's public Marketing API Postman collection](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi?entity=request-31691153-3a5ad088-3918-4c1e-9d1d-1a7cf57bbdd9) — official node request and app/token permission model.
4. [Meta's generated Python Business SDK: `AdAccount`](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/adaccount.py) and [`FundingSourceDetails`](https://github.com/facebook/facebook-python-business-sdk/blob/542e10e31c40f7925f9ac03c000922a2fd0a2365/facebook_business/adobjects/fundingsourcedetails.py) — current field and nested-object types.
