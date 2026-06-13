const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { requestPhoneVerification, verifyPhone } = require('../controllers/phone.controller');

router.post('/verify-request', authenticate, requestPhoneVerification);
router.post('/verify', authenticate, verifyPhone);

module.exports = router;
