const router = require('express').Router();
const store = require('../controllers/store.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.post('/', store.createStore);
router.get('/', store.getStores);
router.get('/:id', store.getStore);
router.put('/:id', store.updateStore);
router.delete('/:id', store.deleteStore);

module.exports = router;
