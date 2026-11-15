const router = require('express').Router({ mergeParams: true });
const ctrl = require('../controllers/review.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');
router.use(authenticate, checkStoreAccess);
router.get('/', ctrl.getReviews);
router.put('/:reviewId/reply', ctrl.replyReview);
router.delete('/:reviewId', ctrl.deleteReview);
module.exports = router;
