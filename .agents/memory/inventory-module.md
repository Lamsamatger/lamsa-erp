---
name: Inventory Module
description: Architecture decisions and patterns for the /inventory module
---

## New DB arrays
`db.inventory_items` and `db.inventory_movements` are NOT in the original seed.
All routes call `initInv(db)` which does `db.X = db.X || []` before touching either array.

## Constants (defined in server.js, not constants.js)
```javascript
const ITEM_CATEGORIES  = ['قماش', 'إكسسوار', 'منتج جاهز', 'أخرى'];
const INVENTORY_UNITS  = ['متر', 'قطعة', 'كيلو', 'رول', 'كرتون', 'دزينة', 'لتر', 'طقم'];
const MOVEMENT_TYPES   = ['استلام', 'صرف', 'إرجاع', 'تسوية', 'جرد'];
```

## Validation pattern
- `category` must be in `ITEM_CATEGORIES` on create/edit
- `unit` must be in `INVENTORY_UNITS` on create/edit
- `mov_type` on adjust must be in `['تسوية','جرد']`
- issue: qty > 0 AND qty <= item.qty (prevents negative stock)
- delete: admin-only (`req.session.user.role === 'admin'`)

## Floating-point rounding
All qty mutations use `Math.round(result * 1000) / 1000` to avoid float drift.

## Movement record schema (required fields)
`id, item_id, item_name, type, qty (signed), qty_before, qty_after, reference, order_id, order_number, notes, performed_by, at`
- صرف movements have **negative** qty
- استلام/إرجاع movements have **positive** qty
- تسوية/جرد store the delta (positive or negative)

## Tab routing
Item detail uses `?tab=log|receive|issue|return|adjust|edit`. Default is `log`.
`success` and `error` are passed as query params (URL-encoded Arabic). This is safe — direct GET tests with `%D8%AA...` return 200.

## PERMISSIONS
`inventory: ['admin', 'production', 'receiving']`
Packaging employees do NOT have inventory access (by design).

## Seed data
8 sample items were added directly to db.json (ids inv_001..inv_008).
3 are in alert state: inv_002 (low stock), inv_003 (out of stock), inv_006 (low stock).
12 seed movements cover receive/issue/return scenarios linked to order LMS-1007, LMS-1008, LMS-1009.
