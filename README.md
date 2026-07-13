# Quely Sales Enablement

An interactive sales-enablement web app with **two surfaces sharing one backend**, built from the design handoff in `design_handoff_sales_enablement/`.

1. **Prospect Viewer** (`/v/<token>`) — a personalized, interactive pitch page. No login; the unguessable token in the URL is the access key. Prospects scroll a story (problem → proof → product) and *use* live demos: ask the Orbit AI, click through a Space's tabs, explore the Lens Map. Engagement (visits, per-section dwell, demo interactions, questions, CTA clicks) is recorded invisibly.
2. **Sales Dashboard** (`/dashboard`) — the internal side, behind auth. Reps create prospects → the app mints a unique link. They see per-prospect engagement, aggregate analytics, a questions inbox, and notifications when a prospect views or asks a question.

## Stack

- **Node + Express** HTTP server & API (`server/`)
- **SQLite** via Node's built-in `node:sqlite` — a real, persistent database (no external service to install). File at `data/quely.db`.
- **express-session** for dashboard auth (single shared team password)
- **nodemailer** for rep emails (first view + each question); console-log fallback when SMTP isn't configured
- Static, framework-free front-end (`public/`) ported pixel-for-pixel from the design prototypes

`server/db.js` is the production replacement for the prototype's `enablement-store.js`: **same data model, same function names, same semantics** — only the storage is now a real DB shared by both surfaces.

## Run

```bash
cd quely-app
npm install
cp .env.example .env      # optional — sane defaults work out of the box
npm start
```

Then open:
- Dashboard → http://localhost:3000/dashboard (password: `quely`, override with `DASHBOARD_PASSWORD`)
- Create a prospect, click **Open** on its row to visit `/v/<token>`, interact, then return to the dashboard — activity shows up within ~1.5s (polling).

## Architecture (one app, two doors)

- `/dashboard` — requires auth. `/login` posts the shared password; a signed session cookie gates the dashboard and its `/api/*` endpoints.
- `/v/<token>` — public. The client resolves the token via `GET /api/v/:token`; an unknown token renders the generic marketing page with no personalization and no data leak.
- One shared SQLite DB. Prospect actions on `/v/<token>` appear on `/dashboard` via polling.

### API (mirrors the `enablement-store.js` contract)

Dashboard (auth): `GET/POST /api/prospects`, `GET/DELETE /api/prospects/:token`, `GET /api/notifications`, `POST /api/notifications/clear`.
Prospect (public, token-scoped): `GET /api/v/:token` (personalization only), `POST /api/v/:token/{visit,section-time,event,question}`.

`createProspect · listProspects · getProspect · deleteProspect · recordVisit · addSectionTime · recordEvent · addQuestion · getNotifications` and the derived helpers (`totalMs`, `mostViewedSection`, `dropOffSection`, `status`) are all preserved — server-side for storage/notification/email, client-side for the analytics rendering that the prototype computed in the browser.

Token generation matches the spec: slug of company + first name, de-duped with a numeric suffix (`acme-sarah`, `acme-sarah-2`).

## Rep email

The README spec calls this out explicitly: in production the rep is emailed on a prospect's **first view** and on **every question**. `server/email.js` sends via SMTP when `SMTP_HOST` + `REP_EMAIL` are set, and otherwise logs the message to the console so the app runs out of the box. In-app notifications (the bell) fire regardless.

## Notes on assets

All logos, brand marks, the Orbit avatar and the design-token CSS were carried over from the handoff into `public/assets/`. Two assets could not be retrieved intact because the design download API caps files at 256 KiB:

- **Inter TTFs** — replaced by the identical Inter family from the Google Fonts CDN (see `public/assets/colors_and_type.css`). Drop the self-hosted TTFs into `public/assets/fonts/` and restore the `@font-face` block for a fully offline build.
- **`quely-product-ui.png`** (hero screenshot) — the design's original exceeds the cap on the Design MCP's only content method (`get_file`, capped at 256 KiB, no range/streaming), so it can't be pulled intact through the tooling. The hero ships a faithful inline recreation of a Quely Space AND an `<img src="/assets/quely-product-ui.png">` that **auto-takes over the moment you drop the real PNG into `public/assets/`** — no code change needed. While the file is absent the `<img>`'s `onerror` removes it and the recreation shows; once present it loads and hides the recreation.

Everything else (colors, typography, spacing, copy, interactions) is reproduced at high fidelity from the prototypes.
