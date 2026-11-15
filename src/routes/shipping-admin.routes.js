const router = require('express').Router({ mergeParams: true });
const ctrl = require('../controllers/shipping.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

// Hitung ulang tarif untuk ubah metode kirim di detail order (admin).
router.post('/rates', ctrl.getShippingRates);

module.exports = router;
