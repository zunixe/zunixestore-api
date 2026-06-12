const router = require('express').Router({ mergeParams: true });
const product = require('../controllers/product.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

router.post('/', product.createProduct);
router.get('/', product.getProducts);
router.get('/:productId', product.getProduct);
router.put('/:productId', product.updateProduct);
router.delete('/:productId', product.deleteProduct);

module.exports = router;
