---
name: Next.js Dashboard Architecture
description: Key decisions and gotchas for the Lamsa dashboard (dashboard/ subdirectory, Next.js 14, React 18)
---

# Next.js Dashboard Architecture

## Stack pinned versions
- Next.js **14.2.29** (not 15 — blocked by Replit security policy with CVE)
- React **18.3.1** (not 19)
- `@types/react@18`, `@types/react-dom@18`

**Why:** Next.js 15.x was blocked by Replit's Socket Security Policy. 14.x installed cleanly.

## Config file extensions
- `next.config.mjs` — NOT `.ts` (Next.js 14 does not support `.ts` config)
- `tailwind.config.js` — NOT `.ts`

**Why:** Next.js 14 throws `Configuring Next.js via 'next.config.ts' is not supported` at startup.

## Data path
`path.join(process.cwd(), '..', 'data', 'db.json')` — works because `cwd()` is `<root>/dashboard` when run via `cd dashboard && npm run dev`.

## Hydration rule: always pass `calendar: 'gregory'` with `ar-SA`
`toLocaleDateString('ar-SA')` with **no** `calendar` option produces **Hijri dates on Node.js ICU** but **Gregorian on Chrome**. This crashes hydration across the entire root.

**Fix:** always pass `{ calendar: 'gregory', ...opts }` — applies to every call site: `lib/utils.ts → formatDate`, `Header.tsx`, and any future component using `ar-SA` locale dates.

Adding `'use client'` alone is NOT sufficient — Next.js still SSRs client components, so the mismatch survives.

## ERP link pattern
All links back to the Express ERP (orders, barcode, prep) use `NEXT_PUBLIC_ERP_URL` env var (defined in `dashboard/.env.local`). Relative paths like `/orders` resolve to Next.js routes (404), not the Express app.

**How to apply:** When adding any link to an Express ERP page, prefix with `process.env.NEXT_PUBLIC_ERP_URL ?? ''`.

## Font loading
Use `next/font/google` (`Tajawal`) in layout.tsx. Do NOT add `<link>` tags manually in `<head>` — causes hydration mismatch in Next.js 14 App Router.
