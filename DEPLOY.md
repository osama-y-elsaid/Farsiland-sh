# Publishing Farsiland

Two supported hosts, same repo. **You already use Netlify, so take track A.**

```
public/            <- everything the web can see
  index.html         the shop
  admin.html         staff console
  logo.png
netlify/functions/
  api.mjs            all /api routes, on Netlify
lib/
  core.mjs           pricing, distance, promos, receipts — shared by both hosts
  storage-blobs.mjs  storage for Netlify
  storage-file.mjs   storage for a Node host
server.js          Node server (track B only)
netlify.toml       Netlify config
render.yaml        Render blueprint (track B)
preflight.js       npm run preflight
```

Nothing outside `public/` is ever served. That matters: your order data and source stay private on both hosts.

---

## 1. Decide these first (they can't be faked)

| Thing | Why it blocks launch |
|---|---|
| **Shop phone number** | Every customer beyond 50 miles is told to call it. It's currently `(913) 555-0142`, a placeholder I invented. |
| **Real prices** | The ones in here are guesses. Lamb is plausible; beef is a shot in the dark and depends on your live-weight cost. |
| **A domain** | You need it for the site *and* to send receipts that aren't flagged as spam. |
| **An email address on that domain** | `orders@farsiland.com` must actually exist — orders, contact forms, and callback requests land there. |
| **Stripe account** | Business details, bank account, identity verification. Approval takes a day or two; start it now. |
| **Halal certification wording** | The site states the slaughter is by hand facing qiblah with tasmiyah, and that the facility is inspected. Every word must be true before it's public. |

---

## Track A — Netlify (recommended for you)

Netlify has no always-on server and no writable disk, so two things differ from a normal Node deploy: the API runs as a **Netlify Function** (`netlify/functions/api.mjs`), and orders, the catalog, and messages live in **Netlify Blobs** instead of files. Both are already wired up — Blobs needs no provisioning, no dashboard button, nothing.

1. **Push the repo to GitHub.** Check `.env` isn't in the first commit — `.gitignore` covers it.
2. **Netlify → Add new site → Import an existing project.** It reads `netlify.toml`: publish `public/`, functions from `netlify/functions`, no build step.
3. **Set the environment variables** (Site configuration → Environment variables):
   `ADMIN_TOKEN`, `STRIPE_SECRET_KEY`, `POSTMARK_TOKEN` (or `RESEND_API_KEY`), `MAIL_FROM`, `SHOP_EMAIL`, `SHOP_PHONE`, `TAX_RATE`.
4. **Add your domain** under Domain management, and follow the DNS steps.
5. **Deploy.** The API answers at `yourdomain.com/api/*` on the same domain as the shop, so no CORS setup and nothing to change in `index.html`.

Locally: `npm install && npm run netlify:dev` (needs `netlify-cli`). Blobs works locally with no setup.

**Worth knowing about Blobs.** The admin orders list reads every order key and fetches them. That's fine into the hundreds. If Farsiland ever gets into the thousands of orders, move that one query to Netlify's database rather than Blobs — the rest of the code won't change.

---

## Track B — a Node host (Render, Railway, Fly, a VPS)

Use this if you'd rather run one long-lived process. `server.js` serves the same routes from the same `lib/core.mjs`.

1. Push to GitHub, then Render → **New → Blueprint** → pick the repo. `render.yaml` sets up the service and a 1 GB persistent disk at `/var/data`, with `DATA_DIR` already pointed at it.
2. Fill the secret env vars in the dashboard.
3. **The disk is not optional.** Orders are flat files here. On an ephemeral filesystem — Render's free tier, Fly without a volume — every order and price change disappears on the next deploy.

---

## 2. Payments

1. Stripe → **Developers → API keys**.
2. Secret key (`sk_live_…`) → environment variable. **Never** in `public/index.html`.
3. Publishable key (`pk_live_…`) → `public/index.html`, `CONFIG.stripePublishableKey`.
4. Put a real card through for a small amount, then refund it from the Stripe dashboard. Test-mode cards won't tell you whether your live account is actually enabled.

Leave both blank and the site runs in demo mode — the full flow works, orders record, nothing is charged. Good for letting family click through before launch.

## 3. Email

Use a transactional provider, not a personal Gmail — receipts from Gmail land in spam and you'll never know.

1. Add your domain in Postmark or Resend and set the **SPF and DKIM** DNS records they give you. Skip this and receipts go to junk.
2. Set `POSTMARK_TOKEN` (or `RESEND_API_KEY`) and `MAIL_FROM` on the same domain.
3. On Netlify, prefer these HTTP APIs over SMTP — outbound SMTP from a serverless function is slow and sometimes blocked. SMTP still works on a Node host.
4. Place a demo order to yourself and check the receipt arrives, renders, and isn't in spam.

## 4. Run the check

```bash
npm install
npm run preflight
```

It looks for the placeholder phone number, a weak or missing `ADMIN_TOKEN`, mismatched or leaked Stripe keys, a missing email provider, and prices still at my invented defaults — and it knows which host you're on, so it only warns about `DATA_DIR` when that's relevant. Non-zero exit if anything would break or embarrass you.

## 5. Open for orders

1. `yourdomain.com/admin.html`, sign in with `ADMIN_TOKEN`.
2. **Products & prices** — real prices, then stock status. Lamb *In stock*; beef and goat *Coming soon* until you're ready.
3. **Settings** — delivery fee, radius, tax rate.
4. Place one real order yourself, end to end, with a real card. Check: customer receipt arrives, shop copy arrives, the order appears in the admin with the right cut sheet, money is in Stripe.
5. Then tell people.

---

## After launch

- **Back up your data.** On Netlify that's the Blobs stores; on a Node host it's `data/`. It holds every order and your whole catalog.
- **Watch the first ten orders closely.** Cut sheets are where confusion shows. If several customers pick something odd for the same primal, the wording needs work — not the customer.
- **Beef and goat** go live from the admin. No code changes, no redeploy.
- **Promo codes** run from the admin too; the site banner is the fastest way to announce one.

## What I can't do from here

I have no network access, so I can't create the repo, run the deploy, register the domain, or touch your Stripe account — those need your accounts and your credentials, and you should be the one entering them anyway.
