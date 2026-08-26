const router = require('express').Router();
const ctrl = require('../controllers/public.controller');

router.get('/resolve', ctrl.resolveDomain);
router.get('/store/:slug/settings', ctrl.getShopSettings);
router.get('/store/:slug/products', ctrl.getShopProducts);
router.get('/store/:slug/products/:id', ctrl.getShopProduct);
router.get('/store/:slug/content', ctrl.getShopContent);

module.exports = router;
