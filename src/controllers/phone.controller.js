const { getDb } = require('../config/database');
const { success, badRequest } = require('../utils/response');

// In-memory verification store for demo
const phoneVerifications = {};

const requestPhoneVerification = async (req, res, next) => {
  try {
    const { phone } = req.body;
    if (!phone) return badRequest(res, 'Nomor HP wajib diisi');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    phoneVerifications[req.user.id] = {
      code,
      phone,
      expires: Date.now() + 5 * 60 * 1000, // 5 minutes
    };

    return success(res, { code, phone }, 'Kode verifikasi dikirim ke WhatsApp');
  } catch (err) { next(err); }
};

const verifyPhone = async (req, res, next) => {
  try {
    const { code, phone } = req.body;
    if (!code || !phone) return badRequest(res, 'Kode dan nomor HP wajib diisi');

    const record = phoneVerifications[req.user.id];
    if (!record || record.code !== code || record.phone !== phone || record.expires < Date.now()) {
      return badRequest(res, 'Kode verifikasi salah atau sudah kadaluarsa');
    }

    delete phoneVerifications[req.user.id];

    const db = getDb();
    db.prepare('UPDATE profiles SET phone = ?, phone_verified = 1 WHERE id = ?').run(phone, req.user.id);

    return success(res, { phone, phone_verified: true }, 'Nomor HP berhasil diverifikasi');
  } catch (err) { next(err); }
};

module.exports = { requestPhoneVerification, verifyPhone };
