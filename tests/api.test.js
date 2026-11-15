/* Test endpoint API pakai supertest + DB sqlite :memory: (fresh per proses).
   Seeder bikin akun + toko demo sendiri supaya tidak menyentuh DB asli. */
process.env.DB_PATH = ':memory:';
process.env.NODE_ENV = 'test';

import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
// createRequire = require Node asli → share cache modul CJS dengan app
// (import vitest akan membuka instance :memory: kedua).
const require = createRequire(import.meta.url);
const app = require('../src/app');
const { getDb } = require('../src/config/database');

let token, storeId, productId, orderId, customerId, discountId;
const EMAIL = 'vitest@zunixe.id';

beforeAll(async () => {
  const r = await request(app).post('/api/auth/register').send({ full_name: 'Vitest', email: EMAIL, password: 'vitest123' });
  token = r.body.data.token;
  const s = await request(app).post('/api/stores').set('Authorization', `Bearer ${token}`).send({ name: 'Toko Vitest', slug: 'toko-vitest' });
  storeId = s.body.data.id;
});

const auth = (r) => r.set('Authorization', `Bearer ${token}`);

describe('Auth', () => {
  it('register + login + me', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'vitest123' });
    expect(login.status).toBe(200);
    expect(login.body.data.token).toBeTruthy();
    const me = await auth(request(app).get('/api/auth/me'));
    expect(me.body.data.email).toBe(EMAIL);
  });
  it('login salah password → 401', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: EMAIL, password: 'salah' });
    expect(r.status).toBe(401);
  });
});

describe('Stores', () => {
  it('list toko milik user', async () => {
    const r = await auth(request(app).get('/api/stores'));
    expect(r.body.data.some((s) => s.id === storeId)).toBe(true);
  });
});

describe('Products', () => {
  it('buat + list + update + delete', async () => {
    const c = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'P1', price: 10000, stock: 5 });
    expect(c.status).toBe(201);
    productId = c.body.data.id;
    const l = await auth(request(app).get(`/api/stores/${storeId}/products`));
    expect(l.body.data.total).toBe(1);
    const u = await auth(request(app).put(`/api/stores/${storeId}/products/${productId}`)).send({ price: 20000 });
    expect(u.body.data.price).toBe(20000);
    const d = await auth(request(app).delete(`/api/stores/${storeId}/products/${productId}`));
    expect(d.body.status).toBe('success');
  });

  it('kuota paket: produk ke-31 di Lite ditolak 403', async () => {
    getDb().prepare('UPDATE stores SET plan=? WHERE id=?').run('lite', storeId); // paksa lite: limit 30
    for (let i = 0; i < 30; i++) {
      await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: `q${i}`, price: 1 });
    }
    const dbg = getDb().prepare('SELECT plan FROM stores WHERE id=?').get(storeId);
    const cnt = getDb().prepare('SELECT COUNT(*) c FROM products WHERE store_id=?').get(storeId).c;
    console.log('DEBUG plan:', dbg?.plan, 'count:', cnt);
    const over = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'over', price: 1 });
    expect(over.status).toBe(403);
    expect(over.body.message).toMatch(/Kuota produk/);
    // upgrade ke basic → boleh lagi (limit 100)
    getDb().prepare('UPDATE stores SET plan=? WHERE id=?').run('basic', storeId);
    const ok = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'ok', price: 1 });
    expect(ok.status).toBe(201);
    productId = ok.body.data.id;
  });
});

describe('Orders & Customers & Discounts', () => {
  it('buat order (field quantity), list, update status', async () => {
    const c = await auth(request(app).post(`/api/stores/${storeId}/orders`))
      .send({ customer_name: 'Budi', items: [{ product_id: productId, product_name: 'ok', quantity: 2, price: 1000 }] });
    expect(c.status).toBe(201);
    orderId = c.body.data.id;
    const l = await auth(request(app).get(`/api/stores/${storeId}/orders`));
    expect(l.body.data.total).toBeGreaterThanOrEqual(1);
    const st = await auth(request(app).put(`/api/stores/${storeId}/orders/${orderId}/status`)).send({ status: 'paid' });
    expect(st.body.status).toBe('success');
  });
  it('update order penuh: resi/kurir/ongkir + konfirmasi bayar set paid_at', async () => {
    const u = await auth(request(app).put(`/api/stores/${storeId}/orders/${orderId}`))
      .send({ shipping_courier: 'jne', shipping_awb: 'RESI123', shipping_cost: 15000, payment_status: 'paid', payment_method: 'Transfer Bank' });
    expect(u.body.status).toBe('success');
    const o = u.body.data;
    expect(o.shipping_courier).toBe('jne');
    expect(o.shipping_awb).toBe('RESI123');
    expect(o.shipping_cost).toBe(15000);
    expect(o.payment_status).toBe('paid');
    expect(o.payment_method).toBe('Transfer Bank');
    expect(o.paid_at).toBeTruthy();
    // kembalikan ke unpaid → paid_at terhapus
    const u2 = await auth(request(app).put(`/api/stores/${storeId}/orders/${orderId}`)).send({ payment_status: 'unpaid' });
    expect(u2.body.data.paid_at).toBeNull();
  });
  it('create order dengan ongkir & langsung lunas', async () => {
    const c = await auth(request(app).post(`/api/stores/${storeId}/orders`))
      .send({ customer_name: 'Ani', items: [{ product_name: 'x', quantity: 1, price: 5000 }], shipping_cost: 10000, payment_status: 'paid', payment_method: 'COD' });
    expect(c.status).toBe(201);
    const o = c.body.data;
    expect(o.total).toBe(15000);
    expect(o.payment_status).toBe('paid');
    expect(o.status).toBe('processing');
    expect(o.paid_at).toBeTruthy();
  });
  it('customer CRUD', async () => {
    const c = await auth(request(app).post(`/api/stores/${storeId}/customers`)).send({ name: 'C1', email: 'c1@x.id' });
    expect(c.status).toBe(201);
    customerId = c.body.data.id;
    const l = await auth(request(app).get(`/api/stores/${storeId}/customers`));
    expect(l.body.data.length ?? l.body.data.items?.length).toBeGreaterThanOrEqual(1);
  });
  it('discount CRUD', async () => {
    const c = await auth(request(app).post(`/api/stores/${storeId}/discounts`)).send({ name: 'D10', code: 'D10', type: 'percentage', value: 10 });
    expect(c.status).toBe(201);
    discountId = c.body.data.id;
    const l = await auth(request(app).get(`/api/stores/${storeId}/discounts`));
    expect(l.body.data.length ?? l.body.data.items?.length).toBeGreaterThanOrEqual(1);
  });
});

describe('Subscription', () => {
  it('plans berisi 4 tier Plugo', async () => {
    const r = await auth(request(app).get(`/api/stores/${storeId}/subscription/plans`));
    expect(Object.keys(r.body.data)).toEqual(['lite', 'basic', 'business', 'enterprise']);
    expect(r.body.data.lite.quota.products).toBe(30);
    expect(r.body.data.enterprise.price).toBeNull();
  });
  it('usage menghitung kuota nyata', async () => {
    const r = await auth(request(app).get(`/api/stores/${storeId}/subscription/usage`));
    const u = r.body.data.usage;
    expect(u.products.limit).toBe(100); // plan basic (diset di test produk)
    expect(u.products.used).toBe(31);
    expect(u.owners.used).toBe(1);
  });
  it('subscribe → plan berubah + langganan lama diganti', async () => {
    const r = await auth(request(app).post(`/api/stores/${storeId}/subscription`)).send({ plan: 'business' });
    expect(r.status).toBe(201);
    const r2 = await auth(request(app).post(`/api/stores/${storeId}/subscription`)).send({ plan: 'lite' });
    expect(r2.status).toBe(201);
    const sub = await auth(request(app).get(`/api/stores/${storeId}/subscription`));
    expect(sub.body.data.plan).toBe('lite');
    const replaced = getDb().prepare("SELECT COUNT(*) c FROM subscriptions WHERE store_id=? AND status='replaced'").get(storeId).c;
    expect(replaced).toBe(1);
    getDb().prepare('UPDATE stores SET plan=? WHERE id=?').run('basic', storeId);
  });
  it('billing memuat riwayat', async () => {
    const r = await auth(request(app).get(`/api/stores/${storeId}/subscription/billing`));
    expect(r.body.data.length).toBeGreaterThanOrEqual(1);
  });
  it('subscribe plan invalid / enterprise → 400', async () => {
    const e = await auth(request(app).post(`/api/stores/${storeId}/subscription`)).send({ plan: 'enterprise' });
    expect(e.status).toBe(400);
  });
});

describe('Plan gating di settings', () => {
  const setPlan = (p) => getDb().prepare('UPDATE stores SET plan=? WHERE id=?').run(p, storeId);
  it('lite: review/loyalty/open-order ditolak, lokasi >1 ditolak', async () => {
    setPlan('lite');
    const rev = await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ review_settings: JSON.stringify({ enabled: true }) });
    expect(rev.status).toBe(403);
    expect(rev.body.message).toMatch(/Basic/);
    const loy = await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ loyalty_program: JSON.stringify({ enabled: true }) });
    expect(loy.status).toBe(403);
    expect(loy.body.message).toMatch(/Business/);
    const oo = await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ open_order_schedules: JSON.stringify([{ id: 'x' }]) });
    expect(oo.status).toBe(403);
    const loc = await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ locations: JSON.stringify([{ n: 'a' }, { n: 'b' }]) });
    expect(loc.status).toBe(403);
  });
  it('basic: review & open-order lolos, loyalty tetap 403', async () => {
    setPlan('basic');
    const rev = await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ review_settings: JSON.stringify({ enabled: true }) });
    expect(rev.status).toBe(200);
    const oo = await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ open_order_schedules: JSON.stringify([{ id: 'x' }]) });
    expect(oo.status).toBe(200);
    const loy = await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ loyalty_program: JSON.stringify({ enabled: true }) });
    expect(loy.status).toBe(403);
  });
  it('business: loyalty lolos', async () => {
    setPlan('business');
    const loy = await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ loyalty_program: JSON.stringify({ enabled: true }) });
    expect(loy.status).toBe(200);
    setPlan('basic');
  });
});

describe('Public', () => {
  it('resolve by slug mengembalikan store + settings terfilter', async () => {
    const r = await request(app).get('/api/public/resolve?domain=toko-vitest');
    expect(r.status).toBe(200);
    expect(r.body.data.store.slug).toBe('toko-vitest');
  });
  it('resolve domain tak dikenal → 404', async () => {
    const r = await request(app).get('/api/public/resolve?domain=nothing-xyz');
    expect(r.status).toBe(404);
  });
  it('product_preferences terekspos via resolve', async () => {
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ product_preferences: JSON.stringify({ show_new_products: false, stock_visibility: 'always' }) });
    const r = await request(app).get('/api/public/resolve?domain=toko-vitest');
    const pp = typeof r.body.data.settings.product_preferences === 'string'
      ? JSON.parse(r.body.data.settings.product_preferences) : r.body.data.settings.product_preferences;
    expect(pp.stock_visibility).toBe('always');
  });
  it('hide_sold_out menyaring produk stok 0 dari katalog publik', async () => {
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'StokNol', price: 1000, stock: 0 });
    const pid = p.body.data.id;
    const list0 = await request(app).get('/api/public/store/toko-vitest/products?limit=100');
    expect(list0.body.data.items.some((x) => x.id === pid)).toBe(true);
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ product_preferences: JSON.stringify({ hide_sold_out: true }) });
    const list1 = await request(app).get('/api/public/store/toko-vitest/products?limit=100');
    expect(list1.body.data.items.some((x) => x.id === pid)).toBe(false);
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ product_preferences: JSON.stringify({ hide_sold_out: false }) });
    await auth(request(app).delete(`/api/stores/${storeId}/products/${pid}`));
  });
  it('hide_sold_out tetap menampilkan produk preorder', async () => {
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'PO-Nol', price: 1000, stock: 0, description: JSON.stringify({ availability: 'preorder' }) });
    const pid = p.body.data.id;
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ product_preferences: JSON.stringify({ hide_sold_out: true }) });
    const list = await request(app).get('/api/public/store/toko-vitest/products?limit=100');
    expect(list.body.data.items.some((x) => x.id === pid)).toBe(true);
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ product_preferences: JSON.stringify({ hide_sold_out: false }) });
    await auth(request(app).delete(`/api/stores/${storeId}/products/${pid}`));
  });
  it('order mengurangi stok + notifikasi stok menipis saat lewati ambang', async () => {
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ product_preferences: JSON.stringify({ low_stock_alert: true, low_stock_threshold: 5 }) });
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'AlertProd', price: 1000, stock: 6 });
    const pid = p.body.data.id;
    const o = await request(app).post('/api/public/orders').send({
      store_slug: 'toko-vitest', customer_name: 'Ana', customer_email: 'ana@t.com', shipping_address: 'Jakarta',
      items: [{ product_id: pid, quantity: 2, price: 1000 }],
    });
    expect(o.status).toBe(201);
    const prod = getDb().prepare('SELECT stock FROM products WHERE id=?').get(pid);
    expect(prod.stock).toBe(4);
    const notifs = await auth(request(app).get(`/api/stores/${storeId}/notifications`));
    expect(notifs.body.data.unread).toBeGreaterThanOrEqual(1);
    expect(notifs.body.data.items.some((n) => n.type === 'low_stock' && n.ref_id === pid)).toBe(true);
    const nid = notifs.body.data.items.find((n) => n.ref_id === pid).id;
    await auth(request(app).put(`/api/stores/${storeId}/notifications/${nid}/read`));
    const after = await auth(request(app).get(`/api/stores/${storeId}/notifications`));
    expect(after.body.data.items.find((n) => n.id === nid).read_at).toBeTruthy();
    await auth(request(app).delete(`/api/stores/${storeId}/products/${pid}`));
  });
  it('order_preferences: min kuantitas & batas order belum bayar ditegakkan', async () => {
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ order_preferences: JSON.stringify({ min_qty_enabled: true, min_qty: 5 }) });
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'QtyProd', price: 1000, stock: 50 });
    const pid = p.body.data.id;
    const bad = await request(app).post('/api/public/orders').send({
      store_slug: 'toko-vitest', customer_name: 'Min', customer_email: 'min@t.com', shipping_address: 'Jl',
      items: [{ product_id: pid, quantity: 2, price: 1000 }],
    });
    expect(bad.status).toBe(400);
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ order_preferences: JSON.stringify({ min_qty_enabled: false }) });
    const ok = await request(app).post('/api/public/orders').send({
      store_slug: 'toko-vitest', customer_name: 'Min', customer_email: 'min@t.com', shipping_address: 'Jl',
      items: [{ product_id: pid, quantity: 2, price: 1000 }],
    });
    expect(ok.status).toBe(201);
    await auth(request(app).delete(`/api/stores/${storeId}/products/${pid}`));
  });
  it('buyer cancel: digate pref + stok kembali', async () => {
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'CancelProd', price: 1000, stock: 10 });
    const pid = p.body.data.id;
    const o = await request(app).post('/api/public/orders').send({
      store_slug: 'toko-vitest', customer_name: 'Can', customer_email: 'can@t.com', shipping_address: 'Jl',
      items: [{ product_id: pid, quantity: 3, price: 1000 }],
    });
    const code = o.body.data.order_code;
    // tanpa pref → ditolak
    const no = await request(app).post(`/api/public/orders/${code}/cancel`);
    expect(no.status).toBe(400);
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ order_preferences: JSON.stringify({ buyer_cancel_enabled: true }) });
    const trk = await request(app).get(`/api/public/orders/${code}`);
    expect(trk.body.data.can_cancel).toBe(true);
    const yes = await request(app).post(`/api/public/orders/${code}/cancel`);
    expect(yes.status).toBe(200);
    expect(getDb().prepare('SELECT stock FROM products WHERE id=?').get(pid).stock).toBe(10);
    await auth(request(app).delete(`/api/stores/${storeId}/products/${pid}`));
  });
  it('auto-cancel order unpaid setelah N hari', async () => {
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ order_preferences: JSON.stringify({ auto_cancel_days: 1 }) });
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'AutoProd', price: 1000, stock: 5 });
    const pid = p.body.data.id;
    const o = await request(app).post('/api/public/orders').send({
      store_slug: 'toko-vitest', customer_name: 'Auto', customer_email: 'auto@t.com', shipping_address: 'Jl',
      items: [{ product_id: pid, quantity: 1, price: 1000 }],
    });
    getDb().prepare("UPDATE orders SET created_at = datetime('now','-3 days') WHERE order_code=?").run(o.body.data.order_code);
    await auth(request(app).get(`/api/stores/${storeId}/orders`));
    const st = getDb().prepare('SELECT status FROM orders WHERE order_code=?').get(o.body.data.order_code);
    expect(st.status).toBe('cancelled');
    await auth(request(app).put(`/api/stores/${storeId}/settings`)).send({ order_preferences: JSON.stringify({ auto_cancel_days: 0 }) });
    await auth(request(app).delete(`/api/stores/${storeId}/products/${pid}`));
  });
  it('diskon bertarget produk hanya memotong item yang cocok', async () => {
    const p1 = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'DTarget', price: 10000, stock: 10 });
    const p2 = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'DOther', price: 50000, stock: 10 });
    const disc = await auth(request(app).post(`/api/stores/${storeId}/discounts`)).send({ code: 'TARGET50', type: 'percentage', value: 50, product_ids: [p1.body.data.id] });
    expect(disc.status).toBe(201);
    const items = encodeURIComponent(JSON.stringify([
      { product_id: p1.body.data.id, price: 10000, quantity: 1 },
      { product_id: p2.body.data.id, price: 50000, quantity: 1 },
    ]));
    const v = await request(app).get(`/api/public/store/toko-vitest/discounts/validate?code=TARGET50&subtotal=60000&items=${items}`);
    expect(v.body.data.discount_amount).toBe(5000); // 50% dari 10000 saja
    const onlyOther = encodeURIComponent(JSON.stringify([{ product_id: p2.body.data.id, price: 50000, quantity: 1 }]));
    const nv = await request(app).get(`/api/public/store/toko-vitest/discounts/validate?code=TARGET50&subtotal=50000&items=${onlyOther}`);
    expect(nv.status).toBe(400);
    await auth(request(app).delete(`/api/stores/${storeId}/products/${p1.body.data.id}`));
    await auth(request(app).delete(`/api/stores/${storeId}/products/${p2.body.data.id}`));
  });
  it('produk out_of_stock=hidden disaring saat stok habis', async () => {
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'Hidden0', price: 1000, stock: 0, description: JSON.stringify({ out_of_stock: 'hidden' }) });
    const pid = p.body.data.id;
    const list = await request(app).get('/api/public/store/toko-vitest/products?limit=100');
    expect(list.body.data.items.some((x) => x.id === pid)).toBe(false);
    await auth(request(app).delete(`/api/stores/${storeId}/products/${pid}`));
  });
});

describe('Shipping & Payment Gateway', () => {
  it('rates tanpa shipping_origin → 400', async () => {
    const r = await request(app).post('/api/public/shipping/rates')
      .send({ store_slug: 'toko-vitest', destination_postal_code: '12190' });
    expect(r.status).toBe(400);
  });
  it('rates dengan origin → tarif flat fallback saat Biteship belum diset', async () => {
    await auth(request(app).put(`/api/stores/${storeId}/settings`))
      .send({ shipping_origin: JSON.stringify({ postal_code: '12110', label: 'Jakarta Selatan' }), shipping_jne: 'true', shipping_sicepat: 'true' });
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'RateProd', price: 5000, stock: 5, description: JSON.stringify({ weight: 300 }) });
    const r = await request(app).post('/api/public/shipping/rates')
      .send({ store_slug: 'toko-vitest', destination_postal_code: '40115', items: [{ product_id: p.body.data.id, price: 5000, quantity: 2 }] });
    expect(r.status).toBe(200);
    const rates = r.body.data.rates;
    expect(rates.length).toBeGreaterThanOrEqual(2);
    expect(rates.map((x) => x.courier_code).sort()).toEqual(['jne', 'sicepat']);
    await auth(request(app).delete(`/api/stores/${storeId}/products/${p.body.data.id}`));
  });
  it('areas tanpa API key → kosong tapi tidak error', async () => {
    const r = await request(app).get('/api/public/shipping/areas?q=tebet');
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.data.areas)).toBe(true);
  });
  it('checkout payment: order nyata → token simulasi saat gateway belum diset', async () => {
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'SnapProd', price: 8000, stock: 3 });
    const o = await request(app).post('/api/public/orders').send({
      store_slug: 'toko-vitest', customer_name: 'Pay', customer_email: 'pay@t.com', shipping_address: 'Jl',
      items: [{ product_id: p.body.data.id, quantity: 1, price: 8000 }], payment_method: 'transfer_bank',
    });
    const code = o.body.data.order_code;
    const s = await request(app).post('/api/payment/checkout').send({ order_code: code, customer_email: 'pay@t.com', customer_name: 'Pay', total: 8000 });
    expect(s.status).toBe(201);
    expect(s.body.data.token).toMatch(/^sim-token-/);
    const st = await request(app).get(`/api/payment/status/${code}`);
    expect(st.body.data.payment_status).toBe('unpaid');
    await auth(request(app).delete(`/api/stores/${storeId}/products/${p.body.data.id}`));
  });
  it('webhook iPaymu: status_code 1 → lunas; -2 → batal + stok kembali', async () => {
    const p = await auth(request(app).post(`/api/stores/${storeId}/products`)).send({ name: 'HookProd', price: 5000, stock: 4 });
    const pid = p.body.data.id;
    const mk = async () => (await request(app).post('/api/public/orders').send({
      store_slug: 'toko-vitest', customer_name: 'W', customer_email: 'w@t.com', shipping_address: 'Jl',
      items: [{ product_id: pid, quantity: 2, price: 5000 }],
    })).body.data.order_code;
    const c1 = await mk();
    await request(app).post('/api/payment/webhook').send({ reference_id: c1, status_code: '1', trx_id: '12345' });
    expect(getDb().prepare('SELECT payment_status, status FROM orders WHERE order_code=?').get(c1)).toEqual({ payment_status: 'paid', status: 'processing' });
    const c2 = await mk();
    expect(getDb().prepare('SELECT stock FROM products WHERE id=?').get(pid).stock).toBe(0);
    await request(app).post('/api/payment/webhook').send({ reference_id: c2, status_code: '-2', trx_id: '12346' });
    const o2 = getDb().prepare('SELECT payment_status, status FROM orders WHERE order_code=?').get(c2);
    expect(o2.payment_status).toBe('failed');
    expect(o2.status).toBe('cancelled');
    expect(getDb().prepare('SELECT stock FROM products WHERE id=?').get(pid).stock).toBe(2);
    await auth(request(app).delete(`/api/stores/${storeId}/products/${pid}`));
  });
});

describe('Theme', () => {
  it('list + active + activate', async () => {
    const t = await auth(request(app).get(`/api/stores/${storeId}/theme`));
    expect(Array.isArray(t.body.data)).toBe(true);
    const a = await auth(request(app).get(`/api/stores/${storeId}/theme/active`));
    expect(a.body.data).toBeTruthy();
    const act = await auth(request(app).put(`/api/stores/${storeId}/theme/activate`)).send({ themeId: 'tpl-basic-shop' });
    expect(act.body.status).toBe('success');
  });
});
