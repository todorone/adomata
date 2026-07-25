# Adomata

A SaaS platform for agencies to run media buying, social media management, and automation on behalf of their clients.

Current prototype scope is narrower: media-buying KPI monitoring and budget notifications for an agency director, on Meta only. SMM and rule-based automation are future phases, not yet modeled.

## Language

### Tenancy

**Agency**:
The paying organization on Adomata. Manages one or more Clients.
_Avoid_: Organization, Workspace, Tenant
_Vendor exception_: Better Auth's `organization` plugin (tables, session fields, client hooks) keeps its vendor-given name internally. The leak stops at that boundary — all Adomata-authored code, routes, and UI say Agency.

**Client**:
An end-brand that an Agency manages. The boundary that campaigns, posts, and budgets are scoped to. Flat under Agency — no nesting of Clients within Clients. May have one or more Ad Accounts.
_Avoid_: Brand, Customer, Account

**Ad Account**:
A Meta Ads Manager account the Agency has been granted access to, scoped to a Client. A Client can have more than one — KPIs are monitored both per Ad Account and rolled up per Client. Carries a connection status (connected / access lost) so a broken Meta connection isn't mistaken for a quiet account with no spend.
_Avoid_: Ads cabinet, Cabinet, Account

**User**:
A person who logs into an Agency. Currently sees all of that Agency's Clients and Ad Accounts — no per-Client visibility scoping. The primary persona today is the agency director, monitoring KPIs across every Client.
_Avoid_: Member, Account
_Vendor exception_: Better Auth's `member` table (the User↔Agency join row with a role) keeps its vendor-given name internally, same boundary rule as Agency/Organization above.

### KPIs

**KPI**:
One of the fixed metrics Adomata tracks per Ad Account and rolls up per Client: Spend, Impressions, Clicks, CTR, CPA, ROAS.
_Avoid_: Metric

**CPA** (Cost per Action):
Spend divided by the number of results Meta attributes to an ad (e.g. leads, purchases). "Action," not "acquisition" — a result isn't always a completed sale.
_Avoid_: Cost per acquisition, CPL

**ROAS** (Return on Ad Spend):
Revenue attributed to an Ad Account divided by its Spend, sourced from Meta's conversion tracking (Pixel/Conversions API). Nullable — a Client without conversion tracking configured has no ROAS; that's an expected state, not an error.
_Avoid_: —

### Monitoring & Alerts

**Budget**:
An Agency-defined spend cap set on a Client for a calendar month, covering total spend across all of that Client's Ad Accounts combined. Resets each month. Tracked by Adomata independently of Meta's own campaign/ad-set budgets.
_Avoid_: Spend cap, Allocation, Limit

**Budget Exhausted**:
The system event that fires when a Client's actual spend across its Ad Accounts reaches its Budget for the current month. Resets with the Budget each month cycle. The only event type in the prototype.
_Avoid_: Alert, Overspend

**Notification**:
An email delivered to an Agency's Users when a system event (currently only Budget Exhausted) occurs.
_Avoid_: Alert
