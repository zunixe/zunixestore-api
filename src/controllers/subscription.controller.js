const { getDb, uuid } = require('../config/database');
const { success, created, error } = require('../utils/response');

/* Tier paket mengikuti Plugo (/settings/plans). quota.products=null berarti
   tak terbatas. features dipakai untuk daftar checklist di modal Beli Paket. */
const PLANS = {
  lite: {
    name: 'Lite', price: 0, icon: 'rocket',
    tagline: 'Untuk kamu yang baru mulai bisnis online',
    quota: { products: 30, owners: 1, staff: 0, locations: 1, manual_payment_quota: 0 },
    features: ['30 produk', 'Pesanan unlimited', 'Toko online', 'Hubungkan & beli domain unik'],
  },
  basic: {
    name: 'Basic', price: 150000, icon: 'rocket',
    tagline: 'Untuk kamu yang punya bisnis dengan penjualan Rp 50 juta per bulan',
    quota: { products: 100, owners: 1, staff: 1, locations: 1, manual_payment_quota: 5 },
    features: ['100 produk', 'Penilaian dan ulasan produk', 'Hilangkan merek "Zunixe" dari toko online', 'Halaman link-in-bio'],
  },
  business: {
    name: 'Business', price: 450000, icon: 'rocket',
    tagline: 'Untuk kamu yang punya bisnis dengan penjualan Rp 300 juta per bulan',
    quota: { products: 500, owners: 1, staff: 5, locations: 3, manual_payment_quota: 20 },
    features: ['500 produk', 'Gratis domain', 'Program keanggotaan pelanggan', 'Bantuan 24/7'],
  },
  enterprise: {
    name: 'Enterprise', price: null, icon: 'headset',
    tagline: 'Upgrade atau hubungi kami demi mendapatkan pelayanan terbaik untuk bisnis berskala besar.',
    quota: { products: null, owners: 1, staff: null, locations: null, manual_payment_quota: null },
    features: ['Produk tak terbatas', 'Periode Laporan Tanpa Batas', 'Dukungan Prioritas'],
  },
};

// Alias untuk data lama: pro → business; key tak dikenal → lite.
const PLAN_ALIASES = { pro: 'business' };
const normalizePlan = (p) => PLANS[p] ? p : (PLAN_ALIASES[p] || 'lite');

const PLAN_RANK = { lite: 0, basic: 1, business: 2, enterprise: 3 };

/* Fitur yang dikunci per paket (minimum paket yang dibutuhkan). */
const FEATURE_MIN_PLAN = {
  reviews: 'basic',          // Penilaian dan ulasan produk
  remove_branding: 'basic',  // Hilangkan merek dari toko online
  link_in_bio: 'basic',      // Halaman link-in-bio
  open_order: 'basic',       // Kalender Open Order
  loyalty: 'business',       // Program keanggotaan pelanggan
  free_domain: 'business',   // Gratis domain
  support_24_7: 'business',
  unlimited_products: 'enterprise',
  unlimited_reports: 'enterprise',
  priority_support: 'enterprise',
};

const hasFeature = (planKey, feature) => PLAN_RANK[normalizePlan(planKey)] >= PLAN_RANK[FEATURE_MIN_PLAN[feature] || 'enterprise'];

const FEATURE_LABEL = {
  reviews: 'Penilaian dan ulasan produk',
  remove_branding: 'Menghilangkan merek dari toko online',
  link_in_bio: 'Halaman link-in-bio',
  open_order: 'Kalender Open Order',
  loyalty: 'Program keanggotaan pelanggan',
  free_domain: 'Gratis domain',
  support_24_7: 'Bantuan 24/7',
  unlimited_products: 'Produk tak terbatas',
  unlimited_reports: 'Periode Laporan Tanpa Batas',
  priority_support: 'Dukungan Prioritas',
};

const getPlans = (req, res) => success(res, PLANS);

const getPlanOf = (db, storeId) => {
  const store = db.prepare('SELECT plan FROM stores WHERE id = ?').get(storeId);
  return normalizePlan(store?.plan || 'lite');
};

const getSubscription = async (req, res, next) => {
  try {
    const sub = getDb().prepare('SELECT * FROM subscriptions WHERE store_id = ? AND status = ?').get(req.params.id, 'active');
    return success(res, sub || { plan: getPlanOf(getDb(), req.params.id), status: 'active', end_date: null });
  } catch (err) { next(err); }
};

/* Pemakaian kuota saat ini — angka kartu "Rincian paket" ala Plugo. */
const getUsage = async (req, res, next) => {
  try {
    const db = getDb();
    const storeId = req.params.id;
    const planKey = getPlanOf(db, storeId);
    const quota = PLANS[planKey].quota;

    const products = db.prepare('SELECT COUNT(*) c FROM products WHERE store_id = ?').get(storeId).c;
    const ordersMonth = db.prepare("SELECT COUNT(*) c FROM orders WHERE store_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now')").get(storeId).c;
    const owners = db.prepare("SELECT COUNT(*) c FROM store_users WHERE store_id = ? AND role = 'owner'").get(storeId).c;
    const staff = db.prepare("SELECT COUNT(*) c FROM store_users WHERE store_id = ? AND role != 'owner'").get(storeId).c;
    let locations = 0;
    const loc = db.prepare("SELECT value FROM store_settings WHERE store_id = ? AND key = 'locations'").get(storeId);
    if (loc?.value) { try { const arr = JSON.parse(loc.value); locations = Array.isArray(arr) ? arr.length : (arr ? 1 : 0); } catch { locations = 1; } }

    return success(res, {
      plan: planKey,
      usage: {
        products: { used: products, limit: quota.products },
        orders_month: { used: ordersMonth, limit: null },
        owners: { used: owners, limit: quota.owners },
        staff: { used: staff, limit: quota.staff },
        locations: { used: locations, limit: quota.locations },
        manual_payment_quota: { used: 0, limit: quota.manual_payment_quota },
      },
    });
  } catch (err) { next(err); }
};

/* Riwayat Penagihan — semua baris subscription toko, terbaru dulu. */
const getBillingHistory = async (req, res, next) => {
  try {
    const rows = getDb().prepare('SELECT * FROM subscriptions WHERE store_id = ? ORDER BY created_at DESC').all(req.params.id);
    return success(res, rows);
  } catch (err) { next(err); }
};

const createSubscription = async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!plan || !PLANS[plan] || PLANS[plan].price === null) return error(res, 'Plan tidak valid', 400);
    const db = getDb();
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const id = uuid();
    db.prepare("UPDATE subscriptions SET status = 'replaced' WHERE store_id = ? AND status = 'active'").run(req.params.id);
    db.prepare('INSERT INTO subscriptions (id, store_id, plan, status, start_date, end_date, amount, payment_status) VALUES (?,?,?,?,datetime(?),?,?,?)')
      .run(id, req.params.id, plan, 'active', new Date().toISOString(), endDate, PLANS[plan].price, PLANS[plan].price === 0 ? 'paid' : 'pending');
    db.prepare('UPDATE stores SET plan = ?, plan_expiry = ? WHERE id = ?').run(plan, endDate, req.params.id);
    return created(res, db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id), 'Langganan dibuat');
  } catch (err) { next(err); }
};

const cancelSubscription = async (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('UPDATE subscriptions SET status = ? WHERE store_id = ? AND status = ?').run('cancelled', req.params.id, 'active');
    db.prepare('UPDATE stores SET plan = ? WHERE id = ?').run('lite', req.params.id);
    return success(res, null, 'Langganan dibatalkan');
  } catch (err) { next(err); }
};

module.exports = {
  PLANS, PLAN_RANK, FEATURE_MIN_PLAN, FEATURE_LABEL, normalizePlan, hasFeature, getPlanOf,
  getPlans, getSubscription, getUsage, getBillingHistory, createSubscription, cancelSubscription,
};
