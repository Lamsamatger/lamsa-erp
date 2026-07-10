---
name: Production & Packaging Module
description: Architecture decisions and validation patterns for /production and /packaging modules
---

## New DB arrays
`db.production_errors`, `db.qc_records`, `db.packages`, `db.shipments` are NOT in the original db.json seed.
All routes that touch them must initialize with `db.X = db.X || []` before use.

## Validation pattern (must replicate on any new POST route)
- Order status changes: validate against `ORDER_STATUSES` allowlist before saving.
- Item stage changes: validate against `ITEM_STAGES` allowlist before saving.
- Shipment status changes: validate against `SHIPPING_STATUSES` allowlist before saving.

## Redirect flow
`/orders/:id/status` supports a `redirect` body param (relative path only, guarded by `/^\/[^/\\]/`).
Production order tabs POST here with `redirect=/production/order/:id?tab=stages`.

## QC auto-advance rule
If `rejected_qty === 0` → advance order to `جاهز للتغليف`. If `rejected_qty > 0` → set to `مراجعة`.

## ORDER_STATUSES (12 total, in order)
جديد → مراجعة → تجهيز → عند المشغل → مستلم من المشغل → عند المطرز → جاهز للتغليف → في التغليف → تم التغليف → تم الشحن → تم التنفيذ → ملغي

## Packaging status flow
جاهز للتغليف → (start) → في التغليف → (complete) → تم التغليف → (create shipment with تم الشحن) → تم الشحن → (deliver) → تم التنفيذ

## isLate() exclusions
Excludes: جاهز للتغليف, في التغليف, تم التغليف, تم الشحن, تم التنفيذ, ملغي
**Why:** All post-QC statuses are downstream of the production delay window.

## PERMISSIONS
- `production: ['admin', 'production', 'receiving']`
- `packaging: ['admin', 'packaging', 'receiving']`

## Scanner integration for packaging
`/packaging/scan` → sample chips use `/packaging/scan/item/:barcode` → resolves to `/packaging/order/:id`
Do NOT link sample chips directly to `/packaging/order/:id` — must go through barcode resolution path.

## CSS
`.bg-teal { background-color: #0d9488 !important; }` added to `public/css/style.css` for STATUS_COLORS['تم التغليف'].
