const router = require('express').Router({ mergeParams: true });
const ctrl = require('../controllers/notification.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');
router.use(authenticate, checkStoreAccess);
router.get('/', ctrl.getStoreNotifications);
router.put('/read-all', ctrl.markAllNotificationsRead);
router.put('/:notifId/read', ctrl.markNotificationRead);
module.exports = router;
