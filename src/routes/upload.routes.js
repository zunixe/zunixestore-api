const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const { authenticate } = require('../middleware/auth.middleware');
const { uploadFile } = require('../controllers/upload.controller');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', '..', 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    cb(null, ext && mime);
  },
});

router.post('/', authenticate, upload.single('file'), uploadFile);

module.exports = router;
