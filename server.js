/**
 * Farsiland Slaughterhouse LLC — Node server (Render, Railway, Fly, a VPS).
 * Deploying to Netlify instead? This file is not used — netlify/functions/api.mjs
 * serves the same routes from the same shared logic in lib/core.mjs.
 *
 * Run:  cp .env.example .env  &&  npm install  &&  npm start
 */
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storage } from './lib/storage-file.mjs';
import {
  SHOP, priceOrder, buildOrderRecord, sanitizeCatalog, findPromo,
  distanceForZip, receiptHtml, contactHtml, callbackHtml, sendEmail
} from './lib/core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = process.env.PORT || 4242;
const stripe = process.env.STRIPE_SECRET_KEY
  ? new (await import('stripe')).default(process.env.STRIPE_SECRET_KEY) : null;

const app = express();
app.use(express.json({ limit: '512kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin'
  });
  next();
});

/* Only ./public is web-facing. Never serve the app directory itself — that
   would hand out the order data and the rest of the source. */
app.use(express.static(PUBLIC_DIR, { dotfiles: 'deny', index: 'index.html' }));

/* Light throttle so the public write endpoints can't be used as a spam relay. */
const throttle = (limit, windowMs) => async (req, res, next) => {
  const key = (req.ip || req.socket.remoteAddress || 'x') + req.path;
  if (!(await storage.allowed(key, limit, windowMs)))
    return res.status(429).json({ error: 'Too many requests just now — try again in a few minutes.' });
  next();
};
const requireAdmin = (req, res, next) => {
  if (!process.env.ADMIN_TOKEN) return res.status(503).json({ error: 'Set ADMIN_TOKEN in .env before using the admin.' });
  if (req.get('x-admin-token') !== process.env.ADMIN_TOKEN) return res.status(401).json({ error: 'That token is not right.' });
  next();
};

/* ---------------- public ---------------- */
app.get('/api/catalog', async (_, res) => {
  const c = await storage.getCatalog();
  res.json({ settings: c.settings, products: c.products, promos: [] });   // codes stay server-side
});

app.post('/api/promos/validate', throttle(30, 10 * 60e3), async (req, res) => {
  const promo = findPromo(await storage.getCatalog(), req.body.code);
  if (!promo) return res.status(404).json({ error: 'That code is not valid.' });
  res.json({ code: promo.code, label: promo.label, type: promo.type, value: promo.value, appliesTo: promo.appliesTo });
});

app.post('/api/create-payment-intent', async (req, res) => {
  try {
    if (!stripe) return res.status(503).json({ error: 'Payments are not configured on this server yet.' });
    const p = await priceOrder(req.body, await storage.getCatalog());
    const intent = await stripe.paymentIntents.create({
      amount: p.cents, currency: 'usd',
      automatic_payment_methods: { enabled: true },
      description: p.items.map(i => `${i.shareLabel}${i.quantity > 1 ? ' x' + i.quantity : ''}`).join(', '),
      receipt_email: req.body.customer.email,
      metadata: { animals: String(p.amounts.animals), fulfilment: p.fulfilment,
        zip: req.body.address.zip, miles: String(p.dist.miles),
        promo: p.promo ? p.promo.code : '', customer: req.body.customer.name }
    });
    res.json({ clientSecret: intent.client_secret, amount: p.amounts.total });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/orders', async (req, res) => {
  try {
    const p = await priceOrder(req.body, await storage.getCatalog());
    if (stripe && req.body.paymentIntentId) {
      const pi = await stripe.paymentIntents.retrieve(req.body.paymentIntentId);
      if (pi.status !== 'succeeded') return res.status(402).json({ error: 'That payment has not cleared.' });
      if (pi.amount !== p.cents) return res.status(400).json({ error: 'Payment amount does not match the order.' });
    } else if (stripe) {
      return res.status(402).json({ error: 'No payment was attached to this order.' });
    }

    const order = buildOrderRecord(req.body, p, await storage.nextOrderNumber());
    await storage.saveOrder(order);

    let emailed = false;
    try {
      emailed = await sendEmail(order.customer.email,
        `Order ${order.orderNumber} confirmed — ${p.amounts.animals} animal(s) | Farsiland`, receiptHtml(order, false));
      await sendEmail(SHOP.email, `New order ${order.orderNumber} — ${order.customer.name}`, receiptHtml(order, true));
    } catch (e) { console.error('Email failed:', e.message); }

    res.json({ orderNumber: order.orderNumber, emailed });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/contact', throttle(5, 10 * 60e3), async (req, res) => {
  const { name, email, phone, topic, message } = req.body || {};
  if (!name || !message || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email || ''))
    return res.status(400).json({ error: 'Name, a valid email, and a message are required.' });
  await storage.append('messages', { name, email, phone, topic, message, at: new Date().toISOString() });
  try { await sendEmail(SHOP.email, `Contact form: ${topic || 'Message'} — ${name}`, contactHtml(req.body)); }
  catch (e) { console.error(e.message); }
  res.json({ ok: true });
});

app.post('/api/callback', throttle(5, 10 * 60e3), async (req, res) => {
  if (!req.body.name || !req.body.phone) return res.status(400).json({ error: 'Name and phone are required.' });
  await storage.append('callbacks', { ...req.body, at: new Date().toISOString() });
  try { await sendEmail(SHOP.email, `Callback: ${req.body.name} — ${req.body.distance || '?'} mi out`, callbackHtml(req.body)); }
  catch (e) { console.error(e.message); }
  res.json({ ok: true });
});

app.post('/api/waitlist', throttle(5, 10 * 60e3), async (req, res) => {
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(req.body.email || ''))
    return res.status(400).json({ error: 'Valid email required.' });
  await storage.append('waitlist', { email: req.body.email, product: req.body.product, at: new Date().toISOString() });
  res.json({ ok: true });
});

app.get('/api/distance/:zip', async (req, res) => {
  const c = await storage.getCatalog();
  res.json(await distanceForZip(req.params.zip, c.settings.radiusMiles));
});

/* ---------------- admin ---------------- */
app.get('/api/admin/catalog', requireAdmin, async (_, res) => res.json(await storage.getCatalog()));
app.put('/api/admin/catalog', requireAdmin, async (req, res) => {
  try { res.json(await storage.putCatalog(sanitizeCatalog(req.body))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/admin/orders', requireAdmin, async (_, res) => res.json(await storage.listOrders()));

app.listen(PORT, async () => {
  await storage.getCatalog();
  if (!process.env.ADMIN_TOKEN || process.env.ADMIN_TOKEN.length < 20)
    console.warn('  WARNING: ADMIN_TOKEN is missing or short. Use 30+ random characters before going public.');
  console.log(`Farsiland order server on http://localhost:${PORT}`);
  console.log(`  admin:  http://localhost:${PORT}/admin.html`);
  console.log(`  data:   ${storage.dataDir}`);
  console.log(`  Stripe: ${stripe ? 'live' : 'not configured (demo mode)'}`);
});
