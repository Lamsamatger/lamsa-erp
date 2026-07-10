---
name: Advanced Order Workflow
description: Order-type classification, prep tabs/actions, print card privacy, scanner stock routing, dashboard KPI row 3.
---

## Key additions (Task #5)
- `ORDER_TYPES` constant: `'إنتاج'` | `'مخزون'`
- `classifyOrder(orderItems, inventoryItems)` helper at top of server.js — returns type on order creation
- `order_type` field on every new order; existing orders default to `'إنتاج'` via fallback (`o.order_type || 'إنتاج'`)
- Prep list tabs: all / new / production / stock / printing / packaging (query param `tab=`)
- Print prep card strips customer fields server-side (not just CSS)
- Scanner (`/scanner/item/:barcode`) shows no customer fields; "Next Stage" skips workshop/embroidery for stock orders
- Auto-queue embroidery job on `عند المطرز` status; auto-queue packaging on `جاهز للتغليف`
- Dashboard KPI row 3: 8 new cards (newOrdersCount, productionOrdersCount, stockOrdersCount, atWorkshopCount, embroideryPendingCount, readyForPackagingCount, readyForShippingCount, delayedOrdersCount)

## Post-merge fixes (critical)
- **classifyOrder** — product_id-only matching; variant priority: product_id+size+color → product_id+size → product_id. Name-contains fallback removed (caused false stock matches).
- **Embroidery duplicate check** unified to `j.auto_queued && !j.embroiderer_id` across both status-change routes (was inconsistent).
- **Scanner embroiderer assignment** (`POST /scanner/order/:orderId/embroiderer`) updates existing auto-queued job when present; only inserts new job if none exists.

## Universal Prep Card + Scanner (latest session)
- QR code encodes full scanner URL: `APP_BASE_URL || (req.protocol + '://' + req.hostname)` + `/scanner/item/{barcode}` — use `APP_BASE_URL` env var in production
- `baseUrl` passed to `print_cards.ejs` from both POST /prep/print and GET /prep/print-all
- `totalPieces` per order computed as `Math.max(0, Number(i.qty) || 0)` sum — passed on order object
- Cards show: order_type badge (type-prod/type-stock), pc-stage-strip with current stage, SKU, total pieces row, QR (full URL), embroidery+notes, checklist
- Scanner stage-specific action: `STATUS_ACTION` map keyed by `order.status` → { label, sub, color, next }. Guarded by `if (stageAction...)` for unlisted statuses (تم التنفيذ, ملغي)
- `POST /scanner/order/:orderId/notes` — note capped at 500 chars, logged to activity log
- QC panel: pass → جاهز للتغليف, fail → مراجعة
- History log uses `ROLES[l.user_role]` for Arabic role names

## Post-merge setup
- Script: `scripts/post-merge.sh` — runs `npm install --prefer-offline`
- Configured via setPostMergeConfig with 60s timeout
