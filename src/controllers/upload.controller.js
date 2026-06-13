const path = require('path');
const { success, badRequest } = require('../utils/response');

const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) return badRequest(res, 'File tidak ditemukan');

    const url = `/uploads/${req.file.filename}`;
    return success(res, { url, filename: req.file.filename }, 'Upload berhasil');
  } catch (err) { next(err); }
};

module.exports = { uploadFile };
