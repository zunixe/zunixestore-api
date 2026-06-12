const { getDb } = require('../config/database');
const { success, error } = require('../utils/response');

const getAnalyticsSummary = async (req, res, next) => {
  try {
    const { period } = req.query;
    let dateFilter = new Date().toISOString().split('T')[0];
    if (period === 'week') dateFilter = new Date(Date.now() - 7*86400000).toISOString().split('T')[0];
    if (period === 'month') dateFilter = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
    const db = getDb();
    const analytics = db.prepare('SELECT * FROM analytics WHERE store_id = ? AND date >= ? ORDER BY date DESC').all(req.params.id, dateFilter);
    const { c: totalOrders } = db.prepare("SELECT COUNT(*) as c FROM orders WHERE store_id = ? AND created_at >= ?").get(req.params.id, dateFilter);
    const { c: totalProducts } = db.prepare('SELECT COUNT(*) as c FROM products WHERE store_id = ?').get(req.params.id);
    const { c: totalCustomers } = db.prepare('SELECT COUNT(*) as c FROM customers WHERE store_id = ?').get(req.params.id);
    return success(res, {
      visitors: analytics.reduce((s,a) => s+(a.visitors||0), 0),
      orders: totalOrders, revenue: analytics.reduce((s,a) => s+(a.revenue||0), 0),
      total_products: totalProducts, total_customers: totalCustomers,
      daily: analytics,
    });
  } catch (err) { next(err); }
};

const getRevenueChart = async (req, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30*86400000).toISOString().split('T')[0];
    return success(res, getDb().prepare('SELECT date, revenue, orders FROM analytics WHERE store_id = ? AND date >= ? ORDER BY date ASC').all(req.params.id, thirtyDaysAgo));
  } catch (err) { next(err); }
};

const getBestProducts = async (req, res, next) => {
  try { return success(res, getDb().prepare('SELECT * FROM products WHERE store_id = ? ORDER BY created_at DESC LIMIT 10').all(req.params.id)); }
  catch (err) { next(err); }
};

module.exports = { getAnalyticsSummary, getRevenueChart, getBestProducts };
