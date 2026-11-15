const { getDb, uuid } = require('../config/database');
const { success, created, badRequest, notFound } = require('../utils/response');

const getReviews = async (req, res, next) => {
  try {
    const db = getDb();
    const items = db.prepare('SELECT * FROM reviews WHERE store_id = ? ORDER BY created_at DESC').all(req.params.id);
    return success(res, items.map((r) => ({ ...r, aspects: r.aspects ? JSON.parse(r.aspects) : null })));
  } catch (err) { next(err); }
};

const replyReview = async (req, res, next) => {
  try {
    const { reply } = req.body;
    const db = getDb();
    const r = db.prepare('UPDATE reviews SET reply = ? WHERE id = ? AND store_id = ?').run(reply ?? null, req.params.reviewId, req.params.id);
    if (!r.changes) return notFound(res);
    return success(res, db.prepare('SELECT * FROM reviews WHERE id = ?').get(req.params.reviewId), 'Balasan disimpan');
  } catch (err) { next(err); }
};

const deleteReview = async (req, res, next) => {
  try {
    getDb().prepare('DELETE FROM reviews WHERE id = ? AND store_id = ?').run(req.params.reviewId, req.params.id);
    return success(res, null, 'Ulasan dihapus');
  } catch (err) { next(err); }
};

module.exports = { getReviews, replyReview, deleteReview };
