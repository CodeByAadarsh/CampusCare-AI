/** 404 for unknown API routes. */
export function notFound(req, res) {
  res.status(404).json({ message: `No API route for ${req.method} ${req.originalUrl}.` });
}

/** Turns every error into { message } with a sensible status code. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = err.status || err.statusCode || 500;
  let message = err.message;

  if (err.name === 'MulterError') {
    status = 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'Each photo must be 5 MB or smaller.'
      : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Attach at most 3 photos.'
      : 'The photo upload failed.';
  } else if (err.name === 'ValidationError') {
    status = 400;
    message = Object.values(err.errors || {}).map((e) => e.message).join(' ') || 'Some fields are not valid.';
  } else if (err.name === 'CastError') {
    status = 404;
    message = 'That record does not exist.';
  } else if (err.code === 11000) {
    status = 409;
    message = 'An account with this email already exists.';
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    message = 'The request body is not valid JSON.';
  }

  if (status >= 500) {
    console.error(err);
    message = 'Something went wrong on the server. Try again in a moment.';
  }
  res.status(status).json({ message });
}
