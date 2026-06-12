const router = require('express').Router({ mergeParams: true });
const settings = require('../controllers/settings.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

router.get('/', settings.getSettings);
router.put('/', settings.updateSettings);
router.get('/:key', settings.getSetting);

module.exports = router;
