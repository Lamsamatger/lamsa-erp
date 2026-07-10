---
name: Production Module
description: Architecture decisions and validation patterns for the /production module
---

## New DB arrays
`db.production_errors` and `db.qc_records` are NOT in the original db.json seed.
All routes that touch them must initialize with `db.X = db.X || []` before use.

## Validation pattern (must replicate on any new POST route)
- Order status changes: validate against `ORDER_STATUSES` allowlist before saving.
- Item stage changes: validate against `ITEM_STAGES` allowlist before saving.
- Same guard on both `/orders/:id/status` and `/production/order/:id/*` routes.

## Redirect flow
`/orders/:id/status` now supports a `redirect` body param (relative path only, guarded by `/^\/[^/\\]/`).
The production order tab views POST here with `redirect=/production/order/:id?tab=stages`.
**Why:** order detail page is reused by both /orders and /production — single source of truth for status updates.

## QC auto-advance rule
If `rejected_qty === 0` → advance order to `جاهز للتغليف` (regardless of accepted count).
If `rejected_qty > 0` → set to `مراجعة`.

## Tab routing
Order detail tabs use URL query param `?tab=<stages|workshop|embroidery|quality|errors|log>`.
The route passes `tab: req.query.tab || 'stages'` to the template.
Forms redirect back with the correct `?tab=` suffix so the user stays on the right tab after a POST.

## PERMISSIONS
`production: ['admin', 'production', 'receiving']` — intentionally excludes packaging and accountant.
