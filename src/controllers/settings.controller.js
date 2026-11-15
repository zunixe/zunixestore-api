const { getDb } = require('../config/database');
const { success, error } = require('../utils/response');

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

const getSettings = async (req, res, next) => {
  try {
    const rows = getDb().prepare('SELECT key, value FROM store_settings WHERE store_id = ?').all(req.params.id);
    const settings = {}; rows.forEach(r => { settings[r.key] = r.value; });
    return success(res, settings);
  } catch (err) { next(err); }
};

const updateSettings = async (req, res, next) => {
  try {
    const db = getDb();
    const { getPlanOf, hasFeature, FEATURE_MIN_PLAN, FEATURE_LABEL, PLANS } = require('./subscription.controller');
    const plan = getPlanOf(db, req.params.id);
    const need = (feature) => `Fitur "${FEATURE_LABEL[feature] || feature}" membutuhkan paket ${PLANS[FEATURE_MIN_PLAN[feature]]?.name}. Upgrade paket untuk mengaktifkannya.`;

    const parsed = (k) => { try { return JSON.parse(req.body[k]); } catch { return req.body[k]; } };
    // Gate enable-flag pada fitur terkunci paket.
    const gates = [
      ['review_settings', 'reviews', (v) => v?.enabled === true],
      ['loyalty_program', 'loyalty', (v) => v?.enabled === true],
      ['open_order_schedules', 'open_order', (v) => Array.isArray(v) ? v.length > 0 : !!v],
    ];
    for (const [key, feature, isOn] of gates) {
      if (req.body[key] !== undefined && isOn(parsed(key)) && !hasFeature(plan, feature)) {
        return error(res, need(feature), 403);
      }
    }
    // Kuota lokasi sesuai paket.
    if (req.body.locations !== undefined) {
      const arr = parsed('locations');
      const limit = PLANS[plan]?.quota?.locations;
      if (Array.isArray(arr) && limit !== null && arr.length > limit) {
        return error(res, `Kuota lokasi paket kamu maksimal ${limit}. Upgrade paket untuk menambah lokasi.`, 403);
      }
    }

    const now = new Date().toISOString();
    for (const [key, value] of Object.entries(req.body)) {
      db.prepare(`INSERT OR REPLACE INTO store_settings (id, store_id, key, value, updated_at) VALUES (COALESCE((SELECT id FROM store_settings WHERE store_id=? AND key=?), ?), ?, ?, ?, ?)`)
        .run(req.params.id, key, uuid(), req.params.id, key, String(value), now);
    }
    return success(res, null, 'Pengaturan diperbarui');
  } catch (err) { next(err); }
};

const getSetting = async (req, res, next) => {
  try {
    const s = getDb().prepare('SELECT * FROM store_settings WHERE store_id = ? AND key = ?').get(req.params.id, req.params.key);
    return success(res, s || { key: req.params.key, value: null });
  } catch (err) { next(err); }
};

/* Ringkasan dompet: saldo dari settings 'wallet' + koin/poin diturunkan dari order selesai. */
const getWallet = async (req, res, next) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(req.params.id, 'wallet');
    let wallet = {}; try { wallet = JSON.parse(row?.value || '{}'); } catch {}
    const txs = Array.isArray(wallet.transactions) ? wallet.transactions : [];
    const balance = txs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const done = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(total),0) s FROM orders WHERE store_id = ? AND status IN ('completed','delivered')").get(req.params.id);
    // Poin/koin loyalitas mengikuti konfigurasi loyalty_program bila aktif.
    let coins = done.c * 10;
    let points = done.c;
    const lp = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(req.params.id, 'loyalty_program');
    if (lp) {
      try {
        const cfg = JSON.parse(lp.value);
        if (cfg?.enabled && Number(cfg.earnSpend) > 0) {
          points = Math.floor(Number(done.s) / Number(cfg.earnSpend)) * (Number(cfg.earnPoints) || 1);
          coins = points * 10;
        }
      } catch { /* fallback hitungan default */ }
    }
    return success(res, { balance, coins: coins + (Number(wallet.coins) || 0), points: points + (Number(wallet.points) || 0), transactions: txs });
  } catch (err) { next(err); }
};

module.exports = { getSettings, updateSettings, getSetting, getWallet };
