const { getDb, uuid } = require('../config/database');
const { success, created, error } = require('../utils/response');

const PLANS = {
  basic: { name: 'Basic', price: 0 },
  pro: { name: 'Pro', price: 99000 },
  enterprise: { name: 'Enterprise', price: 299000 },
};

const getPlans = (req, res) => success(res, PLANS);

const getSubscription = async (req, res, next) => {
  try {
    const sub = getDb().prepare('SELECT * FROM subscriptions WHERE store_id = ? AND status = ?').get(req.params.id, 'active');
    return success(res, sub || { plan: 'basic', status: 'active', end_date: null });
  } catch (err) { next(err); }
};

const createSubscription = async (req, res, next) => {
  try {
    const { plan } = req.body;
    if (!plan || !PLANS[plan]) return error(res, 'Plan tidak valid', 400);
    const db = getDb();
    const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const id = uuid();
    db.prepare('INSERT INTO subscriptions (id, store_id, plan, status, start_date, end_date, amount, payment_status) VALUES (?,?,?,?,datetime(?),?,?,?)')
      .run(id, req.params.id, plan, 'active', new Date().toISOString(), endDate, PLANS[plan].price, PLANS[plan].price === 0 ? 'paid' : 'pending');
    db.prepare('UPDATE stores SET plan = ?, plan_expiry = ? WHERE id = ?').run(plan, endDate, req.params.id);
    return created(res, db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id), 'Langganan dibuat');
  } catch (err) { next(err); }
};

const cancelSubscription = async (req, res, next) => {
  try {
    const db = getDb();
    db.prepare('UPDATE subscriptions SET status = ? WHERE store_id = ? AND status = ?').run('cancelled', req.params.id, 'active');
    db.prepare('UPDATE stores SET plan = ? WHERE id = ?').run('basic', req.params.id);
    return success(res, null, 'Langganan dibatalkan');
  } catch (err) { next(err); }
};

module.exports = { getPlans, getSubscription, createSubscription, cancelSubscription };
