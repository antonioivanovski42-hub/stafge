const handler = require('../server');

// Vercel rewrites /api/* to this function; restore the original path for server.js routing.
module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const original = url.searchParams.get('__api_path');
  if (original !== null) {
    url.searchParams.delete('__api_path');
    req.url = `/api/${original}${url.search}`;
  }
  return handler(req, res);
};
