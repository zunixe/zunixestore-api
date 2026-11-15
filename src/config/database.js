const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', 'zunixestore.db');

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
    migrate();
    seedData();
  }
  return db;
}

function migrate() {
  try { db.exec('ALTER TABLE profiles ADD COLUMN pin_hash TEXT'); } catch (e) {}
  try { db.exec("ALTER TABLE profiles ADD COLUMN ktp_verified INTEGER DEFAULT 0"); } catch (e) {}
  try { db.exec('ALTER TABLE profiles ADD COLUMN language TEXT DEFAULT "id"'); } catch (e) {}
  try { db.exec('ALTER TABLE profiles ADD COLUMN push_enabled INTEGER DEFAULT 1'); } catch (e) {}
  try { db.exec('ALTER TABLE profiles ADD COLUMN notif_prefs TEXT DEFAULT \'{}\''); } catch (e) {}
  try { db.exec('ALTER TABLE profiles ADD COLUMN phone_verified INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN shipping_courier TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN shipping_awb TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN payment_method TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN paid_at TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN discount_code TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN discount_amount INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN extra_fee INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN is_dropship INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN shipper_name TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN shipper_phone TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN checkout_answer TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN shipping_service TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN destination_postal_code TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE orders ADD COLUMN destination_area_id TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE order_items ADD COLUMN fulfilled INTEGER DEFAULT 0'); } catch (e) {}
  try { db.exec('ALTER TABLE discounts ADD COLUMN product_ids TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE customers ADD COLUMN birthdate TEXT'); } catch (e) {}
  // Tema = template storefront (nama folder di ZunixeStore-Frontend/src/templates).
  try { db.exec('ALTER TABLE themes ADD COLUMN template TEXT'); } catch (e) {}
  try { db.exec('ALTER TABLE themes ADD COLUMN description TEXT'); } catch (e) {}
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT,
      avatar_url TEXT,
      phone TEXT,
      role TEXT DEFAULT 'owner',
      password_hash TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      domain TEXT,
      owner_id TEXT NOT NULL REFERENCES profiles(id),
      logo_url TEXT,
      plan TEXT DEFAULT 'basic',
      plan_expiry TEXT,
      status TEXT DEFAULT 'active',
      settings TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS store_users (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      role TEXT DEFAULT 'staff',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      sku TEXT,
      name TEXT NOT NULL,
      description TEXT,
      price INTEGER NOT NULL,
      stock INTEGER DEFAULT 0,
      status TEXT DEFAULT 'published',
      image_urls TEXT DEFAULT '[]',
      category TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      order_code TEXT UNIQUE,
      customer_id TEXT,
      customer_name TEXT,
      customer_email TEXT,
      customer_phone TEXT,
      status TEXT DEFAULT 'pending',
      payment_status TEXT DEFAULT 'unpaid',
      subtotal INTEGER DEFAULT 0,
      shipping_cost INTEGER DEFAULT 0,
      total INTEGER DEFAULT 0,
      shipping_address TEXT,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      product_id TEXT,
      product_name TEXT,
      quantity INTEGER NOT NULL,
      price INTEGER NOT NULL,
      total INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      name TEXT,
      email TEXT,
      phone TEXT,
      address TEXT,
      total_orders INTEGER DEFAULT 0,
      total_spent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS discounts (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      code TEXT,
      type TEXT NOT NULL,
      value INTEGER NOT NULL,
      min_purchase INTEGER DEFAULT 0,
      max_discount INTEGER,
      start_date TEXT,
      end_date TEXT,
      usage_limit INTEGER,
      usage_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS themes (
      id TEXT PRIMARY KEY,
      name TEXT,
      config TEXT DEFAULT '{}',
      preview_url TEXT,
      is_active INTEGER DEFAULT 0,
      store_id TEXT REFERENCES stores(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS analytics (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      visitors INTEGER DEFAULT 0,
      page_views INTEGER DEFAULT 0,
      orders INTEGER DEFAULT 0,
      revenue INTEGER DEFAULT 0,
      conversion_rate REAL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store_id, date)
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      plan TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      start_date TEXT,
      end_date TEXT,
      amount INTEGER,
      payment_method TEXT,
      payment_status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory_history (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      change INTEGER NOT NULL,
      stock_after INTEGER NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );


    CREATE TABLE IF NOT EXISTS carts (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
      customer_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cart_items (
      id TEXT PRIMARY KEY,
      cart_id TEXT NOT NULL REFERENCES carts(id) ON DELETE CASCADE,
      product_id TEXT NOT NULL,
      product_name TEXT,
      product_image TEXT,
      price INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 1,
      total INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_carts_store ON carts(store_id);
    CREATE INDEX IF NOT EXISTS idx_carts_user ON carts(user_id);
    CREATE INDEX IF NOT EXISTS idx_cart_items_cart ON cart_items(cart_id);
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      product_id TEXT,
      product_name TEXT,
      customer_name TEXT,
      rating INTEGER NOT NULL,
      text TEXT,
      aspects TEXT,
      reply TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      ref_id TEXT,
      read_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_store ON notifications(store_id);
    CREATE TABLE IF NOT EXISTS order_events (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'event',
      message TEXT NOT NULL,
      actor TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_order_events_order ON order_events(order_id);
    CREATE TABLE IF NOT EXISTS store_settings (
      id TEXT PRIMARY KEY,
      store_id TEXT NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(store_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_products_store ON products(store_id);
    CREATE INDEX IF NOT EXISTS idx_orders_store ON orders(store_id);
    CREATE INDEX IF NOT EXISTS idx_customers_store ON customers(store_id);
    CREATE INDEX IF NOT EXISTS idx_store_users_user ON store_users(user_id);
  `);
}

function seedData() {
  const count = db.prepare('SELECT COUNT(*) as c FROM themes').get();
  if (count.c === 0) {
    const insert = db.prepare('INSERT INTO themes (id, name, config, is_active) VALUES (?, ?, ?, ?)');
    insert.run('t1', 'Default Light', '{"primary_color":"#4169E0","bg_color":"#eff3f8","sidebar_color":"#f9fafb"}', 0);
    insert.run('t2', 'Dark Mode', '{"primary_color":"#6366f1","bg_color":"#1e1e2e","sidebar_color":"#181825"}', 0);
    insert.run('t3', 'Minimal', '{"primary_color":"#10b981","bg_color":"#fafafa","sidebar_color":"#ffffff"}', 0);
  }

  // Katalog template storefront. Ditambahkan sekali; baris yang sudah ada tidak diubah.
  const tpl = db.prepare(
    'INSERT OR IGNORE INTO themes (id, name, config, preview_url, template, description, is_active) VALUES (?, ?, ?, ?, ?, ?, 0)'
  );
  tpl.run(
    'tpl-basic-shop', 'Basic Shop',
    '{"primary_color":"#DB0028","secondary_color":"#0C0103","footer_color":"#D62043"}',
    '/uploads/templates/basic-shop.jpg', 'basic-shop',
    'Toko serba ada: banner geser, promo hitung mundur, Best Seller, Produk Terbaru, dan FAQ.'
  );
  tpl.run(
    'tpl-default', 'Default Design',
    '{"primary_color":"#DB0028","secondary_color":"#0C0103","footer_color":"#D62043"}',
    '/uploads/templates/default.jpg', 'default',
    'Desain dasar ZunixeStore.'
  );
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

module.exports = { getDb, uuid };
