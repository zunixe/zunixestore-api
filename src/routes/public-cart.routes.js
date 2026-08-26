const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticateOptional } = require('../middleware/auth.middleware');
const { getCart, addToCart, updateCartItem, removeFromCart, clearCart } = require('../controllers/public-cart.controller');

router.get('/:storeId', authenticateOptional, getCart);
router.post('/:storeId/items', authenticateOptional, addToCart);
router.put('/:storeId/items/:itemId', authenticateOptional, updateCartItem);
router.delete('/:storeId/items/:itemId', authenticateOptional, removeFromCart);
router.delete('/:storeId', authenticateOptional, clearCart);

module.exports = router;
