const router = require('express').Router({ mergeParams: true });
const subscription = require('../controllers/subscription.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.get('/plans', subscription.getPlans);

router.use(authenticate, checkStoreAccess);

router.get('/', subscription.getSubscription);
router.get('/usage', subscription.getUsage);
router.get('/billing', subscription.getBillingHistory);
router.post('/', subscription.createSubscription);
router.put('/cancel', subscription.cancelSubscription);

module.exports = router;
