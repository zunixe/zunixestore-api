/*
 * Diskon otomatis (tanpa kode) — seperti "Diskon Produk" di Plugo.
 *
 * Diskon di tabel `discounts` dengan kolom `code` kosong berlaku otomatis:
 *  - di toko: produk yang harganya sudah ≥ min. pembelian tampil dengan harga
 *    setelah diskon (harga normal dicoret); yang di bawah min. pembelian diberi
 *    label "Extra X%" + catatan "Beli Rp … Diskon X%".
 *  - di checkout: potongan dihitung dari subtotal produk yang ikut diskon bila
 *    subtotal itu ≥ min. pembelian, dibatasi max_discount.
 * Bila ada beberapa diskon otomatis, dipakai yang potongannya paling besar.
 */

const today = () => new Date().toISOString().slice(0, 10);

const parseIds = (v) => {
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
};

function getActiveAutoDiscounts(db, storeId) {
  const now = today();
  return db.prepare(
    "SELECT * FROM discounts WHERE store_id = ? AND status = 'active' AND (code IS NULL OR TRIM(code) = '')"
  ).all(storeId)
    .filter((d) => (!d.start_date || String(d.start_date).slice(0, 10) <= now)
      && (!d.end_date || String(d.end_date).slice(0, 10) >= now)
      && (d.usage_limit == null || Number(d.usage_count || 0) < Number(d.usage_limit)))
    .map((d) => ({ ...d, _ids: parseIds(d.product_ids) }));
}

const covers = (d, productId) => d._ids.length === 0 || d._ids.includes(String(productId));

function cut(d, base) {
  if (base <= 0) return 0;
  if (d.type === 'percentage') {
    const raw = Math.round(base * (Number(d.value) / 100));
    return d.max_discount != null && d.max_discount !== '' ? Math.min(raw, Number(d.max_discount)) : raw;
  }
  return Math.min(Number(d.value) || 0, base);
}

/* Info promo untuk satu produk (dipakai kartu & halaman produk di toko). */
function promoFor(product, discounts) {
  const price = Number(product.price) || 0;
  let best = null;
  for (const d of discounts) {
    if (!covers(d, product.id)) continue;
    const min = Number(d.min_purchase) || 0;
    const applies = price > 0 && price >= min;
    const amount = applies ? cut(d, price) : 0;
    const cand = {
      id: d.id,
      name: d.name || null,
      type: d.type,
      value: Number(d.value),
      min_purchase: min,
      max_discount: d.max_discount != null ? Number(d.max_discount) : null,
      applies,
      discount_amount: amount,
      final_price: price - amount,
    };
    // Utamakan yang langsung berlaku dengan potongan terbesar; lalu yang min. belanjanya terkecil.
    if (!best
      || (cand.applies && !best.applies)
      || (cand.applies === best.applies && (cand.discount_amount > best.discount_amount
        || (!cand.applies && cand.min_purchase < best.min_purchase)))) best = cand;
  }
  return best;
}

function attachPromos(db, storeId, products) {
  const discounts = getActiveAutoDiscounts(db, storeId);
  if (!discounts.length) return products;
  for (const p of products) {
    if (!(Number(p.price) > 0) || (p.description && p.description.is_bundle)) continue;
    const promo = promoFor(p, discounts);
    if (promo) p.promo = promo;
  }
  return products;
}

/* Potongan otomatis untuk isi keranjang: items = [{ product_id, total }]. */
function quoteAutoDiscount(db, storeId, items) {
  let best = null;
  for (const d of getActiveAutoDiscounts(db, storeId)) {
    const base = items.filter((i) => covers(d, i.product_id)).reduce((s, i) => s + (Number(i.total) || 0), 0);
    if (base <= 0 || base < (Number(d.min_purchase) || 0)) continue;
    const amount = cut(d, base);
    if (amount > 0 && (!best || amount > best.discount_amount)) {
      best = { id: d.id, name: d.name || null, type: d.type, value: Number(d.value), discount_amount: amount };
    }
  }
  return best;
}

module.exports = { getActiveAutoDiscounts, promoFor, attachPromos, quoteAutoDiscount };
