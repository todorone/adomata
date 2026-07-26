# Fleet Board rollup: zero-denominator is blank, health is worst-child-color plus a count, running is any-child

[ADR 0010](0010-insights-stored-at-ad-grain-only.md) already establishes that every tree level above Ad —
Ad Set, Campaign, Ad Account, and Client — is a SQL sum over child Ad rows, with CTR/CPA/ROAS re-derived
from the summed components rather than summed or averaged directly. [Issue #15](https://github.com/todorone/adomata/issues/15)
asked what a parent row shows in the cases that formula alone doesn't settle: a zero denominator, partial
ROAS tracking among children, and how Account Health and running-status — which aren't SQL sums at all —
roll up. Currency is out of scope here; [ADR 0012](0012-client-rollup-assumes-single-currency.md) already
settled it.

## Zero-denominator derived metrics

CTR, CPA, and ROAS show a blank (em dash), never `0` or `0%`, whenever their denominator is zero (0
impressions, 0 attributed actions, 0 spend) — at every tree level, not just Client. A zero-denominator
ratio is undefined, not zero; showing `0%` would read as "this performed at zero," which isn't what
happened. This gives ROAS one uniform blank rule instead of two (its existing "no conversion tracking"
nullability, plus a separate zero-spend case).

## Partial ROAS tracking

A Client's ROAS sums `action_values` and `spend` across *all* of its child Ad Accounts, including ones
with no conversion tracking configured — an untracked account contributes `$0` to the numerator but its
spend still counts toward the denominator. This was chosen over blanking the Client's ROAS entirely, or
computing it only over tracked accounts with a coverage badge: both of those require the UI to explain a
partial-coverage caveat, and the sum-everything result stays consistent with the "always a SQL sum" rule
the rest of the rollup follows, at the cost of understating ROAS for a Client with a mix of tracked and
untracked accounts. Recorded as a trade-off to revisit if agencies with real mixed-tracking Clients report
this as misleading.

## Health rollup

Health Color and Health Reason ([ADR 0018](0018-account-health-is-color-plus-reason-not-color-alone.md))
are Meta-reported per Ad Account, not a SQL sum — a Client's Health Color is the worst color among its
child Ad Accounts, by strict severity order:

| Severity | Color | Wins when |
| --- | --- | --- |
| 1 (worst) | **red** | any child is red |
| 2 | **yellow** | no red child, any child is yellow |
| 3 | **green** | no red or yellow child, at least one child is green |
| 4 (best case for "no data") | **grey** | *every* child is grey — grey never outranks a real signal |

A single grey child sitting among green siblings does not grey out the Client — an account Adomata can't
currently read (pending or access-lost) is not evidence the Client needs attention, and the two
common-case boards (all-green, and all-grey because nothing's connected yet) both need to read
unambiguously.

The Client's Health Reason is a count — "1 of 3 need attention" — of children whose color is neither green
nor grey, not the worst child's Reason text copied up. A single child's disable_reason ("Disabled — payment
risk") would misrepresent siblings with a different problem if three accounts are flagged for three
different reasons; the count answers "how many need me" without claiming to explain all of them at once.

## Running rollup

A parent row (Ad Set, Campaign, Ad Account, or Client) shows as running if *any* child is running,
recursively up the tree — the same any-child-wins shape as the health color rollup, not a stricter
all-children-running rule. A director scanning for "is anything live under this Client" wants to know
about partial activity, not just full activity.

## Collapse and filtering

Collapsing a parent row never changes its numbers — expand state is purely a rendering toggle, and the
rollup is computed the same way regardless. Filtering does change the numbers: a parent's rollup sums only
its currently filtered-in children. What's on screen is what's summed; a Client total under a "spend > $0"
filter reflects only the accounts matching that filter, not the Client's true unfiltered total.
