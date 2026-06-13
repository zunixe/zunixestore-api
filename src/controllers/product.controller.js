const { getDb, uuid } = require('../config/database');
const { success, created, error, notFound } = require('../utils/response');

const createProduct = async (req, res, next) => {
  try {
    const { sku, name, description, price, stock, status, image_urls, category } = req.body;
    if (!name || price === undefined) return error(res, 'Nama dan harga wajib diisi', 400);
    const db = getDb();
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

module.exports = { createProduct, getProducts, getProduct, updateProduct, deleteProduct, updateProductAvailability, getProductInventory };
