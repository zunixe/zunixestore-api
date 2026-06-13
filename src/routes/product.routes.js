const router = require('express').Router({ mergeParams: true });
const product = require('../controllers/product.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

router.post('/', product.createProduct);
router.get('/', product.getProducts);
router.get('/:productId', product.getProduct);
router.get('/:productId/inventory', product.getProductInventory);
router.put('/:productId', product.updateProduct);
router.put('/:productId/availability', product.updateProductAvailability);
router.delete('/:productId', product.deleteProduct);

module.exports = router;
