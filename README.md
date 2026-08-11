# Farsiland Slaughterhouse — website, ordering system & shop admin

Halal custom butchering site for Farsiland Slaughterhouse LLC, Paola KS. Marketing pages, a multi-animal ordering flow with interactive cut sheets, a 50-mile checkout radius, Stripe payments, emailed receipts, and an admin console for prices, availability, and promotions.

```
public/                  everything the web can see — nothing else is served
  index.html             the shop (self-contained, logo embedded)
  admin.html             staff console: prices, stock, promos, settings, orders
  logo.png
lib/
  core.mjs               pricing, distance, promos, receipts — shared by both hosts
  storage-blobs.mjs      storage adapter for Netlify Blobs
  storage-file.mjs       storage adapter for a Node host
netlify/functions/
  api.mjs                every /api route, as one Netlify Function
server.js                Node server (Render, Railway, Fly, a VPS)
netlify.toml             Netlify config
render.yaml              Render blueprint, with the persistent disk
preflight.js             pre-launch check — npm run preflight
DEPLOY.md                how to publish, step by step
```

**Publishing?** Read `DEPLOY.md`, then run `npm run preflight`. It deploys to **Netlify** (Functions + Blobs) or any **Node host** — same repo, same business logic, only the storage adapter differs.

---

## What it does

**Three species, real cut sheets.** Lamb and goat break into eight primals; beef into eleven (chuck, rib, short loin, sirloin, round, brisket, plate, flank, both shanks, neck). Each has its own hand-drawn chart — click a primal on the animal and it scrolls to that section's options. The choices are species-specific: goat offers bone-in curry cut throughout, beef offers T-bone vs boneless strip, jerky slices, and a ground-lean ratio. Quarter shares only show the primals that actually come with a front or hind quarter.

**Cart.** Each completed cut sheet is a line in the cart, so one order can carry a lamb cut for kabob, a second lamb cut for roasts, and a quarter beef — all with different instructions. Set a quantity on a line when you want several animals cut identically. Lines can be edited or removed right up to payment.

**50-mile rule.** The browser converts the ZIP to coordinates and measures from the shop for an instant answer; the server re-runs the same check independently and rejects out-of-range orders, so it can't be bypassed by editing the page. Past the radius, checkout stays locked and the customer gets the phone number plus a callback form that emails you their details *and* their draft cut sheets.

**24-hour delivery window.** Delivery orders pick a morning, afternoon, or evening window. Nothing goes out more than 24 hours after packing, and the window is carried into the receipt, the shop's copy, and the admin order view. The server refuses a delivery order with no window.

**Payments and receipts.** Card details go to Stripe Elements directly and never touch your server. The server prices the whole cart itself from its own catalog — the browser's numbers are ignored — then verifies the payment cleared and matches, saves the order, and emails a branded receipt containing every cut sheet, with a copy to the shop.

**Contact form.** Routed to the shop inbox and saved to `messages.json`, with a topic selector covering custom processing, game processing, wholesale, and Eid bookings.

---

## The admin console

Open `/admin.html` and sign in with `ADMIN_TOKEN` from your `.env`. The token lives in that browser tab only — reloading signs you out.

- **Products & prices** — price, an optional "was" price that shows struck through on the shop, and stock status per share: *In stock*, *Low stock*, *Out of stock*, *Coming soon*. Also the hanging weight, take-home weight, and the blurb on each card.
- **Promotions** — discount codes with a percent or dollar value, scoped to everything or to one species, with an optional expiry. Pause and resume without deleting. Plus a site banner that runs across the top of every page.
- **Settings** — delivery fee, ordering radius, sales tax rate.
- **Orders** — every order newest-first, expandable to the full cut sheet your butchers work from.

**Opening beef and goat:** both ship as *Coming soon* — their cut sheets are built and working, they're just not orderable. Set each of their shares to *In stock* on the Products tab and they go live on the next page load. No code changes.

Everything the admin saves is validated server-side: statuses must be from the known list, tax is capped at 25%, promo codes must be 3–20 alphanumeric characters, and the radius must be at least a mile.

---

## Setup

```bash
npm install
cp .env.example .env      # fill in Stripe, SMTP, and ADMIN_TOKEN
npm start                 # http://localhost:4242
```

**Stripe** — from Developers → API keys, put the secret key (`sk_...`) in `.env` and the publishable key (`pk_...`) in `index.html` → `CONFIG.stripePublishableKey`. Leave both blank and the site runs in **demo mode**: the whole flow works and orders are recorded, but no card is charged.

**Email** — any SMTP provider. Postmark or SendGrid are the reliable ones for receipts. With no SMTP configured, emails are logged to the console instead.

**Data**: on Netlify it lives in Netlify Blobs and survives redeploys with no setup. On a Node host it's flat JSON in `data/` — outside the web root, and `DATA_DIR` should point at a persistent disk or you'll lose it on every deploy. Either way it holds the catalog (prices, availability, promos), orders, contact messages, and the waitlist. Back it up.

Only `public/` is web-facing on both hosts, so the source and the order data are never downloadable.

---

## Before it goes live

- [ ] **Phone number** — `(913) 555-0142` is a placeholder. Replace it in `index.html` (`CONFIG.phone`, `CONFIG.phoneHref`, header, footer, contact section) and `.env` (`SHOP_PHONE`).
- [ ] **Prices** — every price is a placeholder, beef especially. Set real ones in the admin; they're authoritative from then on. The copies in `index.html` (`DEFAULT_CATALOG`) and `server.js` (`SEED`) are only the first-run seed and the no-server fallback.
- [ ] **Hanging weights and yields** — check the ranges against the animals you actually buy.
- [ ] **Email address** — `orders@farsiland.com` needs to exist on a domain you control, or receipts land in spam.
- [ ] **Sales tax** — Kansas exempts most unprepared food from the state rate, but local rates and the prepared/unprepared line are worth a call to the Kansas Department of Revenue.
- [ ] **ADMIN_TOKEN** — long and random. It's the only thing between the public and your pricing and order list.
- [ ] **`npm run preflight`** — catches most of this list automatically.
- [ ] **Delivery windows** — currently 8–12, 12–4, 4–8. Change `WINDOWS` in `index.html` and the validator in `server.js` together.

## Things you may want to change

**Driving miles instead of straight-line.** 50 miles as the crow flies is roughly 60–65 driving miles here. Swap `zipToLatLng` in `server.js` for a Google Distance Matrix call and compare against the returned mileage.

**Deposits instead of full payment.** In `priceOrder`, charge a percentage of `total` and record the balance due on the order — worth considering for beef, where a whole animal is a large card transaction.

**A real database.** Flat JSON is fine for the first few hundred orders; move to Postgres when you want reporting.

**Webhooks.** Orders confirm right after the client-side payment succeeds. For belt-and-braces, add a `payment_intent.succeeded` webhook that sends the receipt instead.

## Hosting

`index.html` and `admin.html` are static; the backend needs Node (Railway, Render, Fly.io). If you split them, set `CONFIG.apiBase` in `index.html` and `API` in `admin.html` to the backend URL, and add CORS to `server.js`.
