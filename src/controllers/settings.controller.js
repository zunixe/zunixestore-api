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
    for (const [key, value] of Object.entries(req.body)) {
      db.prepare('INSERT OR REPLACE INTO store_settings (id, store_id, key, value, updated_at) VALUES (COALESCE((SELECT id FROM store_settings WHERE store_id=? AND key=?), ?), ?, ?, ?, datetime("now"))')
        .run(req.params.id, key, uuid(), req.params.id, key, String(value));
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

module.exports = { getSettings, updateSettings, getSetting };
