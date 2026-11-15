const { getDb, uuid } = require('../config/database');
const { success, error, notFound } = require('../utils/response');

/*
 * Tema = template storefront. Template yang tayang disimpan per toko di
 * store_settings.template (dibaca storefront lewat /api/public/resolve), warna di
 * store_settings primary_color / secondary_color / footer_color.
 */
const COLOR_KEYS = ['primary_color', 'secondary_color', 'footer_color'];

function readSettings(db, storeId, keys) {
  const rows = db.prepare(
    `SELECT key, value FROM store_settings WHERE store_id = ? AND key IN (${keys.map(() => '?').join(',')})`
  ).all(storeId, ...keys);
  const out = {};
  for (const r of rows) {
    try { out[r.key] = JSON.parse(r.value); } catch { out[r.key] = r.value; }
  }
  return out;
}

function writeSetting(db, storeId, key, value) {
  db.prepare(
    `INSERT INTO store_settings (id, store_id, key, value, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(store_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(uuid(), storeId, key, JSON.stringify(value)); // sama dengan format nilai yang sudah ada
}

function listTemplates(db) {
  return db.prepare(
    "SELECT * FROM themes WHERE store_id IS NULL AND template IS NOT NULL AND template != '' ORDER BY created_at ASC, name ASC"
  ).all();
}

/* Tandai is_active per toko dan timpa warna tema aktif dengan warna toko. */
function decorate(db, storeId, themes) {
  const s = readSettings(db, storeId, ['template', 'template_updated_at', ...COLOR_KEYS]);
  const active = s.template || 'default';
  return themes.map((t) => {
    const isActive = t.template === active;
    let config = {};
    try { config = JSON.parse(t.config || '{}'); } catch { config = {}; }
    if (isActive) for (const k of COLOR_KEYS) if (s[k]) config[k] = s[k];
    return {
      ...t,
      is_active: isActive ? 1 : 0,
      config: JSON.stringify(config),
      updated_at: isActive ? (s.template_updated_at || null) : null,
    };
  });
}

const getThemes = async (req, res, next) => {
  try {
    const db = getDb();
    return success(res, decorate(db, req.params.id, listTemplates(db)));
  } catch (err) { next(err); }
};

const getActiveTheme = async (req, res, next) => {
  try {
    const db = getDb();
    const themes = decorate(db, req.params.id, listTemplates(db));
    return success(res, themes.find((t) => t.is_active) || themes[0] || null);
  } catch (err) { next(err); }
};

const activateTheme = async (req, res, next) => {
  try {
    const { themeId } = req.body;
    if (!themeId) return error(res, 'themeId wajib diisi', 400);
    const db = getDb();
    const theme = db.prepare('SELECT * FROM themes WHERE id = ? AND template IS NOT NULL').get(themeId);
    if (!theme) return notFound(res, 'Template tidak ditemukan');

    db.transaction(() => {
      writeSetting(db, req.params.id, 'template', theme.template);
      writeSetting(db, req.params.id, 'template_updated_at', new Date().toISOString());
    })();

    const [active] = decorate(db, req.params.id, [theme]);
    return success(res, active, 'Template diterapkan');
  } catch (err) { next(err); }
};

const updateTheme = async (req, res, next) => {
  try {
    const { config } = req.body;
    if (!config || typeof config !== 'object') return error(res, 'Config tema wajib diisi', 400);
    const hex = /^#[0-9a-f]{6}$/i;
    for (const k of COLOR_KEYS) {
      if (config[k] !== undefined && !hex.test(String(config[k]))) {
        return error(res, `${k} harus warna hex, mis. #DB0028`, 400);
      }
    }
    const db = getDb();
    db.transaction(() => {
      for (const k of COLOR_KEYS) {
        if (config[k] !== undefined) writeSetting(db, req.params.id, k, String(config[k]));
      }
      writeSetting(db, req.params.id, 'template_updated_at', new Date().toISOString());
    })();
    return success(res, null, 'Desain toko diperbarui');
  } catch (err) { next(err); }
};

module.exports = { getThemes, getActiveTheme, activateTheme, updateTheme };
