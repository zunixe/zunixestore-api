const { getDb } = require('../config/database');
const { success, badRequest } = require('../utils/response');

const getPrefs = async (req, res) => {
  const db = getDb();
  const profile = db.prepare('SELECT language, push_enabled, notif_prefs FROM profiles WHERE id = ?').get(req.user.id);
  return success(res, {
    language: profile.language || 'id',
    push_enabled: !!profile.push_enabled,
    notif_prefs: profile.notif_prefs ? JSON.parse(profile.notif_prefs) : {},
  });
};

const updatePrefs = async (req, res, next) => {
  try {
    const { language, push_enabled, notif_prefs } = req.body;
    const db = getDb();

    if (language !== undefined) {
      db.prepare('UPDATE profiles SET language = ? WHERE id = ?').run(language, req.user.id);
    }
    if (push_enabled !== undefined) {
      db.prepare('UPDATE profiles SET push_enabled = ? WHERE id = ?').run(push_enabled ? 1 : 0, req.user.id);
    }
    if (notif_prefs !== undefined) {
      db.prepare('UPDATE profiles SET notif_prefs = ? WHERE id = ?').run(JSON.stringify(notif_prefs), req.user.id);
    }

    const profile = db.prepare('SELECT language, push_enabled, notif_prefs FROM profiles WHERE id = ?').get(req.user.id);
    return success(res, {
      language: profile.language || 'id',
      push_enabled: !!profile.push_enabled,
      notif_prefs: profile.notif_prefs ? JSON.parse(profile.notif_prefs) : {},
    }, 'Pengaturan berhasil disimpan');
  } catch (err) { next(err); }
};

// Notifikasi level toko (bell di Topbar admin) — e.g. Stok Menipis dari pesanan.
const getStoreNotifications = (req, res, next) => {
  try {
    const db = getDb();
    const items = db.prepare(
      'SELECT id, type, title, body, ref_id, read_at, created_at FROM notifications WHERE store_id = ? ORDER BY created_at DESC LIMIT 50'
    ).all(req.params.id);
    const unread = db.prepare('SELECT COUNT(*) c FROM notifications WHERE store_id = ? AND read_at IS NULL').get(req.params.id).c;
    return success(res, { items, unread });
  } catch (err) { next(err); }
};

const markNotificationRead = (req, res, next) => {
  try {
    const db = getDb();
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE id = ? AND store_id = ?").run(req.params.notifId, req.params.id);
    return success(res, {});
  } catch (err) { next(err); }
};

const markAllNotificationsRead = (req, res, next) => {
  try {
    const db = getDb();
    db.prepare("UPDATE notifications SET read_at = datetime('now') WHERE store_id = ? AND read_at IS NULL").run(req.params.id);
    return success(res, {});
  } catch (err) { next(err); }
};

module.exports = { getPrefs, updatePrefs, getStoreNotifications, markNotificationRead, markAllNotificationsRead };
