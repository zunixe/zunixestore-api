const router = require('express').Router();
const auth = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.post('/register', auth.register);
router.post('/login', auth.login);
router.post('/refresh', auth.refresh);
router.post('/logout', authenticate, auth.logout);
router.get('/me', authenticate, auth.me);
router.put('/profile', authenticate, auth.updateProfile);
router.post('/pin', authenticate, auth.setPin);
router.post('/pin/verify', authenticate, auth.verifyPin);
router.delete('/account', authenticate, auth.deleteAccount);

module.exports = router;
