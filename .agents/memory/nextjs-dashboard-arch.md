---
name: Next.js Dashboard Architecture
description: Separate Next.js dashboard at /dashboard path — separate from the main ERP Express app
---

## Stack
- Next.js 14 (not 15 — CVE blocked)
- Config file must be `.mjs` (not `.js`)
- Arabic locale pages must be `'use client'` components
- ERP links use `NEXT_PUBLIC_ERP_URL` env var

## Ports
- Express ERP: port 5000 (webview / preview)
- Next.js dashboard: port 3000 (console only; EADDRINUSE errors on restart are normal if port is taken)

## Notes
- The Next.js dashboard (`/dashboard/`) is a separate standalone app, distinct from the main EJS-rendered ERP
- The main ERP dashboard is at `GET /` in server.js (views/dashboard.ejs)
