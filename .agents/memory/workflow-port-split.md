---
name: Workflow Port Split
description: Express ERP and Next.js dashboard run on separate ports with separate workflows
---

The Express ERP (`node server.js`) is the primary app and runs on **port 5000** as a `webview` workflow ("Start application").
The Next.js dashboard (`cd dashboard && npm run dev`) runs on **port 3000** as a `console` workflow ("Next.js Dashboard").

`dashboard/package.json` scripts use `--port 3000` (not 5000).

**Why:** Both can't bind port 5000 simultaneously. ERP is the operational system; dashboard is read-only. Preview pane (port 5000) shows the ERP.

**How to apply:** If the user asks to see the dashboard in the preview, you would swap which workflow gets port 5000 — but this breaks the ERP preview. Keep them separate.
