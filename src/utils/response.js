const success = (res, data, message = 'Success', statusCode = 200) => {
  res.status(statusCode).json({ status: 'success', message, data });
};

const created = (res, data, message = 'Created') => {
  res.status(201).json({ status: 'success', message, data });
};

const error = (res, message = 'Internal Server Error', statusCode = 500) => {
  res.status(statusCode).json({ status: 'error', message });
};

const badRequest = (res, message = 'Bad Request') => error(res, message, 400);
const unauthorized = (res, message = 'Unauthorized') => error(res, message, 401);
const forbidden = (res, message = 'Forbidden') => error(res, message, 403);
const notFound = (res, message = 'Not Found') => error(res, message, 404);

module.exports = { success, created, error, badRequest, unauthorized, forbidden, notFound };
