const router = require('express').Router({ mergeParams: true });
const theme = require('../controllers/theme.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

router.get('/', theme.getThemes);
router.get('/active', theme.getActiveTheme);
router.put('/activate', theme.activateTheme);
router.put('/config', theme.updateTheme);

module.exports = router;
