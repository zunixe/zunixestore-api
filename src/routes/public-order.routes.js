const router = require('express').Router();
const ctrl = require('../controllers/public-order.controller');

router.post('/', ctrl.createPublicOrder);
router.get('/:code', ctrl.trackOrder);

router.post('/:code/cancel', ctrl.cancelPublicOrder);

module.exports = router;
