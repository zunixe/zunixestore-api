const { getDb } = require('../config/database');
const { success, created, badRequest, notFound } = require('../utils/response');

const MIDTRANS_SERVER_KEY = process.env.MIDTRANS_SERVER_KEY || '';
const MIDTRANS_CLIENT_KEY = process.env.MIDTRANS_CLIENT_KEY || '';
const MIDTRANS_SNAP_URL = 'https://app.sandbox.midtrans.com/snap/v1/transactions';
const MIDTRANS_API_URL = 'https://api.sandbox.midtrans.com/v2';

const createSnapToken = async (req, res, next) => {
  try {
    const { order_code, customer_name, customer_email, customer_phone, items, total, shipping_cost } = req.body;

    if (!order_code || !customer_email || !total) {
      return badRequest(res, 'Data pembayaran tidak lengkap');
    }

    const db = getDb();
    const order = db.prepare('SELECT id, order_code, total FROM orders WHERE order_code = ?').get(order_code);
    if (!order) return notFound(res, 'Pesanan tidak ditemukan');

    if (!MIDTRANS_SERVER_KEY) {
      return created(res, {
        token: 'sandbox-token-' + Date.now(),
        redirect_url: '#',
        message: 'Midtrans not configured (sandbox mode)',
      });
    }

    const auth = Buffer.from(MIDTRANS_SERVER_KEY + ':').toString('base64');

    const orderItems = db.prepare('SELECT product_name, price, quantity FROM order_items WHERE order_id = ?').all(order.id);
    const itemDetails = orderItems.map((oi) => ({
      name: oi.product_name.substring(0, 50),
      price: oi.price,
      quantity: oi.quantity,
    }));

    if (Number(shipping_cost) > 0) {
      itemDetails.push({ name: 'Ongkos Kirim', price: Number(shipping_cost), quantity: 1 });
    }

    const payload = {
      transaction_details: {
        order_id: order_code,
        gross_amount: total,
      },
      item_details: itemDetails,
      customer_details: {
        first_name: customer_name,
        email: customer_email,
        phone: customer_phone || '',
      },
    };

    const snapResponse = await fetch(MIDTRANS_SNAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    const snapData = await snapResponse.json();
    if (!snapResponse.ok) {
      return badRequest(res, snapData.error_messages?.[0] || 'Gagal membuat token pembayaran');
    }

    return created(res, {
      token: snapData.token,
      redirect_url: snapData.redirect_url,
    });
  } catch (err) { next(err); }
};

const handleWebhook = async (req, res, next) => {
  try {
    const notification = req.body;
    if (!notification) return badRequest(res, 'Invalid notification');

    const db = getDb();
    const orderCode = notification.order_id;
    const transactionStatus = notification.transaction_status;
    const fraudStatus = notification.fraud_status;

    let paymentStatus = 'unpaid';
    let orderStatus = 'pending';

    if (transactionStatus === 'capture' && fraudStatus === 'accept') {
      paymentStatus = 'paid';
      orderStatus = 'processing';
    } else if (transactionStatus === 'settlement') {
      paymentStatus = 'paid';
      orderStatus = 'processing';
    } else if (transactionStatus === 'deny' || transactionStatus === 'cancel' || transactionStatus === 'expire') {
      paymentStatus = 'failed';
      orderStatus = 'cancelled';
    } else if (transactionStatus === 'pending') {
      paymentStatus = 'pending';
      orderStatus = 'pending';
    }

    if (transactionStatus === 'refund' || transactionStatus === 'partial_refund') {
      paymentStatus = 'refunded';
      orderStatus = 'refunded';
    }

    db.prepare(
      "UPDATE orders SET payment_status = ?, status = ?, updated_at = datetime('now') WHERE order_code = ?"
    ).run(paymentStatus, orderStatus, orderCode);

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

module.exports = { createSnapToken, handleWebhook, getPaymentStatus };
