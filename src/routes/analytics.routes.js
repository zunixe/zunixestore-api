const router = require('express').Router({ mergeParams: true });
const analytics = require('../controllers/analytics.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

router.get('/', analytics.getAnalyticsSummary);
router.get('/revenue', analytics.getRevenueChart);
router.get('/products', analytics.getBestProducts);

module.exports = router;
