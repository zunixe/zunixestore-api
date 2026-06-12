const { getDb, uuid } = require('../config/database');
const { success, created, error, notFound } = require('../utils/response');

const createOrder = async (req, res, next) => {
  try {
    const { customer_name, customer_email, customer_phone, items, shipping_address, notes } = req.body;
    if (!customer_name || !items?.length) return error(res, 'Nama customer dan items wajib diisi', 400);
    const db = getDb();
    const orderId = uuid();
    const orderCode = `INV-${Date.now().toString(36).toUpperCase()}`;
    let subtotal = 0;
    for (const item of items) subtotal += item.price * item.quantity;
    db.prepare(`INSERT INTO orders (id, store_id, order_code, customer_name, customer_email, customer_phone, subtotal, total, shipping_address, notes) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(orderId, req.params.id, orderCode, customer_name, customer_email||null, customer_phone||null, subtotal, subtotal, shipping_address?JSON.stringify(shipping_address):null, notes||null);
    const itemInsert = db.prepare('INSERT INTO order_items (id, order_id, product_id, product_name, quantity, price, total) VALUES (?,?,?,?,?,?,?)');
    for (const item of items) { itemInsert.run(uuid(), orderId, item.product_id||null, item.product_name, item.quantity, item.price, item.price*item.quantity); }
    return created(res, db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId), 'Pesanan dibuat');
  } catch (err) { next(err); }
};

const getOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, dateFrom, dateTo, search } = req.query;
    const offset = (Number(page)-1) * Number(limit);
    const db = getDb();
    let where = 'WHERE store_id = ?';
    const params = [req.params.id];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (dateFrom) { where += ' AND created_at >= ?'; params.push(dateFrom); }
    if (dateTo) { where += ' AND created_at <= ?'; params.push(dateTo+'T23:59:59'); }
    if (search) { where += ' AND (customer_name LIKE ? OR order_code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const items = db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as c FROM orders ${where}`).get(...params).c;
    return success(res, { items, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

const getOrder = async (req, res, next) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.orderId, req.params.id);
    if (!order) return notFound(res);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    return success(res, { ...order, items });
  } catch (err) { next(err); }
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const { status: orderStatus } = req.body;
    if (!orderStatus) return error(res, 'Status wajib diisi', 400);
    const db = getDb();
    db.prepare("UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?").run(orderStatus, req.params.orderId, req.params.id);
    return success(res, db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId), 'Status diperbarui');
  } catch (err) { next(err); }
};

const deleteOrder = async (req, res, next) => {
  try { getDb().prepare('DELETE FROM orders WHERE id = ? AND store_id = ?').run(req.params.orderId, req.params.id); return success(res, null, 'Pesanan dihapus'); }
  catch (err) { next(err); }
};

module.exports = { createOrder, getOrders, getOrder, updateOrderStatus, deleteOrder };
