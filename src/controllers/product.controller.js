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
    const { page = 1, limit = 10, search, status } = req.query;
    const offset = (Number(page) - 1) * Number(limit);
    const db = getDb();
    let where = 'WHERE store_id = ?';
    const params = [req.params.id];
    if (search) { where += ' AND name LIKE ?'; params.push(`%${search}%`); }
    if (status) { where += ' AND status = ?'; params.push(status); }
    const items = db.prepare(`SELECT * FROM products ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as c FROM products ${where}`).get(...params).c;
    return success(res, { items, total, page: Number(page), limit: Number(limit) });
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

module.exports = { createProduct, getProducts, getProduct, updateProduct, deleteProduct };
