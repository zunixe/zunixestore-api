const { getDb } = require('../config/database');
const { success, badRequest, notFound } = require('../utils/response');

const BITESHIP_BASE = 'https://api.biteship.com/v1';
const BITESHIP_KEY = process.env.BITESHIP_API_KEY || '';

const getShippingRates = async (req, res, next) => {
  try {
    const { store_slug, destination_city_id, destination_district_id, destination_postal_code, weight, items } = req.body;

    if (!store_slug || !destination_city_id || !weight) {
      return badRequest(res, 'store_slug, destination_city_id, dan weight wajib diisi');
    }

    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(store_slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const originRow = db.prepare("SELECT value FROM store_settings WHERE store_id = ? AND key = 'shipping_origin'").get(store.id);
    if (!originRow) return badRequest(res, 'Alamat asal toko belum diatur');
    const origin = JSON.parse(originRow.value);

    const couriersRow = db.prepare("SELECT value FROM store_settings WHERE store_id = ? AND key = 'active_couriers'").get(store.id);
    const activeCouriers = couriersRow ? JSON.parse(couriersRow.value) : ['jne', 'jnt', 'sicepat', 'tiki', 'pos'];

    if (!BITESHIP_KEY) {
      return success(res, {
        origin: origin,
        destination: { city_id: destination_city_id },
        rates: [],
        message: 'Biteship API key not configured',
      });
    }

    const itemsPayload = items || [{ name: 'Product', value: 100000, weight: weight, quantity: 1 }];

    const response = await fetch(`${BITESHIP_BASE}/rates/couriers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BITESHIP_KEY}`,
      },
      body: JSON.stringify({
        origin_area_id: destination_postal_code ? undefined : origin.district_id,
        origin_postal_code: destination_postal_code ? origin.postal_code : undefined,
        destination_area_id: destination_district_id,
        destination_postal_code: destination_postal_code || undefined,
        couriers: activeCouriers.join(','),
        items: itemsPayload,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return success(res, { origin, rates: [], error: data.error || 'Gagal cek ongkir' });
    }

    const rates = (data.pricing || []).map((p) => ({
      courier: p.courier_name || p.courier,
      courier_code: p.courier_code || p.courier,
      service: p.courier_service_name || p.service,
      service_code: p.courier_service_code,
      price: p.price,
      duration: p.duration || p.shipment_duration_range || '',
      description: p.description || '',
    }));

    return success(res, { origin, destination: { city_id: destination_city_id, district_id: destination_district_id }, rates });
  } catch (err) { next(err); }
};

const getInstantRates = async (req, res, next) => {
  try {
    const { store_slug, destination_lat, destination_lng } = req.body;

    if (!store_slug || !destination_lat || !destination_lng) {
      return badRequest(res, 'store_slug, destination_lat, dan destination_lng wajib diisi');
    }

    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(store_slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const originRow = db.prepare("SELECT value FROM store_settings WHERE store_id = ? AND key = 'shipping_origin'").get(store.id);
    if (!originRow) return badRequest(res, 'Alamat asal toko belum diatur');
    const origin = JSON.parse(originRow.value);

    const instantRow = db.prepare("SELECT value FROM store_settings WHERE store_id = ? AND key = 'active_instant_couriers'").get(store.id);
    const activeInstant = instantRow ? JSON.parse(instantRow.value) : ['gosend', 'grabexpress'];

    if (!BITESHIP_KEY) {
      return success(res, { rates: [], message: 'Biteship API key not configured' });
    }

    const response = await fetch(`${BITESHIP_BASE}/rates/couriers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${BITESHIP_KEY}`,
      },
      body: JSON.stringify({
        origin_latitude: origin.lat,
        origin_longitude: origin.lng,
        destination_latitude: destination_lat,
        destination_longitude: destination_lng,
        couriers: activeInstant.join(','),
        items: [{ name: 'Package', value: 100000, weight: 1000, quantity: 1 }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      return success(res, { rates: [], error: data.error || 'Gagal cek ongkir instan' });
    }

    const rates = (data.pricing || []).map((p) => ({
      courier: p.courier_name || p.courier,
      courier_code: p.courier_code || p.courier,
      service: p.courier_service_name || p.service,
      price: p.price,
      type: 'instant',
    }));

    return success(res, { rates });
  } catch (err) { next(err); }
};

const searchAreas = async (req, res, next) => {
  try {
    const { q } = req.query;
    if (!q) return badRequest(res, 'Query pencarian diperlukan');

    if (!BITESHIP_KEY) {
      return success(res, { areas: [], message: 'Biteship API key not configured' });
    }

    const response = await fetch(`${BITESHIP_BASE}/maps/areas?input=${encodeURIComponent(q)}&type=single`, {
      headers: { 'Authorization': `Bearer ${BITESHIP_KEY}` },
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

module.exports = { getShippingRates, getInstantRates, searchAreas };
