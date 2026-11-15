const { getDb, uuid } = require('../config/database');
const { success, created, error, notFound, badRequest } = require('../utils/response');

const DEFAULT_SOURCE = process.env.ZUNIXECORP_PRODUCTS_URL || 'http://localhost:3000/api/bridge/store-products?shop=default&limit=100';

const createProduct = async (req, res, next) => {
  try {
    const { sku, name, description, price, stock, status, image_urls, category } = req.body;
    if (!name || price === undefined) return error(res, 'Nama dan harga wajib diisi', 400);
    const db = getDb();
    // Kuota produk sesuai paket (Plugo: Lite 30, Basic 100, Business 500, Enterprise ∞).
    const { PLANS, getPlanOf } = require('./subscription.controller');
    const limit = PLANS[getPlanOf(db, req.params.id)].quota.products;
    if (limit !== null) {
      const used = db.prepare('SELECT COUNT(*) c FROM products WHERE store_id = ?').get(req.params.id).c;
      if (used >= limit) return error(res, `Kuota produk paket kamu habis (${used}/${limit}). Upgrade paket untuk menambah produk.`, 403);
    }
    const id = uuid();
    db.prepare(`INSERT INTO products (id, store_id, sku, name, description, price, stock, status, image_urls, category) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, req.params.id, sku || null, name, description || null, price, stock || 0, status || 'published', JSON.stringify(image_urls || []), category || null);
    return created(res, db.prepare('SELECT * FROM products WHERE id = ?').get(id), 'Produk berhasil dibuat');
  } catch (err) { next(err); }
};

const getProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, search, status, category, sort } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const db = getDb();
    let where = 'WHERE store_id = ?';
    const params = [req.params.id];
    if (search) { where += ' AND (name LIKE ? OR sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (category) { where += ' AND category = ?'; params.push(category); }
    let orderBy = 'ORDER BY created_at DESC';
    if (sort === 'name_asc') orderBy = 'ORDER BY name ASC';
    if (sort === 'name_desc') orderBy = 'ORDER BY name DESC';
    if (sort === 'price_asc') orderBy = 'ORDER BY price ASC';
    if (sort === 'price_desc') orderBy = 'ORDER BY price DESC';
    const items = db.prepare(`SELECT * FROM products ${where} ${orderBy} LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as c FROM products ${where}`).get(...params).c;
    const totalAll = db.prepare('SELECT COUNT(*) as c FROM products WHERE store_id = ?').get(req.params.id).c;
    return success(res, { items, total, total_all: totalAll, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

const getProduct = async (req, res, next) => {
  try { const p = getDb().prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.productId, req.params.id); if (!p) return notFound(res); return success(res, p); }
  catch (err) { next(err); }
};

const updateProduct = async (req, res, next) => {
  try {
    const { sku, name, description, price, stock, status, image_urls, category } = req.body;
    const db = getDb();
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.productId, req.params.id);
    if (!p) return notFound(res);
    db.prepare(`UPDATE products SET sku=COALESCE(?,sku), name=COALESCE(?,name), description=COALESCE(?,description), price=COALESCE(?,price), stock=COALESCE(?,stock), status=COALESCE(?,status), image_urls=COALESCE(?,image_urls), category=COALESCE(?,category), updated_at=datetime('now') WHERE id=?`)
      .run(sku||null, name||null, description||null, price!=null?price:null, stock!=null?stock:null, status||null, image_urls?JSON.stringify(image_urls):null, category||null, req.params.productId);
    return success(res, db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId), 'Produk diperbarui');
  } catch (err) { next(err); }
};

const deleteProduct = async (req, res, next) => {
  try { getDb().prepare('DELETE FROM products WHERE id = ? AND store_id = ?').run(req.params.productId, req.params.id); return success(res, null, 'Produk dihapus'); }
  catch (err) { next(err); }
};

const updateProductAvailability = async (req, res, next) => {
  try {
    const { availability } = req.body;
    const db = getDb();
    const p = db.prepare('SELECT * FROM products WHERE id = ? AND store_id = ?').get(req.params.productId, req.params.id);
    if (!p) return notFound(res);
    let desc = {};
    try { desc = JSON.parse(p.description || '{}'); } catch {}
    desc.availability = availability;
    db.prepare("UPDATE products SET description = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(desc), req.params.productId);
    return success(res, db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.productId), 'Ketersediaan diperbarui');
  } catch (err) { next(err); }
};

const getProductInventory = async (req, res, next) => {
  try {
    const db = getDb();
    const p = db.prepare('SELECT id, name, sku, stock, category FROM products WHERE id = ? AND store_id = ?').get(req.params.productId, req.params.id);
    if (!p) return notFound(res);
    const history = db.prepare('SELECT * FROM inventory_history WHERE product_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.productId);
    return success(res, { product: p, history });
  } catch (err) { next(err); }
};

const syncShopee = async (req, res, next) => {
  try {
    const { source, products } = req.body;
    const db = getDb();
    let items = products;

    if (!items && source) {
      const resp = await fetch(source);
      if (!resp.ok) return error(res, `Gagal mengambil produk dari sumber (${resp.status})`, 502);
      const data = await resp.json();
      items = data.items || [];
    }

    if (!Array.isArray(items)) return badRequest(res, 'products harus berupa array');
    if (items.length === 0) return success(res, { synced: 0, created: 0, updated: 0, skipped: 0 }, 'Tidak ada produk untuk disinkronkan');

    const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(req.params.id);
    if (!store) return notFound(res, 'Toko tidak ditemukan');

    const findSku = db.prepare('SELECT id, store_id FROM products WHERE store_id = ? AND sku = ?');
    const upsert = db.prepare(`INSERT INTO products (id, store_id, sku, name, description, price, stock, status, image_urls, category, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, price=excluded.price, stock=excluded.stock, image_urls=excluded.image_urls, category=excluded.category, status='published', updated_at=datetime('now')`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    const tx = db.transaction(() => {
      for (const p of items) {
        const sku = String(p.sku || p.itemId || p.id || '');
        const name = String(p.name || p.itemName || '').trim();
        if (!sku || !name) { skipped++; continue; }

        const price = Math.round(Number(p.price || p.jual || 0));
        const stock = Math.max(0, Math.round(Number(p.stock || p.totalStock || 0)));
        const category = String(p.category || '');

        let imageList = [];
        if (Array.isArray(p.imageList)) imageList = p.imageList.filter(Boolean);
        else if (p.imageUrl) imageList = [p.imageUrl];
        if (imageList.length === 0 && Array.isArray(p.images)) imageList = p.images.filter(Boolean);

        const images = imageList.map((u) => (typeof u === 'string' && u.startsWith('http') ? u : `https://cf.shopee.co.id/file/${u}`));
        const description = JSON.stringify({ source: 'shopee', shopeeItemId: p.itemId || p.id, seoTitle: p.seoTitle || '', models: p.models || [] });

        const existing = findSku.get(req.params.id, sku);
        if (existing) {
          db.prepare(`UPDATE products SET name=?, description=?, price=?, stock=?, image_urls=?, category=?, status='published', updated_at=datetime('now') WHERE id=?`)
            .run(name, description, price, stock, JSON.stringify(images), category, existing.id);
          updated++;
        } else {
          upsert.run(uuid(), req.params.id, sku, name, description, price, stock, 'published', JSON.stringify(images), category);
          created++;
        }
      }
    });
    tx();

    return success(res, { synced: created + updated, created, updated, skipped, storeId: req.params.id }, 'Sinkronisasi produk selesai');
  } catch (err) { next(err); }
};

const clearSyncedProducts = async (req, res, next) => {
  try {
    const db = getDb();
    const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(req.params.id);
    if (!store) return notFound(res, 'Toko tidak ditemukan');
    const result = db.prepare("DELETE FROM products WHERE store_id = ? AND description LIKE '%shopee%'").run(req.params.id);
    return success(res, { deleted: result.changes }, 'Produk sinkron dihapus');
  } catch (err) { next(err); }
};

module.exports = { createProduct, getProducts, getProduct, updateProduct, deleteProduct, updateProductAvailability, getProductInventory, syncShopee, clearSyncedProducts };
