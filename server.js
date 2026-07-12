/*
 * server.js — static file server + tiny predictions store.
 * Run:  node server.js          (then open http://localhost:8000)
 *
 * Serves the app from this folder AND persists your predictions to
 * data/predictions.json inside the project:
 *   GET  /api/predictions  -> current saved predictions (or empty)
 *   POST /api/predictions  -> overwrite the saved predictions
 *
 * The front-end auto-saves to this endpoint on every change and loads it on
 * startup, so your progress lives in the project file (not just the browser).
 * If you serve the app some other way (e.g. python -m http.server) the app
 * simply falls back to browser localStorage.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const STORE = path.join(ROOT, 'data', 'predictions.json');
const PORT = process.env.PORT || 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.webmanifest': 'application/manifest+json',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

const server = http.createServer(function (req, res) {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);

  // ---- Predictions API ----
  if (pathname === '/api/predictions') {
    if (req.method === 'GET') {
      fs.readFile(STORE, 'utf8', function (err, data) {
        if (err) return sendJson(res, 200, { predictions: {}, koWinners: {} });
        try { sendJson(res, 200, JSON.parse(data)); }
        catch (e) { sendJson(res, 200, { predictions: {}, koWinners: {} }); }
      });
      return;
    }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', function (c) { body += c; if (body.length > 4e6) req.destroy(); });
      req.on('end', function () {
        let obj;
        try { obj = JSON.parse(body || '{}'); }
        catch (e) { return sendJson(res, 400, { ok: false, error: 'invalid json' }); }
        const out = {
          app: 'fifa-wc-2026', version: 1, savedAt: new Date().toISOString(),
          predictions: (obj && obj.predictions) || {},
          koWinners: (obj && obj.koWinners) || {},
        };
        fs.mkdir(path.dirname(STORE), { recursive: true }, function () {
          fs.writeFile(STORE, JSON.stringify(out, null, 2), function (err) {
            if (err) return sendJson(res, 500, { ok: false, error: String(err) });
            sendJson(res, 200, { ok: true, saved: Object.keys(out.predictions).length });
          });
        });
      });
      return;
    }
    res.writeHead(405); res.end(); return;
  }

  // ---- Static files ----
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(ROOT, pathname));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log('FIFA World Cup 2026 — running at http://localhost:' + PORT);
  console.log('Predictions auto-save to ' + path.relative(ROOT, STORE));
});
