---
name: Reports Module
description: Architecture and KPI calculation logic for the /reports page
---

## Page structure
5 tabs: overview / production / packaging / inventory / activity
Period selector: 7 / 30 / 90 / 365 / الكل (3650) days

## Period filter pattern
`const cutoff = new Date(Date.now() - period * 24*60*60*1000).toISOString()`
- KPI 1 (production efficiency): orders created >= cutoff
- KPI 2 (on-time rate): completed orders from cutoff window
- KPI 3 (delay rate): ALL currently active — period has no meaning here
- KPI 4 (error rate): embroidery_jobs linked to period orders (via periodOrderIds Set)
- Workshop/embroidery stats: period-scoped jobs, falls back to all-time if empty
- Packages: created_at >= cutoff; falls back to all-time
- Shipments: created_at >= cutoff; falls back to all-time
- Inventory movements: at >= cutoff; falls back to all-time
- Activity log: at >= cutoff (last 50)
- Scan logs: at >= cutoff

**Why fallback to all-time:** small datasets would show 0% everywhere on narrow periods; "period dataset non-empty → use it, else all-time" gives useful numbers at all times.

## KPI formulas
- productionEfficiency = periodCompleted / (periodOrders - periodCancelled) * 100
- onTimeRate = periodCompleted within DELAY_DAYS_THRESHOLD days / periodCompleted * 100
- delayRate = lateOrders (isLate) / activeOrders * 100  (all-time snapshot)
- errorRate = sum(errors) / sum(received_qty) for embroidery * 100
- wsEfficiency = wsReceived / wsDelivered * 100

## || [] guard pattern
All db.X arrays accessed via allOrders / allWorkshops / allEmbroiderers / allUsers locals set at top of route. Never access db.X directly inside loops.

## Template issues to avoid
- Never use `<%= expr ? '<tag>' : '<tag>' %>` for HTML — EJS escapes it. Use `<% if () { %><tag><% } else { %><tag><% } %>` instead.
- EJS ternary inside HTML class attributes works fine: `class="<%=cond?'a':'b'%>"`
