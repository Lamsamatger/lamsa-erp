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

## Post-merge setup
- Script: `scripts/post-merge.sh` — runs `npm install --prefer-offline`
- Configured via setPostMergeConfig with 60s timeout
