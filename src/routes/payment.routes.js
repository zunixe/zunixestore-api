const router = require('express').Router();
const ctrl = require('../controllers/payment.controller');

router.post('/checkout', ctrl.createCheckout);
router.get('/channels', ctrl.listChannels);
router.post('/snap-token', ctrl.createSnapToken); // kompat lama
router.post('/webhook', ctrl.handleWebhook);
router.get('/status/:code', ctrl.getPaymentStatus);

module.exports = router;
