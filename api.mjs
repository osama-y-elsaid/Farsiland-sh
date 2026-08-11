/**
 * Farsiland — every /api route, as one Netlify Function.
 * Business logic is shared with the Node server via ../../lib/core.mjs;
 * only the storage adapter and the request/response plumbing differ.
 */
import { storage } from '../../lib/storage-blobs.mjs';
import {
  SHOP, priceOrder, buildOrderRecord, sanitizeCatalog, findPromo,
  distanceForZip, receiptHtml, contactHtml, callbackHtml, sendEmail
} from '../../lib/core.mjs';

const stripe = process.env.STRIPE_SECRET_KEY
  ? new (await import('stripe')).default(process.env.STRIPE_SECRET_KEY)
  : null;

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cache-Control': 'no-store'
  }
});
const fail = (message, status = 400) => json({ error: message }, status);

const isAdmin = req => {
  if (!process.env.ADMIN_TOKEN) return false;
  return req.headers.get('x-admin-token') === process.env.ADMIN_TOKEN;
};

async function throttled(req, context, path, limit = 5, windowMs = 10 * 60e3) {
  const ip = context.ip || req.headers.get('x-nf-client-connection-ip') || 'unknown';
  return !(await storage.allowed(`${ip}${path}`, limit, windowMs));
}

export default async (req, context) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/$/, '');
  const body = req.method === 'POST' || req.method === 'PUT'
    ? await req.json().catch(() => ({})) : {};

  try {
    /* ---------------- public ---------------- */
    if (path === '/api/catalog' && req.method === 'GET') {
      const c = await storage.getCatalog();
      return json({ settings: c.settings, products: c.products, promos: [] }); // codes stay server-side
    }

    if (path === '/api/promos/validate' && req.method === 'POST') {
      if (await throttled(req, context, path, 30)) return fail('Too many attempts just now.', 429);
      const promo = findPromo(await storage.getCatalog(), body.code);
      if (!promo) return fail('That code is not valid.', 404);
      return json({ code: promo.code, label: promo.label, type: promo.type, value: promo.value, appliesTo: promo.appliesTo });
    }

    if (path === '/api/create-payment-intent' && req.method === 'POST') {
      if (!stripe) return fail('Payments are not configured on this site yet.', 503);
      const p = await priceOrder(body, await storage.getCatalog());
      const intent = await stripe.paymentIntents.create({
        amount: p.cents, currency: 'usd',
        automatic_payment_methods: { enabled: true },
        description: p.items.map(i => `${i.shareLabel}${i.quantity > 1 ? ' x' + i.quantity : ''}`).join(', '),
        receipt_email: body.customer.email,
        metadata: { animals: String(p.amounts.animals), fulfilment: p.fulfilment,
          zip: body.address.zip, miles: String(p.dist.miles),
          promo: p.promo ? p.promo.code : '', customer: body.customer.name }
      });
      return json({ clientSecret: intent.client_secret, amount: p.amounts.total });
    }

    if (path === '/api/orders' && req.method === 'POST') {
      const catalog = await storage.getCatalog();
      const p = await priceOrder(body, catalog);

      if (stripe && body.paymentIntentId) {
        const pi = await stripe.paymentIntents.retrieve(body.paymentIntentId);
        if (pi.status !== 'succeeded') return fail('That payment has not cleared.', 402);
        if (pi.amount !== p.cents) return fail('Payment amount does not match the order.');
      } else if (stripe) {
        return fail('No payment was attached to this order.', 402);
      }

      const order = buildOrderRecord(body, p, await storage.nextOrderNumber());
      await storage.saveOrder(order);

      let emailed = false;
      try {
        emailed = await sendEmail(order.customer.email,
          `Order ${order.orderNumber} confirmed — ${p.amounts.animals} animal(s) | Farsiland`,
          receiptHtml(order, false));
        await sendEmail(SHOP.email, `New order ${order.orderNumber} — ${order.customer.name}`, receiptHtml(order, true));
      } catch (e) { console.error('Email failed:', e.message); }

      return json({ orderNumber: order.orderNumber, emailed });
    }

    if (path === '/api/contact' && req.method === 'POST') {
      if (await throttled(req, context, path)) return fail('Too many messages just now — try again in a few minutes.', 429);
      const { name, email, phone, topic, message } = body;
      if (!name || !message || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email || ''))
        return fail('Name, a valid email, and a message are required.');
      await storage.append('messages', { name, email, phone, topic, message, at: new Date().toISOString() });
      try { await sendEmail(SHOP.email, `Contact form: ${topic || 'Message'} — ${name}`, contactHtml(body)); }
      catch (e) { console.error(e.message); }
      return json({ ok: true });
    }

    if (path === '/api/callback' && req.method === 'POST') {
      if (await throttled(req, context, path)) return fail('Too many requests just now.', 429);
      if (!body.name || !body.phone) return fail('Name and phone are required.');
      await storage.append('callbacks', { ...body, at: new Date().toISOString() });
      try { await sendEmail(SHOP.email, `Callback: ${body.name} — ${body.distance || '?'} mi out`, callbackHtml(body)); }
      catch (e) { console.error(e.message); }
      return json({ ok: true });
    }

    if (path === '/api/waitlist' && req.method === 'POST') {
      if (await throttled(req, context, path)) return fail('Too many requests just now.', 429);
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(body.email || '')) return fail('Valid email required.');
      await storage.append('waitlist', { email: body.email, product: body.product, at: new Date().toISOString() });
      return json({ ok: true });
    }

    if (path.startsWith('/api/distance/') && req.method === 'GET') {
      const zip = path.split('/').pop();
      const c = await storage.getCatalog();
      return json(await distanceForZip(zip, c.settings.radiusMiles));
    }

    /* ---------------- admin ---------------- */
    if (path.startsWith('/api/admin/')) {
      if (!process.env.ADMIN_TOKEN) return fail('Set ADMIN_TOKEN in the site environment before using the admin.', 503);
      if (!isAdmin(req)) return fail('That token is not right.', 401);

      if (path === '/api/admin/catalog' && req.method === 'GET') return json(await storage.getCatalog());
      if (path === '/api/admin/catalog' && req.method === 'PUT') return json(await storage.putCatalog(sanitizeCatalog(body)));
      if (path === '/api/admin/orders' && req.method === 'GET') return json(await storage.listOrders());
    }

    return fail('No such endpoint.', 404);
  } catch (e) {
    console.error(e);
    return fail(e.message || 'Something went wrong.');
  }
};

export const config = {
  path: [
    '/api/catalog', '/api/promos/validate', '/api/create-payment-intent', '/api/orders',
    '/api/contact', '/api/callback', '/api/waitlist', '/api/distance/:zip',
    '/api/admin/catalog', '/api/admin/orders'
  ]
};
