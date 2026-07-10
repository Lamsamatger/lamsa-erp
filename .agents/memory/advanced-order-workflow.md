---
name: Advanced Order Workflow
description: Order-type classification, prep tabs/actions, print card privacy, scanner stock routing, dashboard KPI row 3.
---

# Advanced Order Workflow

## Key decisions

**classifyOrder**: Defined in server.js (not lib/). Returns 'مخزون' if every item has matching inventory qty; 'إنتاج' otherwise. Defaults to 'إنتاج' if inventory_items is empty. Salla webhook orders are NOT classified at creation (known gap, task #8).

**lazy migration**: lib/db.js load() backfills `order_type = 'إنتاج'` for orders missing the field and writes back to disk.

**Stock order stage skipping**: STOCK_ITEM_STAGES = ['تجهيز','جاهز للتغليف','تم التنفيذ']. Computed in GET /scanner/item/:barcode and passed as ITEM_STAGES to scanner/item.ejs. The hardcoded ITEM_STAGES var in the EJS template was removed.

**Embroidery auto-queue**: POST /orders/:id/status and POST /scanner/order/:orderId/status both auto-create an embroidery_jobs entry with embroiderer_id=null and auto_queued=true when status becomes 'عند المطرز'. Does NOT duplicate if auto_queued entry already exists.

**Print card privacy**: stripCustomerFields() helper in server.js removes customer_name, customer_phone, city, payment_method, payment_status before passing to prep/print_cards.ejs.

**Prep tab filters**: GET /prep accepts ?tab= param: all|new|production|stock|printing|packaging. Printing = statuses جديد/مراجعة/تجهيز; packaging = جاهز للتغليف.

**Dashboard KPI row 3**: 8 new values added to GET / handler and dashboard.ejs: newOrdersCount, productionOrdersCount, stockOrdersCount, atWorkshopCount, embroideryPendingCount, readyForPackagingCount, readyForShippingCount, delayedOrdersCount.

**Status history timeline**: GET /orders/:id now fetches activity_logs for the order and passes statusHistory to orders/detail.ejs. Collapsible Bootstrap collapse panel.

**Why:**
- ORDER_TYPES constant in lib/constants.js for future reuse.
- classifyOrder in server.js to keep db.js free of business logic.
- Stock-order route skipping avoids sending stock items through workshop/embroidery queue unnecessarily.
