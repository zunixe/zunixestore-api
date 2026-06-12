const jwt = require('jsonwebtoken');
const { getDb } = require('../config/database');
const { unauthorized } = require('../utils/response');

const JWT_SECRET = process.env.JWT_SECRET || 'zunixestore-secret-key-2026';

const authenticate = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return unauthorized(res, 'Token tidak ditemukan');

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const db = getDb();
    const user = db.prepare('SELECT id, email, full_name, role FROM profiles WHERE id = ?').get(decoded.sub);
    if (!user) return unauthorized(res, 'User tidak ditemukan');

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return unauthorized(res, 'Token expired');
    if (err.name === 'JsonWebTokenError') return unauthorized(res, 'Token invalid');
    next(err);
  }
};

module.exports = { authenticate, JWT_SECRET };
