const router = require('express').Router();
const store = require('../controllers/store.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate);

router.post('/', store.createStore);
router.get('/', store.getStores);
router.get('/:id', checkStoreAccess, store.getStore);
router.put('/:id', checkStoreAccess, store.updateStore);
router.delete('/:id', checkStoreAccess, store.deleteStore);
router.get('/:id/coins', checkStoreAccess, store.getCoins);

module.exports = router;
