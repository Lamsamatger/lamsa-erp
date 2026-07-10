---
name: Dashboard Module
description: Main ERP dashboard at GET / — data shape, Chart.js, workshop statuses, settings cache
---

## Data passed to views/dashboard.ejs
KPIs: totalOrders, newOrders, inProduction, lateCount, readyToShip, completedOrders, progressPct, doneToday, doneThisMonth
Stage: counts (per ORDER_STATUS), stageFunnel (6 bucket groups with count/pct/color/link)
Detail: late (with days_late), lowInventory (qty <= low_stock_threshold), recentOrders (last 10, with progress/late/totalQty)
Perf: wsPerf (per workshop: activeJobs/waitingJobs/doneJobs/total), embPerf (totalDone/totalErrors/doneRate/errorRate)
Charts: chartDaily / chartWeekly / chartMonthly — JSON strings injected as `<%- varName %>` (unescaped)

## Workshop job statuses
Three values only: `'قيد الانتظار'` | `'عند المشغل'` | `'مستلم'`
- activeJobs = status === 'عند المشغل'
- waitingJobs = status === 'قيد الانتظار'
- doneJobs = status === 'مستلم'
Never use "not active" as a proxy for done — that incorrectly counts waiting jobs.

## Settings cache pattern
`getCachedSecuritySettings()` caches db.meta.settings.security with 30s TTL.
Must call `invalidateSettingsCache()` after POST /settings/system saves security section.
This avoids a full synchronous DB load on every HTTP request just for hideCustomer.

## Chart.js integration
Version 4.4.0 UMD from CDN (loaded only in dashboard.ejs, not in head.ejs).
`Chart.defaults.font.family` set to Tajawal; `rtl: true` on legend.
Three datasets: dailyData (14 days), weeklyData (8 weeks), monthlyData (12 months).
Each entry has `{label, count, done}` — `done` used only for daily/weekly datasets.

## STATUS_PROGRESS mapping (for order progress %)
جديد:5, مراجعة:15, تجهيز:25, عند المشغل:40, مستلم من المشغل:52,
عند المطرز:63, جاهز للتغليف:72, في التغليف:82, تم التغليف:90,
تم الشحن:96, تم التنفيذ:100, ملغي:0

## Inventory alert field name
`low_stock_threshold` (not `min_quantity`) — triggers alert when qty <= low_stock_threshold.

## Auto-refresh
`setTimeout(() => location.reload(), 5 * 60 * 1000)` — refreshes every 5 minutes.
