const { getDb } = require('../config/database');
const { forbidden } = require('../utils/response');

const checkStoreAccess = (req, res, next) => {
  try {
    const storeId = req.params.storeId || req.params.id;
    if (!storeId) return next();

    const db = getDb();
    const su = db.prepare('SELECT * FROM store_users WHERE store_id = ? AND user_id = ?').get(storeId, req.user.id);
    if (!su) return forbidden(res, 'Anda tidak memiliki akses ke toko ini');

    req.storeUser = su;
    next();
  } catch (err) { next(err); }
};

module.exports = { checkStoreAccess };
