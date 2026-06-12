const router = require('express').Router({ mergeParams: true });
const order = require('../controllers/order.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

router.post('/', order.createOrder);
router.get('/', order.getOrders);
router.get('/:orderId', order.getOrder);
router.put('/:orderId/status', order.updateOrderStatus);
router.delete('/:orderId', order.deleteOrder);

module.exports = router;
