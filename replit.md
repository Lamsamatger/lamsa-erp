# لمسة أزيائي — نظام الإنتاج (Lamsa Fashion ERP)

A Node.js + Express + EJS production ERP for the Lamsa fashion store. Manages garment orders from receipt through production, embroidery, packaging, and shipping.

## How to run

```
node server.js
```

The server starts on port 3000. Default test accounts:

| Role | Username | Password |
|------|----------|----------|
| Admin | admin | admin123 |
| Production | production | prod123 |
| Receiving | receiving | recv123 |
| Packaging | packaging | pack123 |
| Accountant | accountant | acc123 |

**Change these passwords on first real use** via the Users page.

## Project structure

```
server.js          — Express app and all routes
lib/
  db.js            — JSON file database (data/db.json)
  constants.js     — Order statuses, roles, permissions
views/
  partials/        — head.ejs, foot.ejs (shared layout)
  orders/          — list, detail, new, card_print
  products/        — list, form
  workshops/       — list, detail
  embroiderers/    — list, detail
  barcode/         — scan
  prep/            — list
  dashboard.ejs, login.ejs, accounts.ejs, users.ejs, reports.ejs, error.ejs
public/
  css/style.css
  js/app.js
data/
  db.json          — auto-created on first run with seed data
```

## Environment variables

- `SESSION_SECRET` — secret for express-session (set in Replit Secrets)
- `SALLA_WEBHOOK_SECRET` — optional, for verifying Salla store webhooks (see README.md for setup)

## Database

Uses a local JSON file (`data/db.json`). Auto-created with seed data on first run. Back this file up periodically to preserve production data.

## User preferences

- Keep the existing flat-file JSON database approach unless explicitly asked to migrate.
- All UI is RTL Arabic (Bootstrap 5 RTL + Tajawal font).
- Business logic lives entirely in `server.js`; do not split into separate route files without user request.
