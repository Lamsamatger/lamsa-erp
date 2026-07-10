---
name: Settings & Permissions Module
description: Architecture for the /settings routes — users, roles, activity log, system settings
---

## Routes
- GET/POST /settings/* — all require `requireSection('settings')` (admin only)
- GET/POST /settings/users/* — require `requireSection('users')` (admin only)
- GET /settings/activity — checked inline against ['admin','production_mgr']
- Backward compat: GET/POST /users/* redirect to /settings/users/*

## Route ordering
`/settings/users/new` MUST be declared before `/settings/users/:id` — already correct.

## Roles (12 total)
admin, production_mgr, prep, workshop_worker, embroidery_worker, quality,
packaging, shipping_emp, inventory_emp, accountant + compat: production, receiving

## ROLE_PERMISSIONS
Exported from lib/constants.js. Each role has: view, add, edit, delete,
changeStatus, reports, manageInventory, manageUsers, hideCustomer (boolean flags).
Also exported: HIDE_CUSTOMER_ROLES (Set of role IDs where hideCustomer=true).

## hideCustomer logic (res.locals)
Combined: role must have hideCustomer=true AND db.meta.settings.security.hideCustomerFromProduction must be true (default=true).
Reads db on every request — safe because flat-file load is cheap.

## Security patterns
- Login checks user.active !== false; disabled users get Arabic error
- Login is now logged to activity_log (action: 'تسجيل دخول', module: 'auth', type: 'security')
- Self-account delete/disable blocked in toggle and delete routes
- Only admin role can delete users (checked in both /settings/users/:id/delete and legacy /users/:id/delete)

## System settings
Stored in db.meta.settings (initialized by initSettings() function in server.js).
Sections: company, security, barcode, printing, language, notifications, backup
Boolean checkboxes: absent from POST body = false (handled in server.js POST /settings/system).

## initSettings() pattern
```javascript
function initSettings(db) {
  if (!db.meta.settings) db.meta.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  Object.keys(DEFAULT_SETTINGS).forEach(k => {
    if (!db.meta.settings[k]) db.meta.settings[k] = { ...DEFAULT_SETTINGS[k] };
  });
  return db.meta.settings;
}
```
DEFAULT_SETTINGS imported from lib/db.js.

## Activity log enhancements
log() now accepts 5th param: `{ module, type, before, after }`.
type values: 'create', 'update', 'delete', 'security', 'status_change', 'export'.
Old log calls (4 args) still work — extra fields become null.
Log cap: 1000 entries (was 500).

## EJS safety rules (learned)
- NEVER use `'selected':'%>'` in EJS ternary — the %> closes the tag. Use `? 'selected' : ''` instead.
- NEVER embed `<%= %>` inside a JS string literal inside a `<% %>` block — the %> closes the outer block.
