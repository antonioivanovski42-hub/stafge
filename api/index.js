const handler = require('../server');

// The rewrite sends every /api/* request here; restore the original URL so
// server.js routes on the real path (e.g. /api/login) instead of /api/index.js.
module.exports = (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.searchParams.has('__api_path')) {
    const original = url.searchParams.get('__api_path');
    url.searchParams.delete('__api_path');
    req.url = `/api/${original}${url.search}`;
  }
  return handler(req, res);
};
