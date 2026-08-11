/** File-backed store — used when running as a normal Node server. */
import fs from 'node:fs';
import path from 'node:path';
import { SEED } from './core.mjs';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const file = n => path.join(DATA_DIR, n);

// one-time migration for anyone upgrading from the older flat layout
for (const f of ['catalog.json', 'orders.json', 'messages.json', 'waitlist.json']) {
  const old = path.join(process.cwd(), f);
  if (fs.existsSync(old) && !fs.existsSync(file(f))) fs.renameSync(old, file(f));
}

const readJson = (n, fallback) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch { return fallback; } };
const writeJson = (n, v) => fs.writeFileSync(file(n), JSON.stringify(v, null, 2));

const HITS = new Map();

export const storage = {
  kind: 'file',
  dataDir: DATA_DIR,

  async getCatalog() {
    const c = readJson('catalog.json', null);
    if (c) return c;
    const seed = JSON.parse(JSON.stringify(SEED));
    writeJson('catalog.json', seed);
    return seed;
  },
  async putCatalog(c) { writeJson('catalog.json', c); return c; },

  async listOrders(limit = 500) {
    return readJson('orders.json', []).slice(-limit).reverse();
  },
  async saveOrder(order) {
    const all = readJson('orders.json', []);
    all.push(order);
    writeJson('orders.json', all);
  },
  async nextOrderNumber() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const stamp = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    const n = readJson('orders.json', []).filter(o => o.orderNumber.includes(`-${stamp}-`)).length + 1;
    return `FS-${stamp}-${String(n).padStart(3, '0')}`;
  },

  async append(kind, record) {
    const all = readJson(`${kind}.json`, []);
    all.push(record);
    writeJson(`${kind}.json`, all);
  },

  async allowed(key, limit, windowMs) {
    const now = Date.now();
    const list = (HITS.get(key) || []).filter(t => now - t < windowMs);
    if (list.length >= limit) return false;
    list.push(now); HITS.set(key, list);
    if (HITS.size > 5000) HITS.clear();
    return true;
  }
};
