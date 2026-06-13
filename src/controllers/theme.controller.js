const { getDb } = require('../config/database');
const { success, error, notFound } = require('../utils/response');

const getThemes = async (req, res, next) => {
  try {
    return success(res, getDb().prepare('SELECT * FROM themes WHERE store_id IS NULL ORDER BY created_at DESC').all());
  } catch (err) { next(err); }
};

const getActiveTheme = async (req, res, next) => {
  try {
    const t = getDb().prepare('SELECT * FROM themes WHERE is_active = 1').get();
    if (!t) return success(res, getDb().prepare("SELECT * FROM themes WHERE id = 't1'").get());
    return success(res, t);
  } catch (err) { next(err); }
};

const activateTheme = async (req, res, next) => {
  try {
    const { themeId } = req.body;
    if (!themeId) return error(res, 'themeId wajib diisi', 400);
    const db = getDb();
    db.prepare('UPDATE themes SET is_active = 0').run();
    db.prepare('UPDATE themes SET is_active = 1 WHERE id = ?').run(themeId);
    return success(res, db.prepare('SELECT * FROM themes WHERE id = ?').get(themeId), 'Tema diaktifkan');
  } catch (err) { next(err); }
};

const updateTheme = async (req, res, next) => {
  try {
    const { config } = req.body;
    if (!config) return error(res, 'Config tema wajib diisi', 400);
    const db = getDb();
    const active = db.prepare('SELECT * FROM themes WHERE is_active = 1').get();
    if (!active) return notFound(res, 'Tidak ada tema aktif');
    db.prepare('UPDATE themes SET config = ? WHERE id = ?').run(JSON.stringify(config), active.id);
    return success(res, null, 'Tema diperbarui');
  } catch (err) { next(err); }
};

module.exports = { getThemes, getActiveTheme, activateTheme, updateTheme };
