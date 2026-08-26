const { getDb, uuid } = require('../config/database');
const { success, created, badRequest, notFound } = require('../utils/response');

const getCart = (req, res, next) => {
  try {
    const { storeId, id: slug } = req.params;
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug || storeId);
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    let cart;
    if (req.user) {
      cart = db.prepare('SELECT * FROM carts WHERE store_id = ? AND user_id = ?').get(store.id, req.user.id);
    } else if (req.cartId || req.headers['x-cart-id']) {
      const cartId = req.cartId || req.headers['x-cart-id'];
      cart = db.prepare('SELECT * FROM carts WHERE id = ?').get(cartId);
    }

    if (!cart) return success(res, { cart: null, items: [] });

    const items = db.prepare('SELECT * FROM cart_items WHERE cart_id = ?').all(cart.id);
    return success(res, { cart, items });
  } catch (err) { next(err); }
};

const addToCart = (req, res, next) => {
  try {
    const { storeId, id: slug } = req.params;
    const { product_id, product_name, product_image, price, quantity } = req.body;
    if (!product_id || !price) return badRequest(res, 'product_id dan price wajib diisi');

    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug || storeId);
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const qty = Math.max(1, parseInt(quantity) || 1);
    const itemTotal = price * qty;

    let cartId;
    if (req.user) {
      let cart = db.prepare('SELECT id FROM carts WHERE store_id = ? AND user_id = ?').get(store.id, req.user.id);
      if (!cart) {
        cartId = uuid();
        db.prepare('INSERT INTO carts (id, store_id, user_id) VALUES (?, ?, ?)').run(cartId, store.id, req.user.id);
      } else {
        cartId = cart.id;
      }
    } else {
      const cartIdHeader = req.cartId || req.headers['x-cart-id'];
      if (cartIdHeader) {
        const existing = db.prepare('SELECT id FROM carts WHERE id = ?').get(cartIdHeader);
        cartId = existing ? existing.id : null;
      }
      if (!cartId) {
        cartId = uuid();
        db.prepare('INSERT INTO carts (id, store_id, customer_id) VALUES (?, ?, ?)').run(cartId, store.id, null);
      }
    }

    const existingItem = db.prepare('SELECT id, quantity FROM cart_items WHERE cart_id = ? AND product_id = ?').get(cartId, product_id);
    if (existingItem) {
      const newQty = existingItem.quantity + qty;
      db.prepare('UPDATE cart_items SET quantity = ?, total = ? WHERE id = ?').run(newQty, newQty * price, existingItem.id);
    } else {
      db.prepare('INSERT INTO cart_items (id, cart_id, product_id, product_name, product_image, price, quantity, total) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuid(), cartId, product_id, product_name || '', product_image || '', price, qty, itemTotal);
    }

    db.prepare('UPDATE carts SET updated_at = datetime(\'now\') WHERE id = ?').run(cartId);

    const items = db.prepare('SELECT * FROM cart_items WHERE cart_id = ?').all(cartId);
    return created(res, { cartId, items });
  } catch (err) { next(err); }
};

const updateCartItem = (req, res, next) => {
  try {
    const { itemId } = req.params;
    const { quantity } = req.body;
    const db = getDb();

    const item = db.prepare('SELECT * FROM cart_items WHERE id = ?').get(itemId);
    if (!item) return notFound(res, 'Item tidak ditemukan');

    if (quantity <= 0) {
      db.prepare('DELETE FROM cart_items WHERE id = ?').run(itemId);
    } else {
      db.prepare('UPDATE cart_items SET quantity = ?, total = ? WHERE id = ?')
        .run(quantity, quantity * item.price, itemId);
    }

    db.prepare('UPDATE carts SET updated_at = datetime(\'now\') WHERE id = ?').run(item.cart_id);
    const items = db.prepare('SELECT * FROM cart_items WHERE cart_id = ?').all(item.cart_id);
    return success(res, { items });
  } catch (err) { next(err); }
};

const removeFromCart = (req, res, next) => {
  try {
    const { itemId } = req.params;
    const db = getDb();
    const item = db.prepare('SELECT * FROM cart_items WHERE id = ?').get(itemId);
    if (!item) return notFound(res, 'Item tidak ditemukan');

    db.prepare('DELETE FROM cart_items WHERE id = ?').run(itemId);
    db.prepare('UPDATE carts SET updated_at = datetime(\'now\') WHERE id = ?').run(item.cart_id);

    const items = db.prepare('SELECT * FROM cart_items WHERE cart_id = ?').all(item.cart_id);
    return success(res, { items });
  } catch (err) { next(err); }
};

const clearCart = (req, res, next) => {
  try {
    const { storeId, id: slug } = req.params;
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug || storeId);
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    let cart;
    if (req.user) {
      cart = db.prepare('SELECT id FROM carts WHERE store_id = ? AND user_id = ?').get(store.id, req.user.id);
    }
    if (cart) {
      db.prepare('DELETE FROM cart_items WHERE cart_id = ?').run(cart.id);
      db.prepare('DELETE FROM carts WHERE id = ?').run(cart.id);
    }
    return success(res, null, 'Keranjang dikosongkan');
  } catch (err) { next(err); }
};

module.exports = { getCart, addToCart, updateCartItem, removeFromCart, clearCart };
