const router = require('express').Router();
const ctrl = require('../controllers/shipping.controller');

router.post('/rates', ctrl.getShippingRates);
router.post('/webhook', ctrl.handleTrackWebhook);
router.get('/areas', ctrl.searchAreas);

module.exports = router;
