const { getDb, uuid } = require('../config/database');
const { success, created, badRequest, notFound } = require('../utils/response');

const createPublicOrder = (req, res, next) => {
  try {
    const {
      store_slug, customer_name, customer_email, customer_phone,
      shipping_address, notes, items, shipping_cost = 0, shipping_courier,
    } = req.body;

    if (!store_slug || !customer_name || !customer_email || !shipping_address || !items || !items.length) {
      return badRequest(res, 'Data pesanan tidak lengkap');
    }

    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(store_slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    let subtotal = 0;
    const orderItems = [];

    for (const item of items) {
      const product = db.prepare(
        'SELECT id, name, price, stock FROM products WHERE id = ? AND store_id = ?'
      ).get(item.product_id, store.id);
      if (!product) return badRequest(res, `Produk ${item.product_id} tidak ditemukan`);

      const qty = Math.max(1, Number(item.quantity) || 1);
      const price = Number(item.price) || product.price;
      const itemTotal = price * qty;
      subtotal += itemTotal;

      orderItems.push({
        product_id: product.id,
        product_name: item.name || product.name,
        quantity: qty,
        price: price,
        total: itemTotal,
      });
    }

    const total = subtotal + Number(shipping_cost);
    const orderId = uuid();
    const orderCode = 'INV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();

    db.prepare(`INSERT INTO orders (id, store_id, order_code, customer_name, customer_email, customer_phone,
      shipping_address, notes, subtotal, shipping_cost, total, shipping_courier, status, payment_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid')`)
      .run(orderId, store.id, orderCode, customer_name, customer_email, customer_phone,
        shipping_address, notes || '', subtotal, Number(shipping_cost), total, shipping_courier || null);

    const insertItem = db.prepare(
      'INSERT INTO order_items (id, order_id, product_id, product_name, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const oi of orderItems) {
      insertItem.run(uuid(), orderId, oi.product_id, oi.product_name, oi.quantity, oi.price, oi.total);
    }

    const existing = db.prepare('SELECT id FROM customers WHERE store_id = ? AND email = ?').get(store.id, customer_email);
    if (existing) {
      db.prepare(
        "UPDATE customers SET total_orders = total_orders + 1, total_spent = total_spent + ?, updated_at = datetime('now') WHERE id = ?"
      ).run(total, existing.id);
    } else {
      db.prepare(
        'INSERT INTO customers (id, store_id, name, email, phone, address, total_orders, total_spent) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
      ).run(uuid(), store.id, customer_name, customer_email, customer_phone, shipping_address, total);
    }

    return created(res, {
      order_id: orderId,
      order_code: orderCode,
      total,
      subtotal,
      shipping_cost: Number(shipping_cost),
    });
  } catch (err) { next(err); }
};

const trackOrder = (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDb();

    const order = db.prepare(
      'SELECT id, order_code, customer_name, customer_email, customer_phone, status, payment_status, subtotal, shipping_cost, total, shipping_address, shipping_courier, shipping_awb, notes, created_at, updated_at FROM orders WHERE order_code = ?'
    ).get(code);
    if (!order) return notFound(res, 'Pesanan tidak ditemukan');

    const items = db.prepare(
      'SELECT product_id, product_name, quantity, price, total FROM order_items WHERE order_id = ?'
    ).all(order.id);

    return success(res, { ...order, items });
  } catch (err) { next(err); }
};

module.exports = { createPublicOrder, trackOrder };
