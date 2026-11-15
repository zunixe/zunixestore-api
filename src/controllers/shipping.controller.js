const { getDb } = require('../config/database');
const { success, badRequest, notFound } = require('../utils/response');

const BITESHIP_BASE = 'https://api.biteship.com/v1';

// Kurir yang dikenali Biteship (aggregator — setara peran KiriminAja di Plugo).
const COURIER_NAMES = {
  jne: 'JNE', jnt: 'J&T', sicepat: 'SiCepat', anteraja: 'AnterAja',
  gosend: 'GoSend', grabexpress: 'GrabExpress', pos: 'POS Indonesia',
  tiki: 'TIKI', lion: 'Lion Parcel', ninja: 'Ninja Xpress', ide: 'ID Express',
  sap: 'SAP Express', paxel: 'Paxel', rpx: 'RPX', sentral: 'Sentral Cargo',
  jne_trucking: 'JNE Trucking', deliveree: 'Deliveree',
};

const storeRow = (db, storeId, key) => {
  const row = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(storeId, key);
  try { return row ? JSON.parse(row.value) : null; } catch { return row?.value ?? null; }
};

// Kurir aktif: `active_couriers` / `shipping_methods` JSON array, atau toggle shipping_<kode> per-nama.
const activeCouriersOf = (db, storeId) => {
  for (const key of ['active_couriers', 'shipping_methods']) {
    const list = storeRow(db, storeId, key);
    if (Array.isArray(list) && list.length) return list.map(String);
  }
  const toggled = Object.keys(COURIER_NAMES).filter((k) => storeRow(db, storeId, `shipping_${k}`) === 'true' || storeRow(db, storeId, `shipping_${k}`) === true);
  return toggled.length ? toggled : ['jne', 'sicepat'];
};

const biteshipKeyFor = (db, storeId) => {
  const key = storeRow(db, storeId, 'shipping_api_key');
  return (typeof key === 'string' && key) || process.env.BITESHIP_API_KEY || '';
};

// Fallback lokal saat Biteship belum dikonfigurasi — tarif flat per kurir.
const localRates = (couriers, origin) => couriers.map((c) => ({
  courier: COURIER_NAMES[c] || c.toUpperCase(),
  courier_code: c,
  service: 'Reguler',
  service_code: 'flat',
  price: 20000,
  duration: '1-3 hari',
  description: `Tarif flat ${origin?.city || origin?.postal_code ? 'dari ' + (origin.city || origin.postal_code) : ''}`.trim(),
}));

const getShippingRates = async (req, res, next) => {
  try {
    const { store_slug, destination_area_id, destination_postal_code, weight = 0, items } = req.body;

    if ((!store_slug && !req.params.id) || (!destination_area_id && !destination_postal_code)) {
      return badRequest(res, 'store_slug dan tujuan (area/kode pos) wajib diisi');
    }

    const db = getDb();
    const store = req.params.id
      ? db.prepare('SELECT id FROM stores WHERE id = ?').get(req.params.id)
      : db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(store_slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const origin = storeRow(db, store.id, 'shipping_origin');
    if (!origin) return badRequest(res, 'Alamat asal toko belum diatur — isi di Pengaturan → Metode Pengiriman');

    const couriers = activeCouriersOf(db, store.id);
    const apiKey = biteshipKeyFor(db, store.id);

    // Berat total dari item (field weight produk dalam gram, default 500g).
    let totalWeight = Number(weight) || 0;
    if (!totalWeight && Array.isArray(items)) {
      const stmt = db.prepare('SELECT description FROM products WHERE id = ? AND store_id = ?');
      for (const it of items) {
        const p = stmt.get(it.product_id, store.id);
        const d = (() => { try { return JSON.parse(p?.description || '{}'); } catch { return {}; } })();
        totalWeight += (Number(d.weight) || 500) * (Number(it.quantity) || 1);
      }
    }
    if (!totalWeight) totalWeight = 500;

    if (!apiKey) {
      return success(res, {
        origin,
        rates: localRates(couriers, origin),
        simulated: true,
        message: 'Biteship belum dikonfigurasi — menampilkan tarif flat',
      });
    }

    const itemsPayload = Array.isArray(items) && items.length
      ? items.map((i) => ({ name: String(i.name || 'Produk').slice(0, 50), value: Number(i.price) || 10000, weight: Math.max(1, Math.round(totalWeight / items.length)), quantity: Number(i.quantity) || 1 }))
      : [{ name: 'Paket', value: 100000, weight: totalWeight, quantity: 1 }];

    const body = {
      couriers: couriers.join(','),
      items: itemsPayload,
    };
    if (origin.area_id) body.origin_area_id = origin.area_id;
    else if (origin.postal_code) body.origin_postal_code = Number(origin.postal_code);
    if (destination_area_id) body.destination_area_id = destination_area_id;
    else if (destination_postal_code) body.destination_postal_code = Number(destination_postal_code);

    const response = await fetch(`${BITESHIP_BASE}/rates/couriers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      return success(res, { origin, rates: [], error: data.error || 'Gagal cek ongkir' });
    }

    const rates = (data.pricing || []).map((p) => ({
      courier: p.courier_name || p.courier_code || p.courier,
      courier_code: p.courier_code || p.courier,
      service: p.courier_service_name || p.service,
      service_code: p.courier_service_code || p.service,
      price: p.price,
      duration: p.duration || p.shipment_duration_range || '',
      description: p.description || '',
      available_cod: p.available_for_cash_on_delivery,
    }));

    return success(res, { origin, rates });
  } catch (err) { next(err); }
};

const searchAreas = async (req, res, next) => {
  try {
    const { q, store_slug } = req.query;
    if (!q) return badRequest(res, 'Query pencarian diperlukan');

    const db = getDb();
    let apiKey = process.env.BITESHIP_API_KEY || '';
    if (store_slug) {
      const store = db.prepare('SELECT id FROM stores WHERE slug = ?').get(store_slug);
      if (store) apiKey = biteshipKeyFor(db, store.id) || apiKey;
    }

    if (!apiKey) {
      return success(res, { areas: [], message: 'Biteship belum dikonfigurasi' });
    }

    const response = await fetch(`${BITESHIP_BASE}/maps/areas?input=${encodeURIComponent(q)}&type=single`, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    const data = await response.json();

    const areas = (data.areas || []).map((a) => ({
      id: a.id,
      name: a.name,
      administrative_division_level_1: a.administrative_division_level_1,
      administrative_division_level_2: a.administrative_division_level_2,
      postal_code: a.postal_code,
    }));

    return success(res, { areas });
  } catch (err) { next(err); }
};

// Webhook tracking Biteship — update status order saat paket sampai (auto-Selesai).
const handleTrackWebhook = async (req, res, next) => {
  try {
    const raw = req.body || {};
    const db = getDb();
    const awb = String(raw.courier_waybill_id || raw.waybill_id || raw.courier_tracking_id || raw.tracking_id || raw.order_id || '');
    const status = String(raw.status || '').toLowerCase();
    if (!awb) return success(res, null, 'No waybill — ignored');

    const order = db.prepare('SELECT id, status FROM orders WHERE shipping_awb = ?').get(awb);
    if (!order) return success(res, null, 'Order unknown — ignored');

    const map = { delivered: 'delivered', returned: 'cancelled', rejected: 'cancelled', disposed: 'cancelled', cancelled: 'cancelled' };
    const nextStatus = map[status];
    const trackStatus = status || 'update';
    if (nextStatus && order.status !== nextStatus) {
      db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?").run(nextStatus, order.id);
    }
    try {
      db.prepare('INSERT INTO order_events (id, order_id, type, message, actor) VALUES (?,?,?,?,?)')
        .run(require('../config/database').uuid(), order.id, 'tracking', `Tracking: ${trackStatus}`, 'biteship');
    } catch { /* opsional */ }
    return success(res, null, 'Tracking processed');
  } catch (err) { next(err); }
};

module.exports = { getShippingRates, searchAreas, handleTrackWebhook, COURIER_NAMES };
