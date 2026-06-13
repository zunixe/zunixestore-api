const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { getPrefs, updatePrefs } = require('../controllers/notification.controller');

router.get('/', authenticate, getPrefs);
router.put('/', authenticate, updatePrefs);

module.exports = router;
