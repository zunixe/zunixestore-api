const { getDb, uuid } = require('../config/database');
const { success, created, error, notFound } = require('../utils/response');

const createStore = async (req, res, next) => {
  try {
    const { name, slug, domain } = req.body;
    if (!name || !slug) return error(res, 'Nama dan slug toko wajib diisi', 400);
    const db = getDb();
    const id = uuid();
    db.prepare('INSERT INTO stores (id, name, slug, domain, owner_id) VALUES (?, ?, ?, ?, ?)').run(id, name, slug, domain || null, req.user.id);
    db.prepare('INSERT INTO store_users (id, store_id, user_id, role) VALUES (?, ?, ?, ?)').run(uuid(), id, req.user.id, 'owner');
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(id);
    return created(res, store, 'Toko berhasil dibuat');
  } catch (err) { next(err); }
};

const getStores = async (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(`SELECT s.* FROM stores s JOIN store_users su ON s.id = su.store_id WHERE su.user_id = ?`).all(req.user.id);
    return success(res, rows);
  } catch (err) { next(err); }
};

const getStore = async (req, res, next) => {
  try {
    const db = getDb();
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
    if (!store) return notFound(res, 'Toko tidak ditemukan');
    return success(res, store);
  } catch (err) { next(err); }
};

const updateStore = async (req, res, next) => {
  try {
    const { name, domain, logo_url, settings } = req.body;
    const db = getDb();
    const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id);
    if (!store) return notFound(res, 'Toko tidak ditemukan');
    db.prepare(`UPDATE stores SET name = COALESCE(?, name), domain = COALESCE(?, domain), logo_url = COALESCE(?, logo_url), settings = COALESCE(?, settings), updated_at = datetime('now') WHERE id = ?`)
      .run(name || null, domain || null, logo_url || null, settings ? JSON.stringify(settings) : null, req.params.id);
    return success(res, db.prepare('SELECT * FROM stores WHERE id = ?').get(req.params.id), 'Toko diperbarui');
  } catch (err) { next(err); }
};

const deleteStore = async (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM stores WHERE id = ?').run(req.params.id);
    return success(res, null, 'Toko berhasil dihapus');
  } catch (err) { next(err); }
};

const getCoins = async (req, res, next) => {
  try {
    return success(res, { coins: 2884, points: 0 });
  } catch (err) { next(err); }
};

module.exports = { createStore, getStores, getStore, updateStore, deleteStore, getCoins };
