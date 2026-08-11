/** Netlify Blobs store — used when running as a Netlify Function.
 *  Serverless has no writable disk, so catalog, orders, messages and the
 *  rate-limit counters all live in Blobs instead. */
import { getStore } from '@netlify/blobs';
import { SEED } from './core.mjs';

// strong consistency: an order must be readable the instant after it is written
const store = name => getStore({ name, consistency: 'strong' });

export const storage = {
  kind: 'blobs',

  async getCatalog() {
    const s = store('farsiland-catalog');
    const c = await s.get('catalog', { type: 'json' }).catch(() => null);
    if (c) return c;
    const seed = JSON.parse(JSON.stringify(SEED));
    await s.setJSON('catalog', seed);
    return seed;
  },
  async putCatalog(c) { await store('farsiland-catalog').setJSON('catalog', c); return c; },

  async listOrders(limit = 200) {
    const s = store('farsiland-orders');
    const { blobs } = await s.list();
    // keys are FS-YYMMDD-NNN, so lexicographic sort is chronological
    const keys = blobs.map(b => b.key).sort().reverse().slice(0, limit);
    const out = [];
    for (const k of keys) {
      const o = await s.get(k, { type: 'json' }).catch(() => null);
      if (o) out.push(o);
    }
    return out;
  },
  async saveOrder(order) { await store('farsiland-orders').setJSON(order.orderNumber, order); },

  async nextOrderNumber() {
    const d = new Date(), p = n => String(n).padStart(2, '0');
    const stamp = `${String(d.getFullYear()).slice(2)}${p(d.getMonth() + 1)}${p(d.getDate())}`;
    const s = store('farsiland-orders');
    const { blobs } = await s.list({ prefix: `FS-${stamp}-` });
    let n = blobs.length + 1;
    // two orders can land in the same instant; step past anything already taken
    for (let i = 0; i < 20; i++) {
      const candidate = `FS-${stamp}-${String(n).padStart(3, '0')}`;
      const taken = await s.get(candidate, { type: 'json' }).catch(() => null);
      if (!taken) return candidate;
      n++;
    }
    return `FS-${stamp}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  },

  async append(kind, record) {
    await store(`farsiland-${kind}`).setJSON(`${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, record);
  },

  /** In-memory counters don't survive between invocations, so throttling
   *  state goes in Blobs too. Only used on the public write endpoints. */
  async allowed(key, limit, windowMs) {
    const s = store('farsiland-throttle');
    const safe = key.replace(/[^a-z0-9.-]/gi, '_');
    const now = Date.now();
    const prev = (await s.get(safe, { type: 'json' }).catch(() => null)) || [];
    const list = prev.filter(t => now - t < windowMs);
    if (list.length >= limit) return false;
    list.push(now);
    await s.setJSON(safe, list);
    return true;
  }
};
