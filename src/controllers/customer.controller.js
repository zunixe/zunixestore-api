const { getDb, uuid } = require('../config/database');
const { success, created, error, notFound } = require('../utils/response');

const createCustomer = async (req, res, next) => {
  try {
    const { name, email, phone, address } = req.body;
    if (!name) return error(res, 'Nama wajib diisi', 400);
    const db = getDb(); const id = uuid();
    db.prepare('INSERT INTO customers (id, store_id, name, email, phone, address) VALUES (?,?,?,?,?,?)').run(id, req.params.id, name, email||null, phone||null, address||null);
    return created(res, db.prepare('SELECT * FROM customers WHERE id = ?').get(id), 'Customer dibuat');
  } catch (err) { next(err); }
};

const getCustomers = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search } = req.query;
    const offset = (Number(page)-1) * Number(limit);
    const db = getDb();
    let where = 'WHERE store_id = ?'; const params = [req.params.id];
    if (search) { where += ' AND (name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const items = db.prepare(`SELECT * FROM customers ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as c FROM customers ${where}`).get(...params).c;
    return success(res, { items, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

const getCustomer = async (req, res, next) => {
  try {
    const db = getDb();
    const c = db.prepare('SELECT * FROM customers WHERE id = ? AND store_id = ?').get(req.params.customerId, req.params.id);
    if (!c) return notFound(res);
    const orders = db.prepare('SELECT id, order_code, total, status, created_at FROM orders WHERE customer_id = ?').all(c.id);
    return success(res, { ...c, orders });
  } catch (err) { next(err); }
};

const updateCustomer = async (req, res, next) => {
  try {
    const { name, email, phone, address } = req.body;
    const db = getDb();
    db.prepare("UPDATE customers SET name=COALESCE(?,name), email=COALESCE(?,email), phone=COALESCE(?,phone), address=COALESCE(?,address), updated_at=datetime('now') WHERE id=? AND store_id=?")
      .run(name||null, email||null, phone||null, address||null, req.params.customerId, req.params.id);
    return success(res, db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.customerId), 'Customer diperbarui');
  } catch (err) { next(err); }
};

const deleteCustomer = async (req, res, next) => {
  try { getDb().prepare('DELETE FROM customers WHERE id = ? AND store_id = ?').run(req.params.customerId, req.params.id); return success(res, null, 'Customer dihapus'); }
  catch (err) { next(err); }
};

module.exports = { createCustomer, getCustomers, getCustomer, updateCustomer, deleteCustomer };
