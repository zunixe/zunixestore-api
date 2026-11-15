/*
 * Impor data toko dari folder zunixe-mockup (salinan statis www.zunixe.com) ke store "zunixe".
 *  - Backup DB dulu ke backups/zunixestore-<waktu>.db
 *  - Produk lama toko disembunyikan (status 'draft'), tidak dihapus
 *  - Produk mockup dibuat dengan id "mk-<id>" + gambar disalin ke uploads/mockup
 *  - Setting beranda (slider, promo, best seller, bundle) diisi sama dengan mockup
 * Jalankan: node scripts/import-mockup.js <path mock-data.json> <path folder mockup>
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const [dataPath, mockDir, detailPath, polPath, infoPath] = process.argv.slice(2);
if (!dataPath || !mockDir) { console.error('usage: node scripts/import-mockup.js mock-data.json mockupDir'); process.exit(1); }

const ROOT = path.join(__dirname, '..');
const STORE_ID = 'adcd528c-c8c7-4e91-8652-7f2e2871d993';
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const detail = detailPath ? JSON.parse(fs.readFileSync(detailPath, 'utf8')) : {};
const db = new Database(path.join(ROOT, 'zunixestore.db'));

const outDir = path.join(ROOT, 'uploads', 'mockup');
fs.mkdirSync(outDir, { recursive: true });
const copy = (rel) => {
  if (!rel) return null;
  const name = path.basename(rel);
  const src = path.join(mockDir, 'assets', name);
  if (!fs.existsSync(src)) { console.warn('missing asset', name); return null; }
  fs.copyFileSync(src, path.join(outDir, name));
  return `/uploads/mockup/${name}`;
};
const num = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;

const CATEGORY = { 731421: 'Amplifier', 734492: 'Amplifier', 866131: 'Board', 867192: 'Board' };
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

// Kartu dari products.html = urutan "Unggulan"; bundle juga ikut sebagai kartu.
const cards = data.products;
const latestOrder = data.index.filter((c) => c.section === 'Produk Terbaru' && /product-/.test(c.href)).map((c) => c.href.match(/\d+/)[0]);
const bestOrder = data.index.filter((c) => c.section === 'Best Seller').map((c) => `mk-${c.href.match(/\d+/)[0]}`);

const rows = cards.map((c, position) => {
  const isBundle = /bundle-/.test(c.href);
  const pid = (c.href.match(/(\d+)/) || [])[1];
  const id = isBundle ? `mk-bundle-${pid}` : pid ? `mk-${pid}` : `mk-${slug(c.name)}`;
  const t = c.text;
  const prices = t.filter((x) => /^Rp /.test(x)).map(num);
  const price = prices.length ? prices[prices.length - 1] : 0;
  const retail = c.strike ? num(c.strike) : 0;
  const soldLine = t.find((x) => /Terjual$/.test(x));
  const extra = t.find((x) => /^Extra /.test(x));
  const det = pid && data.details[pid];
  const dd = pid && detail[pid];
  const galleryRaw = dd && dd.gallery.length ? dd.gallery : det && det.imgs.length ? det.imgs : [c.img];
  const images = galleryRaw.map(copy).filter(Boolean);
  // Deskripsi kaya (HTML Quill dari zunixe.com): gambar disalin & src diarahkan ke /uploads/mockup.
  const html = dd ? dd.html.replace(/src="assets\/([^"]+)"/g, (_, f) => { copy(`assets/${f}`); return `src="/uploads/mockup/${f}"`; }) : '';
  const weight = dd && (dd.ship.match(/Berat:\s*([^\n]+)/) || [])[1];
  const description = {
    source: 'zunixe-mockup',
    position,
    ...(retail ? { retail_price: retail } : {}),
    ...(extra ? { extra_label: extra } : {}),
    ...(soldLine ? { sold: num(soldLine) } : {}),
    ...(det ? { text: det.desc.trim() } : {}),
    ...(html ? { html } : {}),
    ...(weight ? { weight } : {}),
    ...(det && /Beli Rp 100,000 Diskon 10%/.test(det.text) ? { promo_note: 'Beli Rp 100,000 Diskon 10%' } : {}),
    ...(isBundle ? { is_bundle: true, bundle_label: 'Produk Bundle', subtitle: t[t.length - 1] } : {}),
  };
  return { id, name: c.name, price, images, description, category: CATEGORY[pid] || null, pid, isBundle };
});

// created_at: Produk Terbaru di beranda paling baru (urutan sesuai mockup), sisanya lebih lama.
const base = Date.parse('2026-04-10T00:00:00Z');
const createdAt = (r) => {
  const li = latestOrder.indexOf(r.pid);
  // Bundle tampil paling depan di Produk Terbaru (seperti mockup).
  const offsetMin = r.isBundle ? 1001 : li >= 0 ? 1000 - li : 500 - rows.indexOf(r);
  return new Date(base + offsetMin * 60000).toISOString().replace('T', ' ').slice(0, 19);
};

const bundle = rows.find((r) => r.isBundle);
if (bundle) {
  // Isi bundle sesuai bundle-3312.html: ZK-502C + Adaptor 12V 2A, diskon 10%.
  bundle.description.bundle_title = 'ZK-502C HIFI DIGITAL POWER AMPLIFIER + ADAPTOR POWER SUPPLY AC TO DC 12V 2A';
  bundle.description.discount_pct = 10;
  bundle.description.items = [
    { title: 'ZK-502C HIFI DIGITAL POWER AMPLIFIER', product_id: 'mk-734492' },
    { title: 'ADAPTOR POWER SUPPLY AC TO DC 12V 2A', product_id: 'mk-733940' },
  ];
}

const backupDir = path.join(ROOT, 'backups');
fs.mkdirSync(backupDir, { recursive: true });
const backupFile = path.join(backupDir, `zunixestore-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);

const setSetting = db.prepare(
  `INSERT INTO store_settings (store_id, key, value) VALUES (?, ?, ?)
   ON CONFLICT(store_id, key) DO UPDATE SET value = excluded.value`
);

db.backup(backupFile).then(() => {
  console.log('backup:', backupFile);
  const tx = db.transaction(() => {
    const hidden = db.prepare("UPDATE products SET status = 'draft' WHERE store_id = ? AND id NOT LIKE 'mk-%' AND status = 'published'").run(STORE_ID).changes;
    const up = db.prepare(`INSERT INTO products (id, store_id, sku, name, description, price, stock, status, image_urls, category, created_at, updated_at)
      VALUES (@id, @store, @sku, @name, @description, @price, 100, 'published', @images, @category, @created, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, description=excluded.description, price=excluded.price, stock=excluded.stock,
        status='published', image_urls=excluded.image_urls, category=excluded.category, created_at=excluded.created_at, updated_at=datetime('now')`);
    for (const r of rows) {
      up.run({ id: r.id, store: STORE_ID, sku: r.pid || null, name: r.name, description: JSON.stringify(r.description), price: r.price,
        images: JSON.stringify(r.images), category: r.category, created: createdAt(r) });
    }
    const slides = data.slides.map(copy).filter(Boolean);
    const countdownBg = copy('assets/1775322100611-zunixe_resized2048-jpg_68954f.webp');
    setSetting.run(STORE_ID, 'slider_images', JSON.stringify(slides));
    if (countdownBg) setSetting.run(STORE_ID, 'hero_banner_url', JSON.stringify(countdownBg));
    setSetting.run(STORE_ID, 'hero_title', JSON.stringify('Super Promo'));
    setSetting.run(STORE_ID, 'hero_subtitle', JSON.stringify('Promo terbatas hanya sampai 30 April'));
    setSetting.run(STORE_ID, 'store_tagline', JSON.stringify('Mitra Terpercaya Inovasi Elektronika Anda'));
    setSetting.run(STORE_ID, 'featured_products', JSON.stringify(bestOrder));
    // Halaman Tentang Kami & kebijakan: HTML Quill dari zunixe.com.
    if (infoPath && fs.existsSync(infoPath)) {
      const raw = JSON.parse(fs.readFileSync(infoPath, 'utf8')).html || '';
      const m = raw.match(/<div class="mt-4">(<div class="quill-editor-v2">[\s\S]*?<\/div>)<\/div><div class="flex flex-col items-center py-16">/);
      if (m) setSetting.run(STORE_ID, 'about_html', JSON.stringify(m[1]));
    }
    if (polPath && fs.existsSync(polPath)) {
      const pol = JSON.parse(fs.readFileSync(polPath, 'utf8'));
      for (const k of ['tos', 'privacy', 'shipping', 'refund', 'ip']) if (pol[k] && pol[k].html) setSetting.run(STORE_ID, `policy_${k}`, JSON.stringify(pol[k].html));
    }
    console.log({ hidden, imported: rows.length, slides: slides.length, best: bestOrder.length });
  });
  tx();
}).catch((e) => { console.error(e); process.exit(1); });
