require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { getDb } = require('./config/database');

const authRoutes = require('./routes/auth.routes');
const storeRoutes = require('./routes/store.routes');
const productRoutes = require('./routes/product.routes');
const orderRoutes = require('./routes/order.routes');
const customerRoutes = require('./routes/customer.routes');
const discountRoutes = require('./routes/discount.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const themeRoutes = require('./routes/theme.routes');
const settingsRoutes = require('./routes/settings.routes');
const subscriptionRoutes = require('./routes/subscription.routes');

const errorHandler = require('./middleware/error.middleware');

const app = express();
const PORT = process.env.PORT || 3000;

getDb();

app.use(helmet());
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());

app.get('/', (req, res) => {
  res.json({ name: 'ZunixeStore API', version: '1.0.0', database: 'SQLite', status: 'running' });
});

app.get('/api/health', (req, res) => {
  const db = getDb();
  const { c } = db.prepare('SELECT COUNT(*) as c FROM profiles').get();
  res.json({ status: 'healthy', database: 'connected', users: c, timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/stores', storeRoutes);
app.use('/api/stores/:id/products', productRoutes);
app.use('/api/stores/:id/orders', orderRoutes);
app.use('/api/stores/:id/customers', customerRoutes);
app.use('/api/stores/:id/discounts', discountRoutes);
app.use('/api/stores/:id/analytics', analyticsRoutes);
app.use('/api/stores/:id/theme', themeRoutes);
app.use('/api/stores/:id/settings', settingsRoutes);
app.use('/api/stores/:id/subscription', subscriptionRoutes);

app.use(errorHandler);

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`ZunixeStore API running on port ${PORT} [SQLite]`);
  });
}

module.exports = app;
