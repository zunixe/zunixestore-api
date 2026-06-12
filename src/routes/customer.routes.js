const router = require('express').Router({ mergeParams: true });
const customer = require('../controllers/customer.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkStoreAccess } = require('../middleware/store.middleware');

router.use(authenticate, checkStoreAccess);

router.post('/', customer.createCustomer);
router.get('/', customer.getCustomers);
router.get('/:customerId', customer.getCustomer);
router.put('/:customerId', customer.updateCustomer);
router.delete('/:customerId', customer.deleteCustomer);

module.exports = router;
