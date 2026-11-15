const { getDb, uuid } = require('../config/database');
const { success, created, notFound, badRequest } = require('../utils/response');

/*
 * Pengaturan toko yang boleh dibaca publik (storefront).
 * Tabel store_settings juga menyimpan data internal admin (grup customer berisi ID customer,
 * link afiliasi, template notifikasi, aturan pesanan, galeri media, dll.), jadi endpoint publik
 * hanya mengirim key yang ada di daftar ini. Tambahkan key baru di sini HANYA jika memang
 * perlu ditampilkan ke pengunjung toko.
 */
const PUBLIC_SETTING_KEYS = new Set([
  // Tampilan & konten toko
  'template', 'primary_color', 'secondary_color', 'footer_color',
  'store_tagline', 'announcement_text', 'countdown_end',
  'hero_title', 'hero_subtitle', 'hero_banner_url', 'home_banners', 'slider_images',
  'about_html', 'policy_tos', 'policy_privacy', 'policy_shipping', 'policy_refund', 'policy_ip',
  'about_content', 'contact_content', 'faq_content', 'faqs', 'blog_posts', 'custom_pages', 'testimonials',
  'featured_product_id', 'featured_products', 'product_categories', 'product_bundles',
  // Draft & field editor tema (Desain Toko di zunixestore_web)
  'design_live', 'countdown_title', 'countdown_desc',
  'featured_title', 'featured_product_ids', 'latest_title', 'latest_count', 'faq_title',
  'footer_text_color', 'footer_cols', 'wishlist_enabled', 'bottom_nav_enabled', 'custom_css',
  // Kontak & sosial
  'contact_address', 'contact_email',
  'social_facebook', 'social_instagram', 'social_tiktok', 'social_whatsapp',
  // Checkout
  'payment_methods', 'payment_cod', 'payment_ewallet', 'payment_transfer_bank', 'shipping_methods', 'shipment_promotions', 'free_shipping_packages', 'product_preferences',
  'payment_client_key', 'payment_gateway_mode',
  // Aturan pesanan & checkout + kurir per nama (Pengaturan Pesanan / Pengiriman / Pembayaran / Customer).
  'order_preferences', 'checkout_prefs', 'buyer_notifications',
  'shipping_jne', 'shipping_jnt', 'shipping_sicepat', 'shipping_anteraja', 'shipping_gosend',
  'seo_title', 'seo_description',
  // Piksel pelacakan (memang dipasang di halaman publik)
  'facebook_pixel_id', 'google_analytics_id', 'tiktok_pixel_id', 'google_ads_id',
]);

function getPublicSettings(db, storeId) {
  const settings = {};
  const rows = db.prepare('SELECT key, value FROM store_settings WHERE store_id = ?').all(storeId);
  for (const row of rows) {
    if (!PUBLIC_SETTING_KEYS.has(row.key)) continue;
    try { settings[row.key] = JSON.parse(row.value); }
    catch { settings[row.key] = row.value; }
  }
  return settings;
}

const resolveDomain = (req, res, next) => {
  try {
    const { domain } = req.query;
    if (!domain) return success(res, { store: null, message: 'Domain required' });

    const db = getDb();
    let store = db.prepare(
      'SELECT id, name, slug, domain, logo_url, plan, status FROM stores WHERE domain = ? AND status = ?'
    ).get(domain, 'active');

    if (!store) {
      const parts = domain.split('.');
      const hostname = parts[0];
      store = db.prepare(
        'SELECT id, name, slug, domain, logo_url, plan, status FROM stores WHERE slug = ? AND status = ?'
      ).get(hostname, 'active');
    }

    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const settings = getPublicSettings(db, store.id);
    return success(res, { store, settings });
  } catch (err) { next(err); }
};

const getShopSettings = (req, res, next) => {
  try {
    const { slug } = req.params;
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    return success(res, getPublicSettings(db, store.id));
  } catch (err) { next(err); }
};

const getShopProducts = (req, res, next) => {
  try {
    const { slug } = req.params;
    const { page = 1, limit = 12, search, category, sort = 'created_at_desc' } = req.query;

    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    let where = "WHERE p.store_id = ? AND p.status = 'published'";
    const params = [store.id];

    if (search) { where += ' AND p.name LIKE ?'; params.push(`%${search}%`); }
    if (category) {
      // Boleh lebih dari satu kategori, dipisah koma (filter "Kategori" di storefront).
      const cats = String(category).split(',').map((c) => c.trim()).filter(Boolean).slice(0, 50);
      if (cats.length) {
        where += ` AND p.category IN (${cats.map(() => '?').join(',')})`;
        params.push(...cats);
      }
    }
    if (req.query.in_stock === '1') where += ' AND p.stock > 0';
    else {
      // Pengaturan Produk "Sembunyikan produk habis" — berlaku ke seluruh katalog publik.
      const pp = db.prepare("SELECT value FROM store_settings WHERE store_id = ? AND key = 'product_preferences'").get(store.id);
      // Plugo: produk pre-order (PO) dan waiting list tetap ditampilkan.
      try {
        if (pp && JSON.parse(pp.value)?.hide_sold_out) {
          where += " AND (p.stock > 0 OR COALESCE(json_extract(COALESCE(p.description,'{}'),'$.availability'),'stock') IN ('preorder','waiting_list'))";
        }
      } catch { /* abaikan */ }
    }
    // Produk dengan "Ketika tidak ada stok = Sembunyikan" disaring dari katalog publik.
    where += " AND NOT (p.stock <= 0 AND COALESCE(json_extract(COALESCE(p.description,'{}'),'$.out_of_stock'),'') = 'hidden')";
    // Tipe produk: diskon = punya harga coret (retail_price) di atas harga jual;
    // unggulan = ID di setting featured_products (atau featured_product_id).
    let featuredIds = null;
    if (req.query.type === 'bundle') {
      where += " AND json_extract(p.description, '$.is_bundle') = 1";
    } else if (req.query.type === 'discount') {
      where += " AND CAST(json_extract(p.description, '$.retail_price') AS INTEGER) > p.price";
    } else if (req.query.type === 'featured') {
      const rows = db.prepare(
        "SELECT key, value FROM store_settings WHERE store_id = ? AND key IN ('featured_products', 'featured_product_id')"
      ).all(store.id);
      let ids = [];
      for (const r of rows) {
        let v; try { v = JSON.parse(r.value); } catch { v = r.value; }
        if (Array.isArray(v)) ids.push(...v.map((x) => (x && typeof x === 'object' ? x.id || x.product_id : x)));
        else if (v) ids.push(v);
      }
      ids = [...new Set(ids.filter(Boolean).map(String))].slice(0, 100);
      where += ids.length ? ` AND p.id IN (${ids.map(() => '?').join(',')})` : ' AND 0';
      params.push(...ids);
      featuredIds = ids;
    }
    const minPrice = Number(req.query.min_price);
    const maxPrice = Number(req.query.max_price);
    if (Number.isFinite(minPrice) && req.query.min_price !== undefined && req.query.min_price !== '') { where += ' AND p.price >= ?'; params.push(minPrice); }
    if (Number.isFinite(maxPrice) && req.query.max_price !== undefined && req.query.max_price !== '') { where += ' AND p.price <= ?'; params.push(maxPrice); }

    const sortMap = {
      name_asc: 'p.name ASC', name_desc: 'p.name DESC',
      price_asc: 'p.price ASC', price_desc: 'p.price DESC',
      created_at_desc: 'p.created_at DESC', created_at_asc: 'p.created_at ASC',
      // "Unggulan": urutan manual dari description.position, lalu terbaru.
      position: "COALESCE(CAST(json_extract(p.description, '$.position') AS INTEGER), 999999) ASC, p.created_at DESC",
    };
    let orderBy = sortMap[sort] || 'p.created_at DESC';
    const orderParams = [];
    // Produk unggulan tanpa sort eksplisit: ikuti urutan di setting.
    if (featuredIds && featuredIds.length && !req.query.sort) {
      orderBy = `CASE p.id ${featuredIds.map((id, i) => `WHEN ? THEN ${i}`).join(' ')} END`;
      orderParams.push(...featuredIds);
    }
    const offset = (Number(page) - 1) * Number(limit);

    const total = db.prepare(`SELECT COUNT(*) as c FROM products p ${where}`).get(...params).c;
    const items = db.prepare(
      `SELECT p.id, p.sku, p.name, p.price, p.stock, p.image_urls, p.category, p.created_at, p.description FROM products p ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, ...orderParams, Number(limit), offset);

    const categories = db.prepare(
      "SELECT DISTINCT category FROM products WHERE store_id = ? AND status = 'published' AND category IS NOT NULL AND category != ''"
    ).all(store.id).map(r => r.category);

    for (const item of items) {
      try { item.image_urls = JSON.parse(item.image_urls || '[]'); } catch { item.image_urls = []; }
      try { item.description = JSON.parse(item.description || '{}'); } catch { item.description = {}; }
    }

    return success(res, { items, total, page: Number(page), limit: Number(limit), categories });
  } catch (err) { next(err); }
};

const getShopProduct = (req, res, next) => {
  try {
    const { slug, id } = req.params;
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const product = db.prepare(
      "SELECT id, sku, name, price, stock, image_urls, category, created_at, description FROM products WHERE id = ? AND store_id = ? AND status = 'published'"
    ).get(id, store.id);
    if (!product) return notFound(res, 'Produk tidak ditemukan');

    try { product.image_urls = JSON.parse(product.image_urls || '[]'); } catch { product.image_urls = []; }
    try { product.description = JSON.parse(product.description || '{}'); } catch { product.description = {}; }

    const related = db.prepare(
      // "Rekomendasi lainnya": produk lain menurut urutan manual (description.position), lalu terbaru.
      "SELECT id, sku, name, price, stock, image_urls, category, description FROM products WHERE store_id = ? AND id != ? AND status = 'published' ORDER BY COALESCE(CAST(json_extract(description, '$.position') AS INTEGER), 999999) ASC, created_at DESC LIMIT 5"
    ).all(store.id, id);
    for (const r of related) {
      try { r.image_urls = JSON.parse(r.image_urls || '[]'); } catch { r.image_urls = []; }
      // Cukup harga coret untuk kartu; deskripsi lengkap tidak perlu dikirim.
      try {
        const d = JSON.parse(r.description || '{}');
        r.description = {
          ...(d.retail_price ? { retail_price: d.retail_price } : {}),
          ...(d.is_bundle ? { is_bundle: true, bundle_label: d.bundle_label, subtitle: d.subtitle } : {}),
          ...(d.extra_label ? { extra_label: d.extra_label } : {}),
          ...(d.sold ? { sold: d.sold } : {}),
        };
      } catch { r.description = {}; }
    }

    return success(res, { product, related });
  } catch (err) { next(err); }
};

const getShopContent = (req, res, next) => {
  try {
    const { slug } = req.params;
    const { type } = req.query;
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const key = type === 'blog' ? 'blog_posts' : type === 'about' ? 'about_content' : type === 'contact' ? 'contact_content' : null;
    if (!key) return success(res, null);

    const row = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(store.id, key);
    let value = row ? row.value : '[]';
    try { value = JSON.parse(value); } catch { value = []; }

    return success(res, value);
  } catch (err) { next(err); }
};


const validateDiscount = (req, res, next) => {
  try {
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(req.params.slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');
    const code = String(req.query.code || '').trim().toUpperCase();
    const subtotal = Number(req.query.subtotal) || 0;
    const d = db.prepare(`SELECT * FROM discounts WHERE store_id = ? AND UPPER(code) = ? AND status = 'active'`).get(store.id, code);
    const now = new Date().toISOString().slice(0, 10);
    if (!d) return badRequest(res, 'Kode diskon tidak valid');
    if (d.start_date && d.start_date > now) return badRequest(res, 'Kode diskon belum berlaku');
    if (d.end_date && d.end_date < now) return badRequest(res, 'Kode diskon sudah kedaluwarsa');
    if (d.usage_limit != null && d.usage_count >= d.usage_limit) return badRequest(res, 'Kuota penggunaan kode diskon habis');
    if (d.min_purchase && subtotal < d.min_purchase) return badRequest(res, 'Minimal belanja ' + d.min_purchase + ' untuk kode ini');
    // Diskon bertarget produk: dasar potongan = subtotal item yang cocok saja.
    let base = subtotal;
    const targetIds = (() => { try { const a = JSON.parse(d.product_ids || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } })();
    if (targetIds.length) {
      const items = (() => { try { const a = JSON.parse(String(req.query.items || '[]')); return Array.isArray(a) ? a : []; } catch { return []; } })();
      base = items.filter((i) => targetIds.includes(i.product_id)).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.quantity) || 1), 0);
      if (base <= 0) return badRequest(res, 'Kode diskon tidak berlaku untuk produk di keranjang');
    }
    const amount = d.type === 'percentage'
      ? Math.min(Math.round(base * (Number(d.value) / 100)), d.max_discount ?? base)
      : Math.min(Number(d.value) || 0, base);
    return success(res, { code: d.code, type: d.type, value: d.value, discount_amount: amount, products_only: targetIds.length > 0 });
  } catch (err) { next(err); }
};


/* Ulasan produk publik — digate review_settings.enabled bila admin mematikannya. */
const reviewEnabled = (db, storeId) => {
  const row = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(storeId, 'review_settings');
  if (!row) return true;
  try { return JSON.parse(row.value)?.enabled !== false; } catch { return true; }
};

const getProductReviews = (req, res, next) => {
  try {
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(req.params.slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');
    if (!reviewEnabled(db, store.id)) return success(res, []);
    const items = db.prepare('SELECT id, customer_name, rating, text, aspects, reply, created_at FROM reviews WHERE store_id = ? AND product_id = ? ORDER BY created_at DESC').all(store.id, req.params.id);
    return success(res, items.map((r) => ({ ...r, aspects: r.aspects ? JSON.parse(r.aspects) : null })));
  } catch (err) { next(err); }
};

const createReview = (req, res, next) => {
  try {
    const { product_id, customer_name, rating, text, aspects } = req.body;
    if (!product_id || !customer_name || !rating) return badRequest(res, 'Produk, nama, dan rating wajib diisi');
    const r = Math.max(1, Math.min(5, Math.round(Number(rating)) || 0));
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(req.params.slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');
    if (!reviewEnabled(db, store.id)) return badRequest(res, 'Ulasan produk sedang dinonaktifkan');
    const product = db.prepare('SELECT id, name FROM products WHERE id = ? AND store_id = ?').get(product_id, store.id);
    if (!product) return notFound(res, 'Produk tidak ditemukan');
    const id = uuid();
    db.prepare('INSERT INTO reviews (id, store_id, product_id, product_name, customer_name, rating, text, aspects) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, store.id, product.id, product.name, String(customer_name).slice(0, 100), r, String(text || '').slice(0, 2000), aspects ? JSON.stringify(aspects) : null);
    return created(res, db.prepare('SELECT * FROM reviews WHERE id = ?').get(id), 'Ulasan terkirim');
  } catch (err) { next(err); }
};

module.exports = { getProductReviews, createReview, validateDiscount, resolveDomain, getShopSettings, getShopProducts, getShopProduct, getShopContent };
