const { getDb, uuid } = require('../config/database');
const { success, created, error } = require('../utils/response');

const createDiscount = async (req, res, next) => {
  try {
    const { name, code, type, value, min_purchase, max_discount, start_date, end_date, usage_limit, product_ids, status } = req.body;
    if (!type || value === undefined) return error(res, 'Tipe dan nilai wajib diisi', 400);
    const db = getDb(); const id = uuid();
    db.prepare('INSERT INTO discounts (id, store_id, name, code, type, value, min_purchase, max_discount, start_date, end_date, usage_limit, product_ids, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, req.params.id, name ? String(name).slice(0, 120) : null, code ? String(code).trim().toUpperCase() : null, type, value, min_purchase||0, max_discount||null, start_date||null, end_date||null, usage_limit||null, JSON.stringify(Array.isArray(product_ids) ? product_ids : []), status === 'inactive' ? 'inactive' : 'active');
    return created(res, db.prepare('SELECT * FROM discounts WHERE id = ?').get(id), 'Diskon dibuat');
  } catch (err) { next(err); }
};

const getDiscounts = async (req, res, next) => {
  try { return success(res, getDb().prepare('SELECT * FROM discounts WHERE store_id = ? ORDER BY created_at DESC').all(req.params.id)); }
  catch (err) { next(err); }
};

const updateDiscount = async (req, res, next) => {
  try {
    const { name, code, type, value, min_purchase, max_discount, start_date, end_date, usage_limit, status, product_ids } = req.body;
    const db = getDb();
    // name & code boleh dikosongkan: code kosong = diskon otomatis.
    if (name !== undefined) db.prepare('UPDATE discounts SET name = ? WHERE id = ? AND store_id = ?').run(name ? String(name).slice(0, 120) : null, req.params.discountId, req.params.id);
    if (code !== undefined) db.prepare('UPDATE discounts SET code = ? WHERE id = ? AND store_id = ?').run(code ? String(code).trim().toUpperCase() : null, req.params.discountId, req.params.id);
    db.prepare(`UPDATE discounts SET type=COALESCE(?,type), value=COALESCE(?,value), min_purchase=COALESCE(?,min_purchase), max_discount=COALESCE(?,max_discount), start_date=COALESCE(?,start_date), end_date=COALESCE(?,end_date), usage_limit=COALESCE(?,usage_limit), status=COALESCE(?,status), product_ids=COALESCE(?,product_ids) WHERE id=? AND store_id=?`)
      
      .run(type||null, value!=null?value:null, min_purchase!=null?min_purchase:null, max_discount!=null?max_discount:null, start_date||null, end_date||null, usage_limit!=null?usage_limit:null, status||null, product_ids!==undefined?JSON.stringify(Array.isArray(product_ids)?product_ids:[]):null, req.params.discountId, req.params.id);
    return success(res, db.prepare('SELECT * FROM discounts WHERE id = ?').get(req.params.discountId), 'Diskon diperbarui');
  } catch (err) { next(err); }
};

const deleteDiscount = async (req, res, next) => {
  try { getDb().prepare('DELETE FROM discounts WHERE id = ? AND store_id = ?').run(req.params.discountId, req.params.id); return success(res, null, 'Diskon dihapus'); }
  catch (err) { next(err); }
};

module.exports = { createDiscount, getDiscounts, updateDiscount, deleteDiscount };
