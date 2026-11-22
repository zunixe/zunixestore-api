const { getDb, uuid } = require('../config/database');
const { success, created, badRequest, notFound } = require('../utils/response');
const { decrementStock, restoreStock, readPref, sweepOrderAutomation } = require('../services/stockService');
const { quoteAutoDiscount } = require('../utils/autoDiscount');

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
        'SELECT id, name, price, stock, description FROM products WHERE id = ? AND store_id = ?'
      ).get(item.product_id, store.id);
      if (!product) return badRequest(res, `Produk ${item.product_id} tidak ditemukan`);

      const qty = Math.max(1, Number(item.quantity) || 1);
      const pdesc = (() => { try { return JSON.parse(product.description || '{}'); } catch { return {}; } })();
      // Harga dari database — harga kiriman browser hanya dipakai bila sama dengan harga salah satu varian.
      const variantPrices = (Array.isArray(pdesc.models) ? pdesc.models : []).map((m) => Number(m && m.price)).filter((v) => v > 0);
      const sentPrice = Number(item.price);
      const price = sentPrice > 0 && variantPrices.includes(sentPrice) ? sentPrice : product.price;
      const itemTotal = price * qty;
      subtotal += itemTotal;

      orderItems.push({
        product_id: product.id,
        product_name: item.name || product.name,
        quantity: qty,
        price: price,
        total: itemTotal,
        _desc: pdesc,
      });
    }

    // Aturan Pengaturan Pesanan (kuantitas & batasan) — sama seperti Plugo.
    const oprefs = readPref(db, store.id, 'order_preferences');
    const totalQty = orderItems.reduce((s, i) => s + i.quantity, 0);
    if (oprefs.min_qty_enabled && totalQty < Number(oprefs.min_qty)) {
      return badRequest(res, `Minimum pembelian ${oprefs.min_qty} produk per pesanan`);
    }
    if (oprefs.max_qty_enabled && totalQty > Number(oprefs.max_qty)) {
      return badRequest(res, `Maksimum ${oprefs.max_qty} produk per pesanan`);
    }
    if (oprefs.per_product_limit_enabled) {
      const over = orderItems.find((i) => i._desc?.max_order && i.quantity > Number(i._desc.max_order));
      if (over) return badRequest(res, `${over.product_name}: maksimal ${over._desc.max_order} per pesanan`);
    }
    if (oprefs.unpaid_limit_enabled && customer_email) {
      const unpaidCount = db.prepare(
        "SELECT COUNT(*) c FROM orders WHERE store_id = ? AND customer_email = ? AND payment_status = 'unpaid' AND status NOT IN ('cancelled', 'refunded')"
      ).get(store.id, customer_email).c;
      if (unpaidCount >= Number(oprefs.unpaid_limit)) {
        return badRequest(res, 'Batas pesanan belum dibayar tercapai — selesaikan pembayaran order sebelumnya dulu');
      }
    }
    // Produk yang dikecualikan dari perhitungan diskon bila diskon punya target produk.

    // Voucher diskon: validasi server-side (status, tanggal, kuota, min. belanja).
    let discountAmount = 0;
    let usedCode = null;
    const code = String(req.body.discount_code || '').trim().toUpperCase();
    if (code) {
      const d = db.prepare("SELECT * FROM discounts WHERE store_id = ? AND UPPER(code) = ? AND status = 'active'").get(store.id, code);
      const now = new Date().toISOString().slice(0, 10);
      if (!d) return badRequest(res, 'Kode diskon tidak valid');
      if (d.start_date && d.start_date > now) return badRequest(res, 'Kode diskon belum berlaku');
      if (d.end_date && d.end_date < now) return badRequest(res, 'Kode diskon sudah kedaluwarsa');
      if (d.usage_limit != null && d.usage_count >= d.usage_limit) return badRequest(res, 'Kuota penggunaan kode diskon habis');
      if (d.min_purchase && subtotal < d.min_purchase) return badRequest(res, `Minimal belanja ${d.min_purchase} untuk kode ini`);
      // Diskon bisa ditargetkan ke produk tertentu (kolom "Jumlah Produk" di admin).
      let eligibleBase = subtotal;
      const targetIds = (() => { try { const a = JSON.parse(d.product_ids || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } })();
      if (targetIds.length) {
        eligibleBase = orderItems.filter((i) => targetIds.includes(i.product_id)).reduce((s, i) => s + i.total, 0);
        if (eligibleBase <= 0) return badRequest(res, 'Kode diskon tidak berlaku untuk produk di keranjang');
      }
      discountAmount = d.type === 'percentage'
        ? Math.min(Math.round(eligibleBase * (Number(d.value) / 100)), d.max_discount ?? eligibleBase)
        : Math.min(Number(d.value) || 0, eligibleBase);
      usedCode = d.code;
    }
    // Diskon otomatis (tanpa kode, seperti "Discount New Member" di Plugo) — ditambahkan ke potongan voucher.
    const auto = quoteAutoDiscount(db, store.id, orderItems);
    const autoAmount = auto ? Math.min(auto.discount_amount, Math.max(0, subtotal - discountAmount)) : 0;
    discountAmount += autoAmount;
    // Biaya Tambahan Khusus (Pengaturan Pesanan) — persen dari subtotal setelah diskon.
    let extraFee = 0;
    if (oprefs.extra_fee_enabled && Number(oprefs.extra_fee_amount) > 0) {
      extraFee = Math.round((subtotal - discountAmount) * (Number(oprefs.extra_fee_amount) / 100));
    }
    const isDropship = !!(oprefs.dropship_enabled && req.body.is_dropship);
    const checkoutAnswer = oprefs.checkout_question_enabled && req.body.checkout_answer ? String(req.body.checkout_answer).slice(0, 2000) : null;
    const total = Math.max(0, subtotal - discountAmount) + extraFee + Number(shipping_cost);
    const orderId = uuid();
    const orderCode = 'INV-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 5).toUpperCase();

    const paymentMethod = req.body.payment_method ? String(req.body.payment_method).slice(0, 50) : null;
    const shippingService = req.body.shipping_service ? String(req.body.shipping_service).slice(0, 80) : null;
    db.prepare(`INSERT INTO orders (id, store_id, order_code, customer_name, customer_email, customer_phone,
      shipping_address, notes, subtotal, shipping_cost, total, shipping_courier, shipping_service, status, payment_status, discount_code, discount_amount,
      extra_fee, is_dropship, shipper_name, shipper_phone, checkout_answer, payment_method, destination_postal_code, destination_area_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'unpaid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(orderId, store.id, orderCode, customer_name, customer_email, customer_phone,
        shipping_address, notes || '', subtotal, Number(shipping_cost), total, shipping_courier || null, shippingService, usedCode, discountAmount,
        extraFee, isDropship ? 1 : 0, isDropship ? String(req.body.shipper_name || '') : null, isDropship ? String(req.body.shipper_phone || '') : null, checkoutAnswer, paymentMethod,
        req.body.destination_postal_code ? String(req.body.destination_postal_code).slice(0, 10) : null, req.body.destination_area_id ? String(req.body.destination_area_id).slice(0, 80) : null);
    try {
      db.prepare('INSERT INTO order_events (id, order_id, type, message, actor) VALUES (?,?,?,?,?)')
        .run(uuid(), orderId, 'created', `Order dimasukkan dari toko online (${customer_name})`, 'customer');
    } catch { /* order_events opsional */ }
    if (usedCode) db.prepare('UPDATE discounts SET usage_count = usage_count + 1 WHERE store_id = ? AND code = ?').run(store.id, usedCode);
    if (autoAmount > 0) {
      db.prepare('UPDATE discounts SET usage_count = usage_count + 1 WHERE id = ?').run(auto.id);
      try {
        db.prepare('INSERT INTO order_events (id, order_id, type, message, actor) VALUES (?,?,?,?,?)')
          .run(uuid(), orderId, 'discount', `Diskon otomatis ${auto.name || (auto.type === 'percentage' ? `${auto.value}%` : '')}: -Rp ${autoAmount.toLocaleString('id-ID')}`, 'system');
      } catch { /* order_events opsional */ }
    }

    const insertItem = db.prepare(
      'INSERT INTO order_items (id, order_id, product_id, product_name, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const oi of orderItems) {
      insertItem.run(uuid(), orderId, oi.product_id, oi.product_name, oi.quantity, oi.price, oi.total);
      // Kurangi stok & kirim notifikasi Stok Menipis bila melewati ambang (Pengaturan Produk).
      decrementStock(db, store.id, oi.product_id, oi.quantity);
    }

    const existing = db.prepare('SELECT id FROM customers WHERE store_id = ? AND email = ?').get(store.id, customer_email);
    if (existing) {
      db.prepare(
        "UPDATE customers SET total_orders = total_orders + 1, total_spent = total_spent + ?, birthdate = COALESCE(?, birthdate), updated_at = datetime('now') WHERE id = ?"
      ).run(total, req.body.customer_birthdate || null, existing.id);
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
      discount_amount: discountAmount,
      discount_code: usedCode,
      auto_discount: autoAmount > 0 ? { id: auto.id, name: auto.name, amount: autoAmount } : null,
    });
  } catch (err) { next(err); }
};

const trackOrder = (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDb();

    const order = db.prepare(
      'SELECT id, store_id, order_code, customer_name, customer_email, customer_phone, status, payment_status, payment_method, subtotal, shipping_cost, extra_fee, discount_code, discount_amount, total, shipping_address, shipping_courier, shipping_service, shipping_awb, is_dropship, shipper_name, shipper_phone, checkout_answer, notes, created_at, updated_at FROM orders WHERE order_code = ?'
    ).get(code);
    if (!order) return notFound(res, 'Pesanan tidak ditemukan');

    const items = db.prepare(
      'SELECT product_id, product_name, quantity, price, total FROM order_items WHERE order_id = ?'
    ).all(order.id);

    // Otomatisasi status (auto-batal belum bayar / auto-selesai terkirim) — Pengaturan Pesanan.
    sweepOrderAutomation(db, order.store_id);
    const fresh = db.prepare('SELECT status FROM orders WHERE id = ?').get(order.id);
    if (fresh) order.status = fresh.status;

    // Pembeli dapat membatalkan pesanan selama masih baru / bukti bayar ditolak.
    const oprefs = readPref(db, order.store_id, 'order_preferences');
    const canCancel = !!oprefs.buyer_cancel_enabled
      && (order.status === 'pending' || order.payment_status === 'rejected');

    let events = [];
    try { events = db.prepare('SELECT type, message, created_at FROM order_events WHERE order_id = ? ORDER BY created_at DESC, rowid DESC').all(order.id); } catch { /* opsional */ }

    return success(res, { ...order, items, events, can_cancel: canCancel });
  } catch (err) { next(err); }
};

// Pembeli membatalkan pesanan sendiri dari halaman lacak — digate Pengaturan Pesanan.
const cancelPublicOrder = (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDb();
    const order = db.prepare('SELECT id, store_id, status, payment_status FROM orders WHERE order_code = ?').get(code);
    if (!order) return notFound(res, 'Pesanan tidak ditemukan');
    const oprefs = readPref(db, order.store_id, 'order_preferences');
    if (!oprefs.buyer_cancel_enabled) return badRequest(res, 'Pembatalan oleh pembeli tidak diaktifkan toko ini');
    if (!(order.status === 'pending' || order.payment_status === 'rejected')) {
      return badRequest(res, 'Pesanan sudah tidak bisa dibatalkan');
    }
    db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(order.id);
    try { db.prepare('INSERT INTO order_events (id, order_id, type, message, actor) VALUES (?,?,?,?,?)').run(uuid(), order.id, 'status', 'Customer membatalkan order', 'customer'); } catch { /* opsional */ }
    restoreStock(db, order.store_id, order.id);
    return success(res, { status: 'cancelled' }, 'Pesanan dibatalkan');
  } catch (err) { next(err); }
};

module.exports = { createPublicOrder, trackOrder, cancelPublicOrder };
