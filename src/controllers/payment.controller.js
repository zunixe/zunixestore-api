const crypto = require('crypto');
const { getDb, uuid } = require('../config/database');
const { success, created, badRequest, notFound } = require('../utils/response');
const { restoreStock } = require('../services/stockService');

// Konfigurasi gateway per toko (Pengaturan → Metode Pembayaran → Payment Gateway).
// Provider: iPaymu Redirect Payment — akun yang sama dipakai ChatYuk
// (IPAYMU_VA + IPAYMU_API_KEY, sandbox/production).
const gatewayFor = (db, storeId) => {
  const row = storeId
    ? db.prepare("SELECT value FROM store_settings WHERE store_id = ? AND key = 'payment_gateway'").get(storeId)
    : null;
  const cfg = (() => { try { return JSON.parse(row?.value || '{}'); } catch { return {}; } })();
  // Toggle per-toko menang; env hanya dipakai bila toko belum mengatur mode.
  const isProd = cfg.is_production !== undefined
    ? (cfg.is_production === true || cfg.is_production === 'true')
    : process.env.IPAYMU_IS_PRODUCTION === 'true';
  return {
    provider: cfg.provider || 'ipaymu',
    va: cfg.va || process.env.IPAYMU_VA || '',
    apiKey: cfg.api_key || process.env.IPAYMU_API_KEY || '',
    isProduction: isProd,
    baseUrl: isProd ? 'https://my.ipaymu.com' : 'https://sandbox.ipaymu.com',
  };
};

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmacSha256Hex = (key, s) => crypto.createHmac('sha256', key).update(s).digest('hex');

const ipaymuTimestamp = () => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
const ipaymuSign = (gw, method, bodyStr) =>
  hmacSha256Hex(gw.apiKey, `${method}:${gw.va}:${sha256Hex(bodyStr)}:${gw.apiKey}`);

// Daftar channel iPaymu yang aktif di akun — setara paymentOptions NICEpay di Plugo.
// Cache singkat per store supaya checkout tidak menembak iPaymu setiap render.
const channelsCache = new Map(); // key: va → { at, data }
const CHANNELS_TTL = 5 * 60 * 1000;

const listChannels = async (req, res, next) => {
  try {
    const db = getDb();
    let storeId = null;
    const slug = req.query.store_slug;
    if (slug) {
      const st = db.prepare('SELECT id FROM stores WHERE slug = ?').get(slug);
      storeId = st?.id || null;
    }
    const gw = gatewayFor(db, storeId);
    if (!gw.va || !gw.apiKey) return success(res, { methods: [], simulated: true });

    const hit = channelsCache.get(gw.va);
    if (hit && Date.now() - hit.at < CHANNELS_TTL) return success(res, { methods: hit.data });

    const r = await fetch(`${gw.baseUrl}/api/v2/payment-channels`, {
      headers: { va: gw.va, signature: ipaymuSign(gw, 'GET', '{}'), timestamp: ipaymuTimestamp() },
    });
    const j = await r.json();
    if (!r.ok || j.Status !== 200) return success(res, { methods: [] });
    const methods = (j.Data || [])
      .map((m) => ({
        code: m.Code,
        name: m.Name,
        channels: (m.Channels || [])
          .filter((c) => c.FeatureStatus === 'active')
          .map((c) => ({
            code: c.Code,
            name: c.Name,
            fee: c.TransactionFee?.ActualFee || 0,
            fee_type: c.TransactionFee?.ActualFeeType || 'FLAT',
            buyer_fee: c.TransactionFee?.AdditionalFee || 0,
          })),
      }))
      .filter((m) => m.channels.length > 0);
    channelsCache.set(gw.va, { at: Date.now(), data: methods });
    return success(res, { methods });
  } catch (e) { return next(e); }
};

// payment_method order ("va_bca", "ewallet_dana", "qris", "debitonline")
// → paymentMethod + paymentChannel untuk redirect iPaymu langsung ke channel itu.
const ipaymuMethodChannel = (key) => {
  if (!key) return {};
  if (key === 'qris') return { paymentMethod: 'qris', paymentChannel: 'mpm' };
  if (key === 'debitonline') return { paymentMethod: 'debitonline', paymentChannel: 'cc' };
  const [method, channel] = key.split('_');
  if (['va', 'cstore', 'ewallet', 'paylater', 'cc', 'cod'].includes(method) && channel) {
    return { paymentMethod: method, paymentChannel: channel };
  }
  return {};
};

// Normalisasi + ksort ala PHP untuk verifikasi x-signature callback iPaymu.
const normalizeCb = (raw) => {
  const out = {};
  for (const k of Object.keys(raw)) {
    const v = raw[k];
    if (k === 'is_escrow') out[k] = v === 'true' || v === '1' || v === 1;
    else if (['trx_id', 'status_code', 'transaction_status_code', 'paid_off'].includes(k)) out[k] = parseInt(String(v), 10);
    else if (k === 'additional_info') out[k] = v === '[]' ? [] : v;
    else out[k] = String(v);
  }
  if (!('additional_info' in out)) out.additional_info = [];
  return out;
};

// Buat pembayaran → redirect customer ke halaman checkout iPaymu
// (VA, QRIS, e-wallet, retail — satu URL untuk semua channel).
const createCheckout = async (req, res, next) => {
  try {
    const { order_code, customer_name, customer_email, customer_phone } = req.body;

    if (!order_code || !customer_email) {
      return badRequest(res, 'Data pembayaran tidak lengkap');
    }

    const db = getDb();
    const order = db.prepare('SELECT id, store_id, order_code, total, payment_status, payment_method, shipping_cost, shipping_courier, shipping_service, extra_fee, discount_amount FROM orders WHERE order_code = ?').get(order_code);
    if (!order) return notFound(res, 'Pesanan tidak ditemukan');
    if (order.payment_status === 'paid') return badRequest(res, 'Pesanan sudah dibayar');

    const gw = gatewayFor(db, order.store_id);
    if (!gw.va || !gw.apiKey) {
      return created(res, {
        token: 'sim-token-' + Date.now(),
        redirect_url: '#',
        message: 'Payment gateway belum dikonfigurasi (mode simulasi)',
      });
    }

    const orderItems = db.prepare('SELECT product_name, price, quantity FROM order_items WHERE order_id = ?').all(order.id);
    const storefrontBase = (process.env.STOREFRONT_URL || 'http://localhost:5173').replace(/\/$/, '');
    const apiBase = (process.env.API_PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
    // iPaymu menolak URL non-publik (localhost) — kirim hanya bila env mengarah ke domain publik.
    const isPublic = (u) => /^https?:\/\//.test(u) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(u);

    // Line items = produk + ongkir + biaya tambahan - diskon → total persis order.total.
    const lines = orderItems.map((i) => ({ name: String(i.product_name).slice(0, 80), qty: String(i.quantity), price: String(i.price) }));
    if (Number(order.shipping_cost) > 0) {
      const svc = [order.shipping_courier, order.shipping_service].filter(Boolean).join(' ') || 'Kurir';
      lines.push({ name: `Ongkos Kirim (${svc})`.slice(0, 80), qty: '1', price: String(order.shipping_cost) });
    }
    if (Number(order.extra_fee) > 0) lines.push({ name: 'Biaya Tambahan', qty: '1', price: String(order.extra_fee) });
    if (Number(order.discount_amount) > 0) lines.push({ name: 'Diskon', qty: '1', price: String(-Math.abs(Number(order.discount_amount))) });

    const body = {
      product: lines.map((l) => l.name),
      qty: lines.map((l) => l.qty),
      price: lines.map((l) => l.price),
      description: lines.map(() => `Pembayaran pesanan ${order_code}`),
      referenceId: order_code,
      buyerName: String(customer_name || 'Customer').slice(0, 40),
      buyerEmail: customer_email,
      buyerPhone: customer_phone || '',
    };
    if (isPublic(storefrontBase)) {
      body.returnUrl = `${storefrontBase}/order-success/${order_code}`;
      body.cancelUrl = `${storefrontBase}/order-success/${order_code}`;
    }
    if (isPublic(apiBase)) body.notifyUrl = `${apiBase}/api/payment/webhook`;

    // Channel terpilih di checkout → halaman iPaymu langsung ke channel tsb.
    const mc = ipaymuMethodChannel(order.payment_method);
    const postPayment = async (withChannel) => {
      const payload = withChannel ? { ...body, ...mc } : body;
      const bodyStr = JSON.stringify(payload);
      const r = await fetch(`${gw.baseUrl}/api/v2/payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'va': gw.va,
          'signature': ipaymuSign(gw, 'POST', bodyStr),
          'timestamp': ipaymuTimestamp(),
        },
        body: bodyStr,
      });
      return r.json();
    };
    let ipaymu = await postPayment(!!mc.paymentMethod);
    // Channel tidak dikenal/ditolak → fallback ke halaman pilih channel penuh.
    if (mc.paymentMethod && (ipaymu.Status !== 200 || !ipaymu.Data?.Url)) {
      ipaymu = await postPayment(false);
    }
    if (ipaymu.Status !== 200 || !ipaymu.Data?.Url) {
      return badRequest(res, ipaymu.Message || 'Gagal membuat pembayaran iPaymu');
    }

    // Simpan session id untuk penelusuran (kolom shipping_service dipakai jadi ref gateway).
    db.prepare("UPDATE orders SET shipping_service = COALESCE(shipping_service, ?), updated_at = datetime('now') WHERE id = ?")
      .run(`ipaymu:${ipaymu.Data.SessionID}`, order.id);

    return created(res, {
      session_id: ipaymu.Data.SessionID,
      token: ipaymu.Data.SessionID,
      redirect_url: ipaymu.Data.Url,
    });
  } catch (err) { next(err); }
};

// Callback iPaymu → verifikasi x-signature (HMAC-SHA256 dari JSON ter-sort, kunci = VA).
const handleWebhook = async (req, res, next) => {
  try {
    let raw = req.body;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) raw = {};

    const db = getDb();
    const orderCode = String(raw.reference_id ?? raw.referenceId ?? '');
    if (!orderCode) return success(res, null, 'No reference — ignored');

    const order = db.prepare('SELECT id, store_id, status, payment_status FROM orders WHERE order_code = ?').get(orderCode);
    if (!order) return success(res, null, 'Order unknown — ignored');

    const gw = gatewayFor(db, order.store_id);
    if (gw.va) {
      const receivedSig = req.headers['x-signature'] || '';
      const normalized = normalizeCb({ ...raw });
      delete normalized.signature;
      const sorted = {};
      Object.keys(normalized).sort((a, b) => a.localeCompare(b)).forEach((k) => { sorted[k] = normalized[k]; });
      const jsonStr = JSON.stringify(sorted).replace(/\//g, '\\/');
      if (!receivedSig || hmacSha256Hex(gw.va, jsonStr) !== receivedSig) {
        return badRequest(res, 'Invalid signature');
      }
    }

    // status_code: 1/6=berhasil, 0=pending, -2=expired, <0=batal/gagal
    const statusCode = parseInt(String(raw.status_code ?? raw.transaction_status_code ?? '0'), 10);
    let paymentStatus = 'pending';
    let orderStatus = 'pending';
    if (statusCode === 1 || statusCode === 6) {
      paymentStatus = 'paid';
      orderStatus = 'processing';
    } else if (statusCode < 0) {
      paymentStatus = 'failed';
      orderStatus = 'cancelled';
    }

    const wasCancellable = !['cancelled', 'refunded'].includes(order.status);
    db.prepare(
      "UPDATE orders SET payment_status = ?, status = ?, paid_at = CASE WHEN ? = 'paid' AND paid_at IS NULL THEN datetime('now') ELSE paid_at END, updated_at = datetime('now') WHERE id = ?"
    ).run(paymentStatus, orderStatus, paymentStatus, order.id);
    try {
      const via = raw.channel || raw.via || 'ipaymu';
      const msg = paymentStatus === 'paid' ? `Pembayaran diterima via ${via}` : `Callback iPaymu: ${raw.status || raw.status_code}`;
      db.prepare('INSERT INTO order_events (id, order_id, type, message, actor) VALUES (?,?,?,?,?)').run(uuid(), order.id, 'payment', msg, 'ipaymu');
    } catch { /* riwayat opsional */ }

    // Pembayaran batal/kedaluwarsa → kembalikan stok.
    if (orderStatus === 'cancelled' && wasCancellable) {
      restoreStock(db, order.store_id, order.id);
    }

    return success(res, null, 'Webhook processed');
  } catch (err) { next(err); }
};

const getPaymentStatus = (req, res, next) => {
  try {
    const { code } = req.params;
    const db = getDb();
    const order = db.prepare('SELECT payment_status, status FROM orders WHERE order_code = ?').get(code);
    if (!order) return notFound(res, 'Pesanan tidak ditemukan');
    return success(res, { payment_status: order.payment_status, status: order.status });
  } catch (err) { next(err); }
};

module.exports = { createSnapToken: createCheckout, createCheckout, handleWebhook, getPaymentStatus, gatewayFor, listChannels };
