const router = require('express').Router({ mergeParams: true });
const discount = require('../controllers/discount.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

router.post('/', discount.createDiscount);
router.get('/', discount.getDiscounts);
router.put('/:discountId', discount.updateDiscount);
router.delete('/:discountId', discount.deleteDiscount);

module.exports = router;
