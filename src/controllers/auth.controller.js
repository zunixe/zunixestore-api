const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getDb, uuid } = require('../config/database');
const { success, created, error, badRequest, unauthorized } = require('../utils/response');
const { JWT_SECRET } = require('../middleware/auth.middleware');

const generateToken = (user) => {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
};

const register = async (req, res, next) => {
  try {
    const { email, password, full_name } = req.body;
    if (!email || !password || !full_name) {
      return badRequest(res, 'Email, password, dan nama lengkap wajib diisi');
    }

    const db = getDb();
    const existing = db.prepare('SELECT id FROM profiles WHERE email = ?').get(email);
    if (existing) return error(res, 'Email sudah terdaftar', 400);

    const id = uuid();
    const hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO profiles (id, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, ?)').run(id, email, full_name, hash, 'owner');

    const user = db.prepare('SELECT id, email, full_name, role FROM profiles WHERE id = ?').get(id);
    const token = generateToken(user);
    return created(res, { user, token });
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return badRequest(res, 'Email dan password wajib diisi');

    const db = getDb();
    const user = db.prepare('SELECT * FROM profiles WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return unauthorized(res, 'Email atau password salah');
    }

    const { password_hash, ...profile } = user;
    const token = generateToken(profile);
    return success(res, { user: profile, token }, 'Login berhasil');
  } catch (err) { next(err); }
};

const refresh = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return unauthorized(res, 'Token tidak ditemukan');

    const oldToken = authHeader.split(' ')[1];
    const decoded = jwt.verify(oldToken, JWT_SECRET, { ignoreExpiration: true });

    const db = getDb();
    const user = db.prepare('SELECT id, email, full_name, role FROM profiles WHERE id = ?').get(decoded.sub);
    if (!user) return unauthorized(res, 'User tidak ditemukan');

    const token = generateToken(user);
    return success(res, { token });
  } catch (err) { next(err); }
};

const me = async (req, res) => {
  const db = getDb();
  const user = db.prepare('SELECT id, email, full_name, avatar_url, phone, role, ktp_verified, phone_verified, created_at FROM profiles WHERE id = ?').get(req.user.id);
  return success(res, user);
};

const updateProfile = async (req, res, next) => {
  try {
    const { full_name, phone, avatar_url } = req.body;
    const db = getDb();
    const user = db.prepare('SELECT * FROM profiles WHERE id = ?').get(req.user.id);
    if (!user) return unauthorized(res, 'User tidak ditemukan');

    db.prepare('UPDATE profiles SET full_name = COALESCE(?, full_name), phone = COALESCE(?, phone), avatar_url = COALESCE(?, avatar_url) WHERE id = ?')
      .run(full_name || null, phone || null, avatar_url || null, req.user.id);

    const updated = db.prepare('SELECT id, email, full_name, avatar_url, phone, role, created_at FROM profiles WHERE id = ?').get(req.user.id);
    return success(res, updated, 'Profile updated');
  } catch (err) { next(err); }
};

const logout = async (req, res) => success(res, null, 'Logout berhasil');

const setPin = async (req, res, next) => {
  try {
    const { old_pin, new_pin } = req.body;
    if (!new_pin || new_pin.length < 4 || new_pin.length > 6) {
      return badRequest(res, 'PIN harus 4-6 digit');
    }

    const db = getDb();
    const profile = db.prepare('SELECT pin_hash FROM profiles WHERE id = ?').get(req.user.id);

    if (profile.pin_hash) {
      if (!old_pin) return badRequest(res, 'PIN lama wajib diisi');
      if (!bcrypt.compareSync(old_pin, profile.pin_hash)) {
        return badRequest(res, 'PIN lama salah');
      }
    }

    const hash = bcrypt.hashSync(new_pin, 10);
    db.prepare('UPDATE profiles SET pin_hash = ? WHERE id = ?').run(hash, req.user.id);
    return success(res, null, 'PIN berhasil diubah');
  } catch (err) { next(err); }
};

const verifyPin = async (req, res, next) => {
  try {
    const { pin } = req.body;
    if (!pin) return badRequest(res, 'PIN wajib diisi');

    const db = getDb();
    const profile = db.prepare('SELECT pin_hash FROM profiles WHERE id = ?').get(req.user.id);

    if (!profile.pin_hash) return badRequest(res, 'PIN belum diatur');
    if (!bcrypt.compareSync(pin, profile.pin_hash)) {
      return badRequest(res, 'PIN salah');
    }

    return success(res, { verified: true }, 'PIN benar');
  } catch (err) { next(err); }
};

const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;
    if (!password) return badRequest(res, 'Password wajib diisi');

    const db = getDb();
    const profile = db.prepare('SELECT password_hash FROM profiles WHERE id = ?').get(req.user.id);

    if (!bcrypt.compareSync(password, profile.password_hash)) {
      return badRequest(res, 'Password salah');
    }

    db.prepare('DELETE FROM profiles WHERE id = ?').run(req.user.id);
    return success(res, null, 'Akun berhasil dihapus');
  } catch (err) { next(err); }
};

module.exports = { register, login, refresh, logout, me, updateProfile, setPin, verifyPin, deleteAccount };
