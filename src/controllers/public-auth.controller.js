const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { getDb, uuid } = require('../config/database');
const { success, created, badRequest, unauthorized } = require('../utils/response');

const JWT_SECRET = process.env.JWT_SECRET || 'zunixestore-secret-key-2026';

/* Resolve toko dari Origin/Referer request (mis. https://www.zunixe.com →
   stores.domain, atau dev domain slug.zunixestore.com → stores.slug). */
const resolveStoreByOrigin = (req, db) => {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return null;
  try {
    const host = new URL(origin).hostname;
    return db.prepare("SELECT id FROM stores WHERE domain = ? AND status = 'active'").get(host)
      || db.prepare("SELECT id FROM stores WHERE slug = ? AND status = 'active'").get(host.split('.')[0])
      || null;
  } catch { return null; }
};

/* Buyer yang register/login ikut tercatat di daftar Customer toko supaya
   muncul di admin (Customer > Semua Customer), sama seperti saat checkout. */
const syncStoreCustomer = (req, db, { full_name, email, phone }) => {
  try {
    const store = resolveStoreByOrigin(req, db);
    if (!store || !email) return;
    const existing = db.prepare('SELECT id FROM customers WHERE store_id = ? AND email = ?').get(store.id, email);
    if (existing) {
      db.prepare("UPDATE customers SET name = COALESCE(?, name), phone = COALESCE(?, phone), updated_at = datetime('now') WHERE id = ?")
        .run(full_name || null, phone || null, existing.id);
    } else {
      db.prepare('INSERT INTO customers (id, store_id, name, email, phone) VALUES (?, ?, ?, ?, ?)')
        .run(uuid(), store.id, full_name || null, email, phone || null);
    }
  } catch { /* customer sync opsional, jangan gagalkan auth */ }
};

const registerCustomer = (req, res, next) => {
  try {
    const { email, password, full_name, phone } = req.body;
    if (!email || !password || !full_name) {
      return badRequest(res, 'Email, password, dan nama lengkap wajib diisi');
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM profiles WHERE email = ?').get(email);
    if (existing) return badRequest(res, 'Email sudah terdaftar');

    const id = uuid();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare(
      'INSERT INTO profiles (id, email, full_name, phone, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, email, full_name, phone || null, hash, 'customer');

    syncStoreCustomer(req, db, { full_name, email, phone });

    const token = jwt.sign({ sub: id, email, role: 'customer' }, JWT_SECRET, { expiresIn: '7d' });
    return created(res, {
      token,
      user: { id, email, full_name, phone, role: 'customer' },
    });
  } catch (err) { next(err); }
};

const loginCustomer = (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return badRequest(res, 'Email dan password wajib diisi');

    const db = getDb();
    const user = db.prepare(
      'SELECT id, email, full_name, phone, password_hash, role FROM profiles WHERE email = ?'
    ).get(email);

    if (!user || !user.password_hash) return unauthorized(res, 'Email atau password salah');
    if (!bcrypt.compareSync(password, user.password_hash)) {
      return unauthorized(res, 'Email atau password salah');
    }

    syncStoreCustomer(req, db, user);

    const token = jwt.sign({ sub: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    return success(res, {
      token,
      user: { id: user.id, email: user.email, full_name: user.full_name, phone: user.phone, role: user.role },
    });
  } catch (err) { next(err); }
};

const getMe = (req, res, next) => {
  try {
    if (!req.user) return unauthorized(res, 'Silakan login terlebih dahulu');
    const db = getDb();
    const user = db.prepare(
      'SELECT id, email, full_name, phone, role, avatar_url, language, phone_verified FROM profiles WHERE id = ?'
    ).get(req.user.id);
    if (!user) return unauthorized(res, 'User tidak ditemukan');
    return success(res, { user });
  } catch (err) { next(err); }
};

const updateProfile = (req, res, next) => {
  try {
    if (!req.user) return unauthorized(res, 'Silakan login terlebih dahulu');
    const { full_name, phone, address } = req.body;
    const db = getDb();
    db.prepare('UPDATE profiles SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone) WHERE id = ?')
      .run(full_name || null, phone || null, req.user.id);
    return success(res, null, 'Profil berhasil diperbarui');
  } catch (err) { next(err); }
};

module.exports = { registerCustomer, loginCustomer, getMe, updateProfile };
