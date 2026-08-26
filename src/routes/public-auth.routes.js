const router = require('express').Router();
const ctrl = require('../controllers/public-auth.controller');
const { authenticateOptional } = require('../middleware/auth.middleware');

router.post('/register', ctrl.registerCustomer);
router.post('/login', ctrl.loginCustomer);
router.get('/me', authenticateOptional, ctrl.getMe);
router.put('/profile', authenticateOptional, ctrl.updateProfile);

module.exports = router;
