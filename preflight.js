#!/usr/bin/env node
/**
 * Pre-launch check. Run `npm run preflight` before you point a domain at this.
 * Exits non-zero if anything would break, embarrass you, or leak data.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
const __dirname = process.cwd();

const problems = [], warnings = [], notes = [];
const read = f => { try { return fs.readFileSync(path.join(__dirname, f), 'utf8'); } catch { return null; } };

const index = read('public/index.html');
const env = process.env;

/* ---- blockers ---------------------------------------------------- */
if (!index) problems.push('public/index.html is missing — the two HTML files belong in public/.');
if (!read('public/admin.html')) problems.push('public/admin.html is missing — the two HTML files belong in public/.');

const onNetlify = fs.existsSync(path.join(__dirname, 'netlify.toml'));

if (!env.ADMIN_TOKEN) problems.push('ADMIN_TOKEN is not set. Without it the admin console cannot be used at all.');
else if (env.ADMIN_TOKEN.length < 24) problems.push(`ADMIN_TOKEN is only ${env.ADMIN_TOKEN.length} characters. Use 30+ random ones — it is the only thing protecting your pricing and your order list.`);
else if (/^(pick-a-long|changeme|test|admin|password)/i.test(env.ADMIN_TOKEN)) problems.push('ADMIN_TOKEN still looks like the example value. Generate a real one.');

const pk = index && (index.match(/stripePublishableKey:\s*"([^"]*)"/) || [])[1];
const sk = env.STRIPE_SECRET_KEY || '';
if (!sk && !pk) warnings.push('No Stripe keys at all — the site will run in demo mode and take no money. Fine for a soft launch, not for a real one.');
else {
  if (!sk) problems.push('index.html has a publishable key but STRIPE_SECRET_KEY is not set — payments will fail at the server.');
  if (!pk) problems.push('STRIPE_SECRET_KEY is set but index.html has no publishable key — the card form will never appear.');
  if (sk && pk) {
    const skLive = sk.startsWith('sk_live_'), pkLive = pk.startsWith('pk_live_');
    if (skLive !== pkLive) problems.push('Your Stripe keys are mismatched — one is live and the other is test. Payments will be rejected.');
    if (!skLive) warnings.push('Stripe is in TEST mode. Real cards will not work until you swap in the live keys.');
  }
  if (sk.startsWith('sk_') && index && index.includes(sk)) problems.push('Your Stripe SECRET key appears inside index.html. Remove it immediately and roll the key in the Stripe dashboard — that file is public.');
}

if (index && /\(913\) 555-0142|\+19135550142/.test(index)) problems.push('The placeholder phone number (913) 555-0142 is still in public/index.html. Customers outside the delivery radius are told to call it.');
if ((env.SHOP_PHONE || '').includes('555-0142')) problems.push('SHOP_PHONE in .env is still the placeholder.');

/* ---- warnings ---------------------------------------------------- */
const mailProvider = env.POSTMARK_TOKEN ? 'Postmark (HTTP)' : env.RESEND_API_KEY ? 'Resend (HTTP)' : env.SMTP_HOST ? 'SMTP' : null;
if (!mailProvider) warnings.push('No email provider configured — receipts and cut sheets will be logged instead of sent. Customers will get nothing.');
else notes.push(`Receipts will be sent via ${mailProvider}.`);
if (!env.MAIL_FROM) warnings.push('MAIL_FROM is not set; receipts go out from a default address and are more likely to land in spam.');
if (env.SMTP_HOST && !env.SMTP_USER) warnings.push('SMTP_HOST is set but SMTP_USER is not — check the provider credentials.');
if (onNetlify && mailProvider === 'SMTP') warnings.push('On Netlify, outbound SMTP from a function can be slow or blocked. Postmark or Resend over HTTP is the safer choice — set POSTMARK_TOKEN or RESEND_API_KEY.');

const dataDir = env.DATA_DIR || path.join(__dirname, 'data');
if (onNetlify) {
  notes.push('netlify.toml found — on Netlify, orders and the catalog are stored in Netlify Blobs and survive redeploys. DATA_DIR does not apply.');
} else {
  notes.push(`Order and catalog data will be written to: ${dataDir}`);
  if (!env.DATA_DIR) warnings.push('DATA_DIR is not set. On hosts with an ephemeral filesystem (Render free tier, Fly without a volume, most container platforms) every order and price change is wiped on each redeploy. Attach a persistent disk and point DATA_DIR at it.');
}

/* ---- catalog sanity ---------------------------------------------- */
const catFile = path.join(dataDir, 'catalog.json');
const SEED_PRICES = { 'lamb-whole':429, 'lamb-half':229, 'lamb-quarter':125, 'goat-whole':379,
  'goat-half':199, 'beef-quarter':1195, 'beef-half':2290, 'beef-whole':4450 };
if (fs.existsSync(catFile)) {
  const cat = JSON.parse(fs.readFileSync(catFile, 'utf8'));
  const untouched = Object.entries(SEED_PRICES).filter(([id, p]) => cat.products[id] && cat.products[id].price === p);
  if (untouched.length) warnings.push(`${untouched.length} share${untouched.length>1?'s are':' is'} still at the placeholder price I invented (${untouched.map(u=>u[0]).join(', ')}). Set real prices in the admin before launch.`);
  const live = Object.entries(cat.products).filter(([, p]) => p.status === 'available' || p.status === 'low');
  if (!live.length) problems.push('Every share is marked out of stock or coming soon — nobody can order anything.');
  else notes.push(`Orderable right now: ${live.map(([, p]) => p.label).join(', ')}`);
  const promos = (cat.promos || []).filter(p => p.active !== false);
  if (promos.length) notes.push(`Live discount codes: ${promos.map(p => `${p.code} (${p.type === 'percent' ? p.value + '%' : '$' + p.value})`).join(', ')}`);
} else {
  notes.push(onNetlify
    ? 'No local catalog — on Netlify it is seeded in Blobs on the first request. Set real prices in the admin once deployed.'
    : 'No catalog yet — it will be seeded with placeholder prices on first start. Set real ones in the admin.');
}

if (parseInt(process.versions.node, 10) < 18) problems.push(`Node ${process.versions.node} is too old — the ZIP lookup needs the built-in fetch from Node 18+.`);

/* ---- report ------------------------------------------------------ */
const line = s => console.log(s);
line('');
line('  Farsiland — pre-launch check');
line('  ' + '─'.repeat(58));
if (problems.length) { line('\n  MUST FIX before publishing:'); problems.forEach(p => line('   ✗ ' + p)); }
if (warnings.length) { line('\n  Worth fixing:'); warnings.forEach(w => line('   ! ' + w)); }
if (notes.length)    { line('\n  For information:'); notes.forEach(n => line('   · ' + n)); }
line('');
if (!problems.length && !warnings.length) line('  Everything checks out. Ship it.\n');
else if (!problems.length) line('  No blockers. Read the warnings, then ship it.\n');
else line(`  ${problems.length} blocker${problems.length > 1 ? 's' : ''}. Fix ${problems.length > 1 ? 'those' : 'that'} first.\n`);
process.exit(problems.length ? 1 : 0);
