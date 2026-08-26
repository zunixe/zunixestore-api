const router = require('express').Router();
const ctrl = require('../controllers/payment.controller');

router.post('/snap-token', ctrl.createSnapToken);
router.post('/webhook', ctrl.handleWebhook);
router.get('/status/:code', ctrl.getPaymentStatus);

module.exports = router;
