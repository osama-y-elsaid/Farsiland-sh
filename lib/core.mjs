/**
 * Farsiland — shared business logic.
 * Storage-agnostic on purpose: the Node server hands it a file-backed store,
 * the Netlify function hands it a Blobs-backed one. Pricing, distance rules,
 * promo maths and email templates live here once so the two can't drift.
 */

export const SHOP = {
  name: 'Farsiland Slaughterhouse LLC',
  address: '25400 W 319th Street, Paola, KS 66071',
  phone: process.env.SHOP_PHONE || '(913) 555-0142',
  email: process.env.SHOP_EMAIL || 'orders@farsiland.com',
  origin: { lat: 38.5719, lng: -94.8791 }
};

export const SEED = {
  settings: { deliveryFee: 29, radiusMiles: 50, taxRate: parseFloat(process.env.TAX_RATE || '0'), banner: '' },
  products: {
    'lamb-whole':   { species:'lamb', portion:'whole',   label:'Whole lamb',   price:429,  compareAt:0, hanging:'28–36 lb', takehome:'20–26 lb', feeds:'A family of 5–6 for three or four months', status:'available' },
    'lamb-half':    { species:'lamb', portion:'half',    label:'Half lamb',    price:229,  compareAt:0, hanging:'14–18 lb', takehome:'10–13 lb', feeds:'A family of four for about six weeks', status:'available' },
    'lamb-quarter': { species:'lamb', portion:'quarter', label:'Quarter lamb', price:125,  compareAt:0, hanging:'7–9 lb',   takehome:'5–7 lb',   feeds:'Two or three people for a month', status:'available' },
    'goat-whole':   { species:'goat', portion:'whole',   label:'Whole goat',   price:379,  compareAt:0, hanging:'30–40 lb', takehome:'22–29 lb', feeds:'A family of five for two or three months', status:'coming_soon' },
    'goat-half':    { species:'goat', portion:'half',    label:'Half goat',    price:199,  compareAt:0, hanging:'15–20 lb', takehome:'11–15 lb', feeds:'A family of four for about a month', status:'coming_soon' },
    'beef-quarter': { species:'beef', portion:'quarter', label:'Quarter beef', price:1195, compareAt:0, hanging:'160–190 lb', takehome:'110–135 lb', feeds:'A family of four for six to eight months', status:'coming_soon' },
    'beef-half':    { species:'beef', portion:'half',    label:'Half beef',    price:2290, compareAt:0, hanging:'320–380 lb', takehome:'220–270 lb', feeds:'A family of four for a year', status:'coming_soon' },
    'beef-whole':   { species:'beef', portion:'whole',   label:'Whole beef',   price:4450, compareAt:0, hanging:'640–760 lb', takehome:'440–540 lb', feeds:'Two families, or a freezer program', status:'coming_soon' }
  },
  promos: []
};

export const orderable = p => p && (p.status === 'available' || p.status === 'low');
export const esc = s => String(s == null ? '' : s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
export const money = n => '$' + Number(n).toFixed(2);

/* ------------------------------------------------------------------
   Distance — straight line from the shop.
------------------------------------------------------------------ */
const ZIP_FALLBACK = {
  '66071':[38.5719,-94.8791],'66064':[38.5253,-94.8083],'66033':[38.4197,-95.0058],
  '66067':[38.6069,-95.2717],'66092':[38.6572,-95.0836],'66040':[38.3486,-94.8383],
  '66053':[38.4772,-94.6444],'66013':[38.6103,-94.6497],'66083':[38.6244,-94.8261],
  '66062':[38.8375,-94.7561],'66061':[38.8867,-94.8697],'66021':[38.7833,-94.9714],
  '66031':[38.8386,-94.8781],'66030':[38.8161,-94.9269],'66043':[38.9683,-94.6206],
  '66207':[38.9464,-94.6342],'66208':[38.9825,-94.6294],'66210':[38.9192,-94.7078],
  '66212':[38.9583,-94.6803],'66213':[38.8931,-94.7061],'66214':[38.9558,-94.7211],
  '66215':[38.9506,-94.7419],'66216':[39.0058,-94.7311],'66221':[38.8578,-94.7125],
  '66223':[38.8608,-94.6803],'66224':[38.8578,-94.6294],'66226':[39.0244,-94.8342],
  '66227':[38.9633,-94.8375],'66202':[39.0244,-94.6667],'66203':[39.0225,-94.7003],
  '66204':[38.9925,-94.6772],'66205':[39.0286,-94.6289],'66206':[38.9856,-94.6178],
  '66209':[38.8925,-94.6236],'66211':[38.9219,-94.6486],'64108':[39.0864,-94.5847],
  '64111':[39.0592,-94.5936],'64112':[39.0397,-94.5931],'64113':[39.0136,-94.5936],
  '64114':[38.9642,-94.5947],'64131':[38.9797,-94.5769],'64145':[38.8842,-94.5983],
  '64106':[39.1064,-94.5697],'64105':[39.1017,-94.5919],'64134':[38.9317,-94.5081],
  '64137':[38.9269,-94.5450],'64138':[38.9531,-94.4692],'64146':[38.8969,-94.5878],
  '64030':[38.8875,-94.5175],'64083':[38.7756,-94.4433],'64012':[38.7492,-94.5222],
  '64063':[38.9092,-94.3564],'64081':[38.9092,-94.4128],'64082':[38.8567,-94.4131],
  '66048':[39.3053,-94.9161],'66049':[38.9686,-95.3133],'66044':[38.9625,-95.2258],
  '66046':[38.9203,-95.2258],'66047':[38.9047,-95.2939],'66607':[39.0325,-95.7003],
  '66801':[38.3822,-96.1817],'66701':[37.8494,-94.7042],'64735':[38.3728,-93.7686],
  '64742':[38.5822,-94.3411],'64720':[38.3922,-94.3400],'64730':[38.2544,-94.3403]
};
const ZIP_CACHE = new Map();

export function haversine(a, b) {
  const R = 3958.8, rad = x => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
export async function zipToLatLng(zip) {
  if (ZIP_CACHE.has(zip)) return ZIP_CACHE.get(zip);
  if (ZIP_FALLBACK[zip]) return { lat: ZIP_FALLBACK[zip][0], lng: ZIP_FALLBACK[zip][1] };
  const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
  if (!r.ok) return null;
  const d = await r.json();
  const p = d.places && d.places[0];
  if (!p) return null;
  const pt = { lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), city: p['place name'] };
  ZIP_CACHE.set(zip, pt);
  return pt;
}
export async function distanceForZip(zip, radius) {
  if (!/^\d{5}$/.test(String(zip || ''))) return { ok: false, reason: 'A five-digit ZIP code is required.' };
  const pt = await zipToLatLng(zip).catch(() => null);
  if (!pt) return { ok: false, reason: 'We could not look up that ZIP code.' };
  const miles = Math.round(haversine(SHOP.origin, pt) * 10) / 10;
  return { ok: true, miles, inRange: miles <= radius, city: pt.city };
}

/* ------------------------------------------------------------------
   Promos
------------------------------------------------------------------ */
export function findPromo(catalog, code) {
  const p = (catalog.promos || []).find(x => x.code === String(code || '').trim().toUpperCase());
  if (!p || p.active === false) return null;
  if (p.expires && new Date(p.expires) < new Date(new Date().toDateString())) return null;
  return p;
}
export function discountFor(promo, items, catalog) {
  if (!promo) return 0;
  const base = items.reduce((n, it) => {
    const prod = catalog.products[it.shareId];
    if (!prod) return n;
    if (promo.appliesTo && promo.appliesTo !== 'all' && prod.species !== promo.appliesTo) return n;
    return n + prod.price * it.quantity;
  }, 0);
  const d = promo.type === 'percent' ? base * (promo.value / 100) : Math.min(promo.value, base);
  return Math.round(d * 100) / 100;
}

/* ------------------------------------------------------------------
   Pricing + validation. The browser's numbers are never trusted.
------------------------------------------------------------------ */
export async function priceOrder(body, catalog) {
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) throw new Error('There is nothing in the cart.');

  const priced = items.map(it => {
    const prod = catalog.products[it.shareId];
    if (!prod) throw new Error('One of those shares is no longer listed.');
    if (!orderable(prod)) throw new Error(`${prod.label} is not available to order right now.`);
    const qty = Math.max(1, Math.min(20, parseInt(it.quantity, 10) || 1));
    if (!Array.isArray(it.cuts) || !it.cuts.length || it.cuts.some(c => !c.choice))
      throw new Error(`The cut sheet for the ${prod.label.toLowerCase()} is incomplete.`);
    if (prod.portion === 'quarter' && !['front', 'hind'].includes(it.side))
      throw new Error(`Choose a front or hind ${prod.label.toLowerCase()}.`);
    return { ...it, quantity: qty, shareLabel: prod.label, unitPrice: prod.price, species: prod.species };
  });

  const fulfilment = body.fulfilment === 'delivery' ? 'delivery' : 'pickup';
  const dist = await distanceForZip(body.address && body.address.zip, catalog.settings.radiusMiles);
  if (!dist.ok) throw new Error(dist.reason);
  if (!dist.inRange) throw new Error(`That address is ${dist.miles} miles from Paola. Orders beyond ${catalog.settings.radiusMiles} miles are taken by phone on ${SHOP.phone}.`);
  if (fulfilment === 'delivery' && !['morning', 'afternoon', 'evening'].includes(body.deliveryWindow))
    throw new Error('Pick a delivery window.');

  const c = body.customer || {};
  if (!c.name || !c.email || !c.phone) throw new Error('Name, email, and phone are required.');
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(c.email)) throw new Error('That email address is not valid.');

  const subtotal = priced.reduce((n, it) => n + it.unitPrice * it.quantity, 0);
  const promo = body.promoCode ? findPromo(catalog, body.promoCode) : null;
  if (body.promoCode && !promo) throw new Error('That discount code is not valid any more.');
  const discount = discountFor(promo, priced, catalog);
  const delivery = fulfilment === 'delivery' ? catalog.settings.deliveryFee : 0;
  const taxable = Math.max(0, subtotal - discount) + delivery;
  const tax = Math.round(taxable * (catalog.settings.taxRate || 0) * 100) / 100;
  const total = Math.round((taxable + tax) * 100) / 100;

  return { items: priced, fulfilment, dist, promo,
    amounts: { subtotal, discount, delivery, tax, total, animals: priced.reduce((n, i) => n + i.quantity, 0) },
    cents: Math.round(total * 100) };
}

export function buildOrderRecord(body, priced, orderNumber) {
  return {
    orderNumber,
    createdAt: new Date().toISOString(),
    status: 'paid',
    items: priced.items,
    fulfilment: priced.fulfilment,
    address: body.address,
    distanceMiles: priced.dist.miles,
    deliveryWindow: body.deliveryWindow || null,
    readyDate: body.readyDate || '',
    occasion: body.occasion || '',
    promoCode: priced.promo ? priced.promo.code : null,
    customer: body.customer,
    amounts: priced.amounts,
    paymentIntentId: body.paymentIntentId || null
  };
}

/* Whatever the admin sends is re-validated here before it is stored. */
export function sanitizeCatalog(c) {
  if (!c || !c.products || !Object.keys(c.products).length) throw new Error('No products in that payload.');
  const STATUSES = ['available', 'low', 'out_of_stock', 'coming_soon'];
  const clean = { settings: {}, products: {}, promos: [] };
  clean.settings = {
    deliveryFee: Math.max(0, Number(c.settings.deliveryFee) || 0),
    radiusMiles: Math.max(1, Number(c.settings.radiusMiles) || 50),
    taxRate: Math.min(0.25, Math.max(0, Number(c.settings.taxRate) || 0)),
    banner: String(c.settings.banner || '').slice(0, 240)
  };
  for (const [id, p] of Object.entries(c.products)) {
    clean.products[id] = {
      species: p.species, portion: p.portion, label: String(p.label).slice(0, 60),
      price: Math.max(0, Number(p.price) || 0), compareAt: Math.max(0, Number(p.compareAt) || 0),
      hanging: String(p.hanging).slice(0, 40), takehome: String(p.takehome).slice(0, 40),
      feeds: String(p.feeds).slice(0, 160),
      status: STATUSES.includes(p.status) ? p.status : 'out_of_stock'
    };
  }
  clean.promos = (c.promos || []).filter(p => /^[A-Z0-9]{3,20}$/.test(p.code || '')).map(p => ({
    code: p.code, label: String(p.label || '').slice(0, 60),
    type: p.type === 'fixed' ? 'fixed' : 'percent',
    value: Math.max(0, Number(p.value) || 0),
    appliesTo: ['all', 'lamb', 'goat', 'beef'].includes(p.appliesTo) ? p.appliesTo : 'all',
    expires: p.expires || null, active: p.active !== false
  }));
  return clean;
}

/* ------------------------------------------------------------------
   Email
------------------------------------------------------------------ */
const G = { green: '#2d5016', gold: '#c9a961', cream: '#faf7f2', line: '#e4ddcc', char: '#2c2c2c', gray: '#7d7869' };
export const row = (k, v) => `<tr><td style="padding:6px 0;border-bottom:1px dotted ${G.line};color:${G.gray};font-size:13px">${esc(k)}</td>
  <td style="padding:6px 0;border-bottom:1px dotted ${G.line};text-align:right;font-family:Menlo,Consolas,monospace;font-size:12px;color:${G.char}">${esc(v)}</td></tr>`;
export const WINDOW_TEXT = { morning: 'Morning, 8am–12pm', afternoon: 'Afternoon, 12pm–4pm', evening: 'Evening, 4pm–8pm' };

export function receiptHtml(o, forShop) {
  const a = o.amounts;
  const item = it => `
    <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${G.gold};font-family:Arial,sans-serif;font-weight:bold;margin:18px 0 6px">
      ${esc(it.shareLabel)}${it.quantity > 1 ? ` × ${it.quantity}` : ''}${it.side ? ` — ${esc(it.side)} quarter` : ''}</div>
    <table style="width:100%;border-collapse:collapse">
      ${it.cuts.map(c => row(c.primal, c.choice)).join('')}
      ${Object.entries(it.specs || {}).map(([k, v]) => row(k, typeof v === 'boolean' ? (v ? 'yes' : 'no') : v)).join('')}
      ${row('Keeping', it.offal && it.offal.length ? it.offal.join(', ') : 'Nothing')}
    </table>
    ${it.notes ? `<div style="background:#fdf8ec;border:1px solid ${G.line};padding:10px 12px;margin-top:8px;font-size:13px">
      <b style="color:${G.green}">Notes:</b> ${esc(it.notes)}</div>` : ''}`;

  return `<div style="background:${G.cream};padding:26px 0;font-family:Georgia,serif">
  <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid ${G.line}">
    <div style="background:${G.green};padding:22px 26px">
      <div style="color:${G.gold};font-size:20px">FARSILAND SLAUGHTERHOUSE</div>
      <div style="color:#cfd3c4;font-size:11px;letter-spacing:.18em;text-transform:uppercase;margin-top:4px">
        ${forShop ? 'New order — cut sheets' : 'Order confirmation &amp; receipt'}</div>
    </div>
    <div style="padding:24px 26px">
      <p style="font-size:15px;color:${G.char};margin:0 0 14px">
        ${forShop ? `New online order from <b>${esc(o.customer.name)}</b> (${esc(o.customer.phone)}) — ${a.animals} animal(s).`
                  : `Assalamu alaikum ${esc(o.customer.name.split(' ')[0])} — we've got your order and payment. Here is exactly what our butchers will work from.`}</p>
      <div style="background:${G.cream};border-left:3px solid ${G.gold};padding:12px 16px;margin-bottom:16px">
        <div style="font-family:Menlo,Consolas,monospace;font-size:19px;color:${G.green};letter-spacing:.06em">${esc(o.orderNumber)}</div>
        <div style="font-size:12px;color:${G.gray}">${new Date(o.createdAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}</div>
      </div>
      ${o.items.map(item).join('')}

      <div style="font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${G.gold};font-family:Arial,sans-serif;font-weight:bold;margin:20px 0 6px">
        ${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</div>
      <table style="width:100%;border-collapse:collapse">
        ${o.fulfilment === 'delivery'
          ? row('Deliver to', `${o.address.street}, ${o.address.city} ${o.address.zip}`) + row('Window', WINDOW_TEXT[o.deliveryWindow] || '—')
          : row('Collect from', '25400 W 319th St, Paola KS')}
        ${row('Distance from shop', `${o.distanceMiles} miles`)}
        ${o.readyDate ? row('Requested ready date', o.readyDate) : ''}
        ${o.occasion ? row('Occasion', o.occasion) : ''}
        ${row('Contact', `${o.customer.phone} · ${o.customer.email}`)}
      </table>

      <table style="width:100%;border-collapse:collapse;margin-top:16px">
        ${o.items.map(it => row(`${it.shareLabel}${it.quantity > 1 ? ` × ${it.quantity}` : ''}`, money(it.unitPrice * it.quantity))).join('')}
        ${a.discount ? row(`Discount (${o.promoCode})`, '−' + money(a.discount)) : ''}
        ${a.delivery ? row('Local delivery', money(a.delivery)) : ''}
        ${a.tax ? row('Tax', money(a.tax)) : ''}
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:10px;border-top:2px solid ${G.green}">
        <tr><td style="padding-top:12px;font-size:13px;color:${G.gray}">${o.paymentIntentId ? 'Paid' : 'Recorded (no charge)'}</td>
        <td style="padding-top:12px;text-align:right;font-size:22px;color:${G.green}"><b>${money(a.total)}</b></td></tr>
      </table>

      ${forShop ? '' : `<p style="font-size:14px;color:${G.char};margin:22px 0 0">
        We'll call you when everything is packed${o.fulfilment === 'delivery'
          ? `, and deliver inside your ${esc((WINDOW_TEXT[o.deliveryWindow] || '').toLowerCase())} window — always within 24 hours of packing.`
          : ', and you can collect any time during opening hours.'}
        Anything you want to change, call ${SHOP.phone} <b>before</b> we start cutting.</p>`}
    </div>
    <div style="background:${G.cream};border-top:1px solid ${G.line};padding:16px 26px;font-size:12px;color:${G.gray};font-family:Arial,sans-serif">
      ${SHOP.name} · ${SHOP.address}<br>${SHOP.phone} · ${SHOP.email} · Halal certified, inspected facility
    </div>
  </div></div>`;
}

/**
 * Sends through whichever provider is configured. HTTP APIs are listed first
 * because outbound SMTP is unreliable from serverless platforms.
 * Returns true if the message actually went somewhere.
 */
export async function sendEmail(to, subject, html) {
  const from = process.env.MAIL_FROM || `${SHOP.name} <${SHOP.email}>`;

  if (process.env.POSTMARK_TOKEN) {
    const r = await fetch('https://api.postmarkapp.com/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                 'X-Postmark-Server-Token': process.env.POSTMARK_TOKEN },
      body: JSON.stringify({ From: from, To: to, Subject: subject, HtmlBody: html,
                             MessageStream: process.env.POSTMARK_STREAM || 'outbound' })
    });
    if (!r.ok) throw new Error('Postmark rejected the message: ' + (await r.text()).slice(0, 200));
    return true;
  }

  if (process.env.RESEND_API_KEY) {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({ from, to, subject, html })
    });
    if (!r.ok) throw new Error('Resend rejected the message: ' + (await r.text()).slice(0, 200));
    return true;
  }

  if (process.env.SMTP_HOST) {
    const { default: nodemailer } = await import('nodemailer');
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await t.sendMail({ from, to, subject, html });
    return true;
  }

  console.log(`[email skipped — no provider configured] ${subject} -> ${to}`);
  return false;
}

export function contactHtml({ name, email, phone, topic, message }) {
  return `<div style="font-family:Georgia,serif">
    <h2 style="color:${G.green}">${esc(topic || 'Message')} — ${esc(name)}</h2>
    <table style="border-collapse:collapse">${row('Email', email)}${row('Phone', phone || '—')}</table>
    <p style="font-size:14px;white-space:pre-wrap;margin-top:14px">${esc(message)}</p></div>`;
}
export function callbackHtml({ name, phone, best, zip, distance, cart }) {
  return `<div style="font-family:Georgia,serif">
    <h2 style="color:${G.green}">Callback request — outside the ring</h2>
    <table style="border-collapse:collapse">
      ${row('Name', name)}${row('Phone', phone)}${row('Best time', best || '—')}
      ${row('ZIP', zip || '—')}${row('Distance', distance ? distance + ' mi' : '—')}
    </table>
    <p style="font-size:13px">${(cart || []).map(esc).join('<br>') || 'No draft cut sheets.'}</p></div>`;
}
