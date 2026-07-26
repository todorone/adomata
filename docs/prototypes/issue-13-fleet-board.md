# Prototype #13 — Fleet board

Question: how should configurable hierarchy depth, per-row expansion, metric toggles, and traffic-light account health behave when an agency scans roughly 50 accounts?

Run the client and open:

`http://localhost:5173/prototype/fleet-board?variant=A`

Use the floating switcher or `?variant=A|B|C`. The data and interaction state are intentionally in memory.

## Variants tried

- **A — Дерево**: one comparison-first tree table. The global depth dial reveals every account down to the chosen level; clicking an individual row reveals deeper children without losing the board context. Parent rows keep their own aggregate metrics. Search and “Лише увага” filter the account roots.
- **B — Пульт**: a split control room. The left rail keeps all accounts visible and sortable, while the right pane drills into one selected account. This makes deep inspection calmer but moves comparison into a narrow list.
- **C — Сигнали**: a traffic-light operations board. Accounts are grouped into red/yellow/green lanes, and cards expand inline. This makes the morning triage path obvious but gives up exact column alignment across hierarchy levels.

## Current readout

No owner verdict has been captured yet. The prototype is intended for reaction. The strongest candidate for the core model is **A**, because it directly tests the owner’s “all accounts at once” requirement while making the interaction rule concrete: global depth controls breadth; row expansion controls local depth. B is the fallback for a detail workflow, and C is a useful attention-focused view that may be better as a saved preset or secondary mode.

## To resolve after review

- Whether the board should default to brief account rows or campaign rows.
- Which two or three metrics deserve permanent chips, with the rest hidden behind an add-more action.
- Whether account health should use the dot treatment (A/B) or lane/card treatment (C).
- Whether sorting should remain root-account-only, as shown here, or be scoped to each selected account.

