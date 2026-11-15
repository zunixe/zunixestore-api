const { uuid } = require('../config/database');

// Kurangi stok produk karena pesanan, lalu kirim notifikasi "Stok Menipis"
// ke admin bila stok turun sampai/lewat ambang (product_preferences.low_stock_alert).
// Mengikuti flow Plugo: notifikasi saat stok TURUN KE angka ambang (bukan setiap order).
const decrementStock = (db, storeId, productId, quantity) => {
  if (!productId) return;
  const product = db.prepare('SELECT id, name, stock FROM products WHERE id = ? AND store_id = ?').get(productId, storeId);
  if (!product) return;
  const oldStock = Number(product.stock) || 0;
  const newStock = oldStock - Math.max(0, Number(quantity) || 0);
  db.prepare("UPDATE products SET stock = ?, updated_at = datetime('now') WHERE id = ?").run(newStock, productId);

  const row = db.prepare("SELECT value FROM store_settings WHERE store_id = ? AND key = 'product_preferences'").get(storeId);
  let prefs = {};
  try { prefs = row ? JSON.parse(row.value) || {} : {}; } catch { /* abaikan */ }
  if (!prefs.low_stock_alert) return;
  const threshold = Number(prefs.low_stock_threshold) >= 0 ? Number(prefs.low_stock_threshold) : 10;

  const crossed = oldStock > threshold && newStock <= threshold;
  const hitZero = oldStock > 0 && newStock <= 0;
  if (!crossed && !hitZero) return;

  // Hindari spam: lewati bila sudah ada notifikasi belum dibaca untuk produk ini.
  const dup = db.prepare("SELECT id FROM notifications WHERE store_id = ? AND type = 'low_stock' AND ref_id = ? AND read_at IS NULL").get(storeId, productId);
  if (dup) return;

  const habis = newStock <= 0;
  db.prepare("INSERT INTO notifications (id, store_id, type, title, body, ref_id) VALUES (?, ?, 'low_stock', ?, ?, ?)")
    .run(uuid(), storeId,
      habis ? 'Stok produk habis' : 'Stok produk menipis',
      `${product.name} ${habis ? 'sudah habis' : `tersisa ${newStock}`}`,
      productId);
};

// Kembalikan stok saat pesanan dibatalkan.
const restoreStock = (db, storeId, orderId) => {
  const items = db.prepare('SELECT product_id, quantity FROM order_items WHERE order_id = ?').all(orderId);
  for (const it of items) {
    if (!it.product_id) continue;
    db.prepare("UPDATE products SET stock = stock + ?, updated_at = datetime('now') WHERE id = ? AND store_id = ?")
      .run(Math.max(0, Number(it.quantity) || 0), it.product_id, storeId);
  }
};

const readPref = (db, storeId, key) => {
  try {
    const row = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(storeId, key);
    return row ? JSON.parse(row.value) || {} : {};
  } catch { return {}; }
};

// Otomatisasi status ala Pengaturan Pesanan (dipanggil lazy saat order dibaca):
// - batalkan order belum dibayar yang melewati auto_cancel_days (COD & manual tidak pernah)
// - selesaikan order Terkirim yang melewati auto_complete_days (COD dilewati)
const sweepOrderAutomation = (db, storeId) => {
  const prefs = readPref(db, storeId, 'order_preferences');
  const cancelDays = Number(prefs.auto_cancel_days) || 0;
  const completeDays = Number(prefs.auto_complete_days) || 0;
  if (cancelDays > 0) {
    db.prepare(`UPDATE orders SET status = 'cancelled', updated_at = datetime('now')
      WHERE store_id = ? AND payment_status = 'unpaid' AND status = 'pending'
      AND COALESCE(payment_method, '') != 'cod'
      AND created_at < datetime('now', ?)`).run(storeId, `-${cancelDays} days`);
  }
  if (completeDays > 0) {
    db.prepare(`UPDATE orders SET status = 'completed', updated_at = datetime('now')
      WHERE store_id = ? AND status = 'shipped'
      AND COALESCE(payment_method, '') != 'cod'
      AND updated_at < datetime('now', ?)`).run(storeId, `-${completeDays} days`);
  }
};

module.exports = { decrementStock, restoreStock, readPref, sweepOrderAutomation };
