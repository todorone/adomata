# Account Health is Health Color + Health Reason, not color alone

[Issue #11](https://github.com/todorone/adomata/issues/11) needed a deterministic rule mapping Meta's
`account_status`/`disable_reason`/billing signals to the board's traffic light. Several of Meta's raw
signals are permanent properties of an account rather than transient problems — postpay billing
(`is_prepay_account=false`) is the clearest case, and Meta documents no credit-limit or
"approaching limit" field that could turn it into a transient one. Cramming that nuance into color alone
would force a choice between a meaningless color (every healthy postpay agency's whole board pinned to
one hue, forever) or an ever-growing color set, one per nuance.

Decided: every Ad Account always shows **Health Color** (a small closed set) _and_ **Health Reason** (an
always-visible short text). Color answers "what kind of state is this?"; reason answers "why?". Red needs
attention, while yellow is a neutral postpay fact. This lets color stay coarse and stable while reason
carries the specifics, including properties that are permanent rather than problems. Operational Needs
Attention additionally includes a lost Meta connection, whose Account Health is grey/unknown.

See [CONTEXT.md — Health Color / Health Reason](../../CONTEXT.md#tenancy) for the term definitions.

## The mapping

Evaluated top to bottom; first match wins. Inputs are the Ad Account's `connectionStatus` (Adomata's
own) and, from Meta's Account Tier poll, `account_status`, `disable_reason`, and `is_prepay_account`.

| #   | Condition                                                           | Color      | Reason                                                                                                                                                                                                                                                                    |
| --- | ------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `connectionStatus = pending` (no successful poll yet)               | **grey**   | "Awaiting first sync"                                                                                                                                                                                                                                                     |
| 2   | `connectionStatus = access_lost`                                    | **grey**   | "Meta connection lost"                                                                                                                                                                                                                                                    |
| 3   | `account_status ≠ ACTIVE`, `disable_reason` present                 | **red**    | The specific `disable_reason` label, e.g. "Disabled — payment risk" (`RISK_PAYMENT`), "Disabled — integrity policy" (`ADS_INTEGRITY_POLICY`), "Disabled — permanently closed" (`PERMANENT_CLOSE`)                                                                         |
| 4   | `account_status ≠ ACTIVE`, no `disable_reason` (`NONE`/absent)      | **red**    | The `account_status` label, e.g. "Unsettled balance" (`UNSETTLED`), "Pending risk review" (`PENDING_RISK_REVIEW`), "Pending settlement" (`PENDING_SETTLEMENT`), "In grace period" (`IN_GRACE_PERIOD`), "Pending closure" (`PENDING_CLOSURE`), "Account closed" (`CLOSED`) |
| 5   | `account_status = ACTIVE`, `is_prepay_account = false`              | **yellow** | "Postpay account — billed after spend"                                                                                                                                                                                                                                    |
| 6   | `account_status = ACTIVE`, `is_prepay_account = true` or unreadable | **green**  | "Active"                                                                                                                                                                                                                                                                  |

Notes on the inputs:

- `ANY_ACTIVE`/`ANY_CLOSED` are Meta query filter values, never returned as an actual account's
  `account_status` — not part of this table.
- `CLOSED`/`PENDING_CLOSURE` are shown red (row 4), not filtered off the board. Adomata can't tell an
  advertiser-initiated wind-down from a Meta-initiated one from this field alone, and silently dropping
  the row risks a director never noticing a client relationship ended without their say-so. Whether to
  eventually stop _syncing_ a closed account is a separate, later decision.
- `balance` (amount owed) never drives color — a postpay account normally carries a balance mid-cycle,
  so `balance > 0` alone doesn't mean trouble. It's always displayed as its own informational field,
  regardless of color, per the owner's brief-view request.
- Campaigns running/not running is its own column, untouched by Health Color — `CONTEXT.md`'s Account
  Tier definition already lists it as a signal distinct from Account Health.

## Rejected alternatives

- **Yellow requiring "balance approaching a credit limit."** The research
  ([docs/research/2026-07-25-meta-ad-account-health-and-money-owed.md](../research/2026-07-25-meta-ad-account-health-and-money-owed.md))
  found no credit-limit, next-bill-date, or "approaching limit" field anywhere in Meta's documented
  surface — this reading was unimplementable, not just undesirable.
- **`balance > 0` as a red trigger.** Rejected because it would flag every normal mid-cycle postpay
  account as broken.
- **Filtering `CLOSED`/`PENDING_CLOSURE` off the board.** Rejected — see notes above.
