const { getDb } = require('../config/database');
const { success, notFound } = require('../utils/response');

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

    const settings = {};
    const rows = db.prepare('SELECT key, value FROM store_settings WHERE store_id = ?').all(store.id);
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value); }
      catch { settings[row.key] = row.value; }
    }

    return success(res, { store, settings });
  } catch (err) { next(err); }
};

const getShopSettings = (req, res, next) => {
  try {
    const { slug } = req.params;
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE slug = ? AND status = ?').get(slug, 'active');
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const settings = {};
    const rows = db.prepare('SELECT key, value FROM store_settings WHERE store_id = ?').all(store.id);
    for (const row of rows) {
      try { settings[row.key] = JSON.parse(row.value); }
      catch { settings[row.key] = row.value; }
    }

    return success(res, settings);
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
    if (category) { where += ' AND p.category = ?'; params.push(category); }

    const sortMap = {
      name_asc: 'p.name ASC', name_desc: 'p.name DESC',
      price_asc: 'p.price ASC', price_desc: 'p.price DESC',
      created_at_desc: 'p.created_at DESC', created_at_asc: 'p.created_at ASC',
    };
    const orderBy = sortMap[sort] || 'p.created_at DESC';
    const offset = (Number(page) - 1) * Number(limit);

    const total = db.prepare(`SELECT COUNT(*) as c FROM products p ${where}`).get(...params).c;
    const items = db.prepare(
      `SELECT p.id, p.sku, p.name, p.price, p.stock, p.image_urls, p.category, p.created_at, p.description FROM products p ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`
    ).all(...params, Number(limit), offset);

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
      "SELECT id, sku, name, price, image_urls, category FROM products WHERE store_id = ? AND id != ? AND status = 'published' AND category = ? LIMIT 6"
    ).all(store.id, id, product.category);
    for (const r of related) {
      try { r.image_urls = JSON.parse(r.image_urls || '[]'); } catch { r.image_urls = []; }
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

module.exports = { resolveDomain, getShopSettings, getShopProducts, getShopProduct, getShopContent };
