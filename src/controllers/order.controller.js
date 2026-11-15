const { getDb, uuid } = require('../config/database');
const { success, created, error, notFound } = require('../utils/response');
const { decrementStock, restoreStock, sweepOrderAutomation } = require('../services/stockService');

// Berat produk (gram) — disimpan di description JSON, konsisten dengan shipping.controller.
const weightOf = (db, orderItem) => {
  try {
    const p = db.prepare('SELECT description FROM products WHERE id = ?').get(orderItem.product_id);
    const d = JSON.parse(p?.description || '{}');
    return Number(d.weight) || 500;
  } catch { return 500; }
};

const logEvent = (db, orderId, type, message, actor = null) => {
  try {
    db.prepare('INSERT INTO order_events (id, order_id, type, message, actor) VALUES (?,?,?,?,?)').run(uuid(), orderId, type, message, actor);
  } catch { /* riwayat bersifat best-effort */ }
};

const createOrder = async (req, res, next) => {
  try {
    const { customer_name, customer_email, customer_phone, items, shipping_address, notes, shipping_cost, payment_method, payment_status } = req.body;
    if (!customer_name || !items?.length) return error(res, 'Nama customer dan items wajib diisi', 400);
    const db = getDb();
    const orderId = uuid();
    const orderCode = `INV-${Date.now().toString(36).toUpperCase()}`;
    let subtotal = 0;
    for (const item of items) subtotal += item.price * item.quantity;
    const ship = Number(shipping_cost) || 0;
    const paid = payment_status === 'paid';
    db.prepare(`INSERT INTO orders (id, store_id, order_code, customer_name, customer_email, customer_phone, subtotal, shipping_cost, total, shipping_address, notes, payment_method, payment_status, status, paid_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(orderId, req.params.id, orderCode, customer_name, customer_email||null, customer_phone||null, subtotal, ship, subtotal + ship, shipping_address?JSON.stringify(shipping_address):null, notes||null, payment_method||null, paid?'paid':'unpaid', paid?'processing':'pending', paid?new Date().toISOString():null);
    const itemInsert = db.prepare('INSERT INTO order_items (id, order_id, product_id, product_name, quantity, price, total) VALUES (?,?,?,?,?,?,?)');
    for (const item of items) { itemInsert.run(uuid(), orderId, item.product_id||null, item.product_name, item.quantity, item.price, item.price*item.quantity); decrementStock(db, req.params.id, item.product_id, item.quantity); }
    logEvent(db, orderId, 'created', `Order dimasukkan oleh admin (${customer_name})`, req.user?.email || 'admin');
    return created(res, db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId), 'Pesanan dibuat');
  } catch (err) { next(err); }
};

const getOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, dateFrom, dateTo, search } = req.query;
    const offset = (Number(page)-1) * Number(limit);
    const db = getDb();
    // Otomatisasi status (auto-batal/auto-selesai) dari Pengaturan Pesanan.
    try { sweepOrderAutomation(db, req.params.id); } catch { /* abaikan */ }
    let where = 'WHERE store_id = ?';
    const params = [req.params.id];
    if (status) { where += ' AND status = ?'; params.push(status); }
    if (dateFrom) { where += ' AND created_at >= ?'; params.push(dateFrom); }
    if (dateTo) { where += ' AND created_at <= ?'; params.push(dateTo+'T23:59:59'); }
    if (search) { where += ' AND (customer_name LIKE ? OR order_code LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
    const items = db.prepare(`SELECT * FROM orders ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, Number(limit), offset);
    const total = db.prepare(`SELECT COUNT(*) as c FROM orders ${where}`).get(...params).c;
    return success(res, { items, total, page: Number(page), limit: Number(limit) });
  } catch (err) { next(err); }
};

const getOrder = async (req, res, next) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.orderId, req.params.id);
    if (!order) return notFound(res);
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const events = db.prepare('SELECT id, type, message, actor, created_at FROM order_events WHERE order_id = ? ORDER BY created_at DESC, rowid DESC').all(order.id);
    return success(res, { ...order, items, events });
  } catch (err) { next(err); }
};

const updateOrder = async (req, res, next) => {
  try {
    const b = req.body;
    const allowed = ['status', 'payment_status', 'payment_method', 'shipping_courier', 'shipping_service', 'shipping_awb', 'shipping_cost', 'notes', 'customer_name', 'customer_phone', 'customer_email', 'shipping_address'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (b[k] !== undefined) { sets.push(`${k} = ?`); params.push(k === 'shipping_cost' ? Number(b[k]) || 0 : b[k]); }
    }
    if (!sets.length && !Array.isArray(b.items_fulfilled)) return error(res, 'Tidak ada field yang diubah', 400);
    const db = getDb();
    const prev = db.prepare('SELECT status, payment_status, paid_at FROM orders WHERE id = ? AND store_id = ?').get(req.params.orderId, req.params.id);
    if (!prev) return notFound(res);
    if (b.payment_status === 'paid' && prev.payment_status !== 'paid') { sets.push("paid_at = datetime('now')"); }
    if (b.payment_status !== undefined && b.payment_status !== 'paid' && prev.paid_at) { sets.push('paid_at = NULL'); }
    sets.push("updated_at = datetime('now')");
    if (sets.length > 1 || params.length) db.prepare(`UPDATE orders SET ${sets.join(', ')} WHERE id = ? AND store_id = ?`).run(...params, req.params.orderId, req.params.id);
    // Fulfillment per item — array id order_items yang ditandai terpenuhi (setara "Tidak terpenuhi" Plugo).
    if (Array.isArray(b.items_fulfilled)) {
      const all = db.prepare('SELECT id FROM order_items WHERE order_id = ?').all(req.params.orderId).map((r) => r.id);
      const marks = b.items_fulfilled.filter((id) => all.includes(id));
      const inList = marks.length ? marks.map(() => '?').join(',') : "''";
      db.prepare(`UPDATE order_items SET fulfilled = CASE WHEN id IN (${inList}) THEN 1 ELSE 0 END WHERE order_id = ?`)
        .run(...marks, req.params.orderId);
      const unfulfilled = all.length - marks.length;
      logEvent(db, req.params.orderId, 'fulfillment', unfulfilled ? `${marks.length}/${all.length} item terpenuhi` : 'Semua item terpenuhi', req.user?.email || 'admin');
    }
    // Stok kembali saat pesanan masuk status batal/refund (sekali saja — lewati kalau sudah batal).
    if ((b.status === 'cancelled' || b.status === 'refunded') && !['cancelled', 'refunded'].includes(prev.status)) {
      restoreStock(db, req.params.id, req.params.orderId);
    }
    if (b.status && b.status !== prev.status) logEvent(db, req.params.orderId, 'status', `Status diubah: ${prev.status} → ${b.status}`, req.user?.email || 'admin');
    if (b.payment_status && b.payment_status !== prev.payment_status) logEvent(db, req.params.orderId, 'payment', `Pembayaran: ${prev.payment_status} → ${b.payment_status}`, req.user?.email || 'admin');
    return success(res, db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId), 'Pesanan diperbarui');
  } catch (err) { next(err); }
};

const updateOrderStatus = async (req, res, next) => {
  try {
    const { status: orderStatus } = req.body;
    if (!orderStatus) return error(res, 'Status wajib diisi', 400);
    req.body = { status: orderStatus };
    return updateOrder(req, res, next);
  } catch (err) { next(err); }
};

const deleteOrder = async (req, res, next) => {
  try { getDb().prepare('DELETE FROM orders WHERE id = ? AND store_id = ?').run(req.params.orderId, req.params.id); return success(res, null, 'Pesanan dihapus'); }
  catch (err) { next(err); }
};

// Catatan admin → Riwayat Order (setara "Update Catatan Admin" di Plugo).
const addOrderEvent = async (req, res, next) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) return error(res, 'Catatan wajib diisi', 400);
    const db = getDb();
    const order = db.prepare('SELECT id FROM orders WHERE id = ? AND store_id = ?').get(req.params.orderId, req.params.id);
    if (!order) return notFound(res);
    logEvent(db, order.id, req.body?.type === 'note' ? 'note' : 'note', message.slice(0, 500), req.user?.email || 'admin');
    return created(res, null, 'Catatan ditambahkan');
  } catch (err) { next(err); }
};

const COURIER_CODE = {
  'jne': 'jne', 'j&t': 'jnt', 'jnt': 'jnt', 'j&t express': 'jnt', 'sicepat': 'sicepat', 'si cepat': 'sicepat',
  'pos': 'pos', 'pos indonesia': 'pos', 'tiki': 'tiki', 'anteraja': 'anteraja', 'lion parcel': 'lion', 'lion': 'lion',
  'ninja xpress': 'ninja', 'ninja': 'ninja', 'gosend': 'gosend', 'grabexpress': 'grab', 'grab express': 'grab',
  'sap express': 'sap', 'sap': 'sap', 'id express': 'ide', 'ide': 'ide', 'jne trucking': 'jne_trucking',
  'paxel': 'paxel', 'rpx': 'rpx', 'deliveree': 'deliveree', 'sentral cargo': 'sentral',
};
const SERVICE_CODE = {
  'reguler': 'reg', 'reg': 'reg', 'yes': 'yes', 'oke': 'oke', 'ez': 'ez', 'jnd': 'jnd', 'jtr': 'jtr', 'jso': 'jso',
  'cts': 'cts', 'ons': 'ons', 'sds': 'sds', 'next day': 'ntr', 'same day': 'sds', 'cargo': 'jtr', 'standard': 'reg',
  'jago pack': 'jagopack', 'jagopack': 'jagopack', 'ekonomi':'reg', 'express':'reg', 'premium':'premium',
};

// "Pesan Penjemputan" — bikin order di Biteship → waybill/resi otomatis, status maju ke Terkirim.
const requestPickup = async (req, res, next) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.orderId, req.params.id);
    if (!order) return notFound(res);
    if (order.shipping_awb) return error(res, `Resi sudah ada: ${order.shipping_awb}`, 400);

    const srow = (key) => { const r = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(order.store_id, key); try { return r ? JSON.parse(r.value) : null; } catch { return r?.value ?? null; } };
    const apiKey = srow('shipping_api_key') || process.env.BITESHIP_API_KEY;
    if (!apiKey) return error(res, 'API key Biteship belum diatur — isi di Pengaturan → Metode Pengiriman', 400);
    const origin = srow('shipping_origin');
    if (!origin?.address) return error(res, 'Alamat asal toko belum diatur', 400);

    const courier = COURIER_CODE[String(order.shipping_courier || '').toLowerCase()];
    if (!courier) return error(res, `Kurir "${order.shipping_courier}" tidak dikenali Biteship — ubah kurir dulu`, 400);
    const svc = SERVICE_CODE[String(order.shipping_service || '').toLowerCase()] || String(order.shipping_service || 'reg').toLowerCase();
    const addr = typeof order.shipping_address === 'string' ? (() => { try { return JSON.parse(order.shipping_address); } catch { return { address: order.shipping_address }; } })() : (order.shipping_address || {});
    const destPostal = order.destination_postal_code || String(addr.postal_code || '').match(/\d{5}/)?.[0] || String(addr.address || '').match(/\b\d{5}\b/)?.[0];
    const destArea = order.destination_area_id || req.body?.destination_area_id;
    if (!destPostal && !destArea) return error(res, 'Kode pos tujuan tidak diketahui — lengkapi alamat dengan kode pos, atau kirim destination_area_id', 400);

    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    const body = {
      shipper_contact_name: origin.contact_name || origin.name || 'Pengirim',
      shipper_contact_phone: origin.phone || origin.contact_phone || '-',
      origin_contact_name: origin.contact_name || origin.name || 'Pengirim',
      origin_contact_phone: origin.phone || origin.contact_phone || '-',
      origin_address: origin.address,
      destination_contact_name: order.customer_name || 'Penerima',
      destination_contact_phone: order.customer_phone || '-',
      destination_contact_email: order.customer_email || '',
      destination_address: addr.address || String(order.shipping_address || ''),
      courier_company: courier,
      courier_type: svc,
      delivery_type: 'later',
      delivery_date: /^\d{4}-\d{2}-\d{2}$/.test(req.body?.delivery_date || '') ? req.body.delivery_date : new Date(Date.now() + 864e5).toISOString().slice(0, 10),
      delivery_time: /^([01]\d|2[0-3]):[0-5]\d$/.test(req.body?.delivery_time || '') ? req.body.delivery_time : '10:00',
      reference_id: order.order_code,
      items: items.map((it) => ({ name: it.product_name, value: it.price, weight: weightOf(db, it), quantity: it.quantity })),
    };
    if (origin.area_id) body.origin_area_id = origin.area_id;
    else if (origin.postal_code) body.origin_postal_code = Number(origin.postal_code);
    if (destArea) body.destination_area_id = destArea; else body.destination_postal_code = Number(destPostal);

    const resp = await fetch('https://api.biteship.com/v1/orders', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: apiKey },
      body: JSON.stringify(body),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.success === false) {
      return error(res, `Biteship: ${data?.error || data?.message || resp.status}`, 502);
    }
    const awb = data?.courier?.waybill_id || data?.courier?.tracking_id || data?.id || '';
    db.prepare("UPDATE orders SET shipping_awb = ?, status = 'shipped', updated_at = datetime('now') WHERE id = ?").run(awb, order.id);
    logEvent(db, order.id, 'pickup', `Penjemputan dipesan via Biteship — resi ${awb || '-'} (${order.shipping_courier} ${order.shipping_service || ''})`, req.user?.email || 'admin');
    return success(res, { awb, courier, service: svc, biteship_id: data?.id }, 'Penjemputan dipesan');
  } catch (err) { next(err); }
};

// Cetak label pengiriman — PDF waybill Biteship bila ada, fallback label HTML.
const getShippingLabel = async (req, res, next) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.orderId, req.params.id);
    if (!order) return notFound(res);
    if (!order.shipping_awb) return error(res, 'Belum ada resi — pesan penjemputan dulu', 400);
    const r = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(order.store_id, 'shipping_api_key');
    let apiKey = r?.value || '';
    try { apiKey = JSON.parse(apiKey); } catch { /* string mentah */ }
    apiKey = apiKey || process.env.BITESHIP_API_KEY;
    if (apiKey) {
      try {
        const resp = await fetch(`https://api.biteship.com/v1/order_labels/${order.shipping_awb}`, { headers: { authorization: apiKey } });
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          res.set('Content-Type', 'application/pdf');
          res.set('Content-Disposition', `inline; filename="label-${order.order_code}.pdf"`);
          return res.send(buf);
        }
      } catch { /* lanjut ke label HTML */ }
    }
    // Fallback: label cetak-sendiri meniru layout Plugo (test mode / resi manual / COD).
    const orow = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(order.store_id, 'shipping_origin');
    let origin = {}; try { origin = JSON.parse(orow?.value || '{}'); } catch { /* abaikan */ }
    const srow = db.prepare('SELECT name FROM stores WHERE id = ?').get(order.store_id);
    let items = [];
    try {
      items = db.prepare('SELECT oi.product_name, oi.quantity, p.sku FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?').all(order.id);
    } catch {
      items = db.prepare('SELECT product_name, quantity, NULL as sku FROM order_items WHERE order_id = ?').all(order.id);
    }
    let addr = {}; try { addr = JSON.parse(order.shipping_address || '{}'); } catch { addr = { address: order.shipping_address }; }
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const mask = (p) => { const s = String(p || ''); return s.length > 8 ? s.slice(0, 7) + '****' + s.slice(-2) : s; };
    const LOGO = { lion: 'lion_kiriminaja', jne: 'jne', jnt: 'jnt', sicepat: 'sicepat', pos: 'pos', tiki: 'tiki', ninja: 'ninja', sap: 'sap', ide: 'ide', gosend: 'gosend', grab: 'grab', paxel: 'paxel' };
    const ccode = COURIER_CODE[String(order.shipping_courier || '').toLowerCase()];
    const logoFile = ccode && LOGO[ccode] ? `uploads/courier/${LOGO[ccode]}.svg` : null;
    const courierHead = logoFile ? `<img src="${logoFile}" alt="${esc(order.shipping_courier)}" style="height:16px">` : esc(order.shipping_courier || '');
    const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const isCod = String(order.payment_method || '').toLowerCase().includes('cod');
    const totalQty = items.reduce((a, b) => a + b.quantity, 0);
    const totalWeight = (totalQty * 0.2).toFixed(2);
    const itemRows = items.map((it) => `<div>${it.quantity}x ${esc(it.product_name)}${it.sku ? ` <span class="lb-sku">(${esc(it.sku)})</span>` : ''}</div>`).join('');
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html><html><head><meta charset="utf-8"><base href="https://${req.get('host')}/"><title>Label ${esc(order.order_code)}</title>
<style>
* { box-sizing: border-box; }
body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 12px; color: #111; background: #f2f2f2; }
.lb-item { background: #fff; border: 1px solid #e3e3e3; max-width: 460px; margin: 0 auto; padding: 16px 18px; }
body.thermal .lb-item { max-width: 300px; font-size: 10px; padding: 8px; }
.lb-top { display: flex; justify-content: space-between; align-items: baseline; font-size: 11px; color: #888; border-bottom: 1px solid #eee; padding-bottom: 6px; }
.lb-top .courier { font-weight: bold; color: #111; text-transform: uppercase; }
.lb-title { text-align: center; padding: 10px 0 8px; }
.lb-title h1 { font-size: 15px; margin: 0 0 3px; font-weight: 700; }
.lb-title .pickup { display: inline-block; border: 1px solid #111; color: #111; font-size: 9px; padding: 1px 7px; letter-spacing: 1px; }
.lb-title .code { font-size: 12px; font-weight: bold; margin-top: 4px; }
.lb-infos { display: flex; flex-direction: column; }
.lb-info { padding: 7px 0; border-bottom: 1px solid #f0f0f0; }
.lb-info:last-child { border-bottom: 0; }
.lb-dt { font-size: 9px; letter-spacing: 1px; color: #888; text-transform: uppercase; margin-bottom: 2px; }
.lb-db { font-weight: bold; font-size: 13px; text-transform: uppercase; }
.lb-dd { font-size: 12px; margin-top: 1px; }
.lb-awb { text-align: center; font-family: monospace; font-size: 12px; color: #555; padding: 4px 0; letter-spacing: 1px; }
.lb-summary { border-top: 1px solid #eee; margin-top: 8px; padding-top: 8px; font-size: 12px; }
.lb-summary .o { font-weight: bold; margin-bottom: 4px; }
body { display: flex; gap: 0; align-items: flex-start; }
.controls { width: 210px; flex: 0 0 210px; padding: 8px 12px; position: sticky; top: 0; display: flex; flex-direction: column; gap: 8px; background: #fff; border-right: 1px solid #eee; min-height: 100vh; }
.wrap { flex: 1; padding: 16px; }
.btn { border: 0; background: none; padding: 8px 10px; font-size: 13px; cursor: pointer; text-align: left; border-radius: 4px; color: #333; }
.btn:hover { background: #f4f4f4; }
.btn-print { background: #2d7ff9; color: #fff; text-align: center; font-weight: 600; }
.btn-print:hover { background: #1f6fe0; }
.options { font-size: 11px; display: flex; flex-direction: column; gap: 6px; margin-top: 6px; border-top: 1px solid #eee; padding-top: 8px; }
.options label { display: flex; align-items: center; gap: 5px; cursor: pointer; color: #555; }
@media print { body { background: #fff; padding: 0; display: block; } .controls { display: none; } .wrap { padding: 0; } }
</style></head><body>
<div class="controls">
  <button class="btn btn-print" onclick="window.print()">Cetak</button>
  <button class="btn" onclick="(()=>{const i=document.querySelectorAll('.lb-item');if(i[1])i[1].remove();document.body.className=''})()">☰ 1 Kolom</button>
  <button class="btn" onclick="(()=>{const i=document.querySelector('.lb-item');if(!document.querySelectorAll('.lb-item')[1]){i.parentNode.insertBefore(i.cloneNode(true),i.nextSibling)}document.body.className='cols2'})()">▦ 2 Kolom</button>
  <button class="btn" onclick="document.body.className='thermal'">▤ Cetak Thermal</button>
  <div class="options">
    <label><input type="checkbox" onchange="document.querySelectorAll('.lb-pvos').forEach(e=>e.style.display=this.checked?'none':'')"> Sembunyikan info produk</label>
    <label><input type="checkbox" onchange="document.querySelectorAll('.lb-sku').forEach(e=>e.style.display=this.checked?'none':'inline')"> Sembunyikan Kode Produk</label>
    <label><input type="checkbox" onchange="document.querySelectorAll('.lb-note').forEach(e=>e.style.display=this.checked?'':'none')"> Tampilkan catatan order</label>
  </div>
</div>
<div class="wrap">
<div class="lb-item">
  <div class="lb-top"><span class="courier">${courierHead}</span><span>${esc(srow?.name || '')}</span></div>
  <div class="lb-title">
    <h1>Label Pengiriman (${isCod ? 'COD' : 'NON-COD'})</h1>
    <span class="pickup">PICKUP</span>
    <div class="code">${esc(order.order_code)}</div>
  </div>
  <div class="lb-awb">${esc(order.shipping_awb)}</div>
  <div class="lb-infos">
    <div class="lb-info">
      <div class="lb-dt">Informasi Pengirim</div>
      <div class="lb-db">${esc(srow?.name || '')}</div>
      <div class="lb-dd">${esc(mask(origin.phone))}<br>${esc(origin.address || '')} ${esc(origin.postal_code || '')}</div>
    </div>
    <div class="lb-info">
      <div class="lb-dt">Informasi Penerima</div>
      <div class="lb-db">${esc(order.customer_name || '')}</div>
      <div class="lb-dd">${esc(mask(order.customer_phone))}<br>${esc(addr.address || '')}${order.destination_postal_code ? `<br>${esc(order.destination_postal_code)}` : ''}</div>
    </div>
    <div class="lb-info">
      <div class="lb-dt">Informasi Pengiriman</div>
      <div class="lb-db">${esc(order.shipping_courier || '-')} ${esc(order.shipping_service || '')}</div>
      <div class="lb-dd">Harga Pengiriman ${rp(order.shipping_cost)}<br>Total Berat ${totalWeight} KG<br>Jumlah Total ${totalQty}</div>
    </div>
  </div>
  <div class="lb-summary">
    <div class="o">Order ${esc(order.order_code)}</div>
    <div class="lb-pvos">${itemRows}</div>
    ${order.notes ? `<div class="lb-note" style="display:none">Catatan: ${esc(order.notes)}</div>` : ''}
  </div>
</div>
</div>
<style>body.cols2 .wrap{max-width:none}body.cols2 .lb-item{display:inline-block;width:49%;vertical-align:top;margin:0 0.3%}</style>
</body></html>`);
  } catch (err) { next(err); }
};

// Cetak Faktur — layout invoice ala Plugo.
const getInvoice = async (req, res, next) => {
  try {
    const db = getDb();
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND store_id = ?').get(req.params.orderId, req.params.id);
    if (!order) return notFound(res);
    const srow = db.prepare('SELECT name FROM stores WHERE id = ?').get(order.store_id);
    const orow = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(order.store_id, 'shipping_origin');
    const irow = db.prepare('SELECT value FROM store_settings WHERE store_id = ? AND key = ?').get(order.store_id, 'invoice_settings');
    let origin = {}; try { origin = JSON.parse(orow?.value || '{}'); } catch { /* abaikan */ }
    let inv = {}; try { inv = JSON.parse(irow?.value || '{}'); } catch { /* abaikan */ }
    const items = db.prepare('SELECT product_name, quantity, price, total FROM order_items WHERE order_id = ?').all(order.id);
    let addr = {}; try { addr = JSON.parse(order.shipping_address || '{}'); } catch { addr = { address: order.shipping_address }; }
    const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rp = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
    const fmtD = (d) => d ? new Date(String(d).replace(' ', 'T') + 'Z').toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' }).replace('.', ':') : '-';
    const rows = items.map((it, i) => `<tr><td>${i + 1}</td><td>${esc(it.product_name)}</td><td class="r">${rp(it.price)}</td><td class="r">${it.quantity}</td><td class="r">${rp(it.total)}</td></tr>`).join('');
    if (req.query.type === 'pos') {
      const posRows = items.map((it) => `<div class="it"><span>${esc(it.product_name)}</span><span>${it.quantity}x ${rp(it.price)}</span><b>${rp(it.total)}</b></div>`).join('');
      res.set('Content-Type', 'text/html; charset=utf-8');
      return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Struk ${esc(order.order_code)}</title>
<style>body{font-family:'Courier New',monospace;margin:0;padding:16px 8px;width:280px;font-size:11px;color:#000}
.c{text-align:center}.logo{font-size:15px;font-weight:800}.muted{color:#444;font-size:10px}
.hr{border-top:1px dashed #000;margin:8px 0}
.it{display:grid;grid-template-columns:1fr auto auto;gap:6px;margin:3px 0}
.tot{display:flex;justify-content:space-between;font-weight:800;font-size:13px;margin-top:6px}
.r2{display:flex;justify-content:space-between}
.btn{position:fixed;top:10px;right:10px;background:#2d7ff9;color:#fff;border:0;padding:8px 14px;border-radius:5px;cursor:pointer}
@media print{.btn{display:none}body{padding:0}}</style></head><body>
<button class="btn" onclick="window.print()">Cetak</button>
<div class="c"><div class="logo">${esc(srow?.name || '')}</div>
<div class="muted">${esc(origin.address || '')}</div>
<div class="muted">${esc(order.order_code)} · ${fmtD(order.created_at)}</div></div>
<div class="hr"></div>${posRows}<div class="hr"></div>
<div class="r2"><span>Subtotal</span><span>${rp(order.subtotal)}</span></div>
<div class="r2"><span>Ongkir</span><span>${rp(order.shipping_cost)}</span></div>
${order.discount_amount ? `<div class="r2"><span>Diskon</span><span>-${rp(order.discount_amount)}</span></div>` : ''}
<div class="tot"><span>TOTAL</span><span>${rp(order.total)}</span></div>
<div class="hr"></div>
<div class="r2"><span>Pembayaran</span><span>${esc(order.payment_method || '-')}</span></div>
<div class="r2"><span>Status</span><span>${esc(order.payment_status || '')}</span></div>
${order.shipping_awb ? `<div class="r2"><span>Resi</span><span>${esc(order.shipping_awb)}</span></div>` : ''}
<div class="hr"></div><div class="c muted">Terima kasih telah berbelanja<br>${esc(srow?.name || '')}</div>
</body></html>`);
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    return res.send(`<!doctype html><html><head><meta charset="utf-8"><title>Faktur ${esc(order.order_code)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;margin:0;padding:32px;color:#111;font-size:12px}
.page{max-width:760px;margin:0 auto}
h1{font-size:15px;margin:0 0 14px}
.hdr{display:flex;justify-content:space-between;align-items:flex-start}
.dates div{margin-bottom:2px;color:#444}
.logo{font-size:20px;font-weight:800;text-align:right}
.cols{display:flex;justify-content:space-between;gap:40px;margin:26px 0}
.col h4{margin:0 0 5px;font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px}
.col .v{font-size:12px;line-height:1.55;text-transform:uppercase}
table{width:100%;border-collapse:collapse;margin-top:8px}
th{font-size:10px;color:#888;text-transform:uppercase;text-align:left;padding:6px 4px;border-bottom:1px solid #eee}
td{padding:7px 4px;border-bottom:1px solid #f4f4f4;vertical-align:top}
.r{text-align:right}
.tot{margin-left:auto;width:300px;margin-top:10px}
.tot div{display:flex;justify-content:space-between;padding:3px 4px}
.tot .grand{font-weight:800;border-top:1px solid #111;margin-top:4px;padding-top:6px}
.meta{display:flex;gap:60px;margin-top:26px;font-size:12px}
.meta b{display:block;color:#888;font-weight:400;font-size:10px;text-transform:uppercase;margin-bottom:2px}
.btn{position:fixed;top:14px;left:14px;background:#2d7ff9;color:#fff;border:0;padding:9px 18px;border-radius:5px;font-size:13px;cursor:pointer}
@media print{.btn{display:none}}
</style></head><body>
<button class="btn" onclick="window.print()">Cetak</button>
<div class="page">
  <div class="hdr">
    <div>
      <h1>Faktur #${esc(order.order_code)}</h1>
      <div class="dates">
        <div>Tanggal Order&nbsp;&nbsp;${fmtD(order.created_at)}</div>
        ${order.shipping_awb ? `<div>No. Resi&nbsp;&nbsp;${esc(order.shipping_awb)}</div>` : ''}
        <div>Tanggal Terbit&nbsp;&nbsp;${fmtD(new Date().toISOString())}</div>
      </div>
    </div>
    <div class="logo">${inv.logo_url ? `<img src="${esc(inv.logo_url)}" style="max-height:44px;max-width:160px" alt="${esc(srow?.name || '')}">` : esc(srow?.name || '')}</div>
  </div>
  <div class="cols">
    <div class="col"><h4>Informasi Pengirim</h4><div class="v">${esc(srow?.name || '')}<br>${esc(origin.address || '')} ${esc(origin.postal_code || '')}<br>${esc(origin.phone || '')}</div></div>
    <div class="col"><h4>Informasi Customer</h4><div class="v">${esc(order.customer_name || '')}<br>${esc(addr.address || '')}<br>${esc(order.customer_phone || '')}<br>${esc(order.customer_email || '')}</div></div>
  </div>
  <table>
    <thead><tr><th>No</th><th>Produk</th><th class="r">Harga Unit</th><th class="r">Jumlah</th><th class="r">Total Harga</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="tot">
    <div><span>Harga Produk (${items.length} item)</span><span>${rp(order.subtotal)}</span></div>
    <div><span>Ongkos Kirim (${esc(order.shipping_courier || '')} ${esc(order.shipping_service || '')})</span><span>${rp(order.shipping_cost)}</span></div>
    ${order.discount_amount ? `<div><span>Diskon</span><span>-${rp(order.discount_amount)}</span></div>` : ''}
    ${order.extra_fee ? `<div><span>Biaya tambahan</span><span>${rp(order.extra_fee)}</span></div>` : ''}
    <div class="grand"><span>Total</span><span>${rp(order.total)}</span></div>
  </div>
  <div class="meta">
    <div><b>Metode pembayaran</b>${esc(order.payment_method || '-')}</div>
    <div><b>Status</b>${esc(order.payment_status || '')} / ${esc(order.status || '')}</div>
  </div>
  ${inv.footnote ? `<div style="margin-top:28px;font-size:10px;color:#888;white-space:pre-line">${esc(inv.footnote)}</div>` : ''}
</div>
</body></html>`);
  } catch (err) { next(err); }
};

module.exports = { createOrder, getOrders, getOrder, updateOrder, updateOrderStatus, deleteOrder, addOrderEvent, requestPickup, getShippingLabel, getInvoice };
