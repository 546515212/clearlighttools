#!/usr/bin/env node
// Local dev server for the built site in dist/.
// It is a plain static file server plus one extra endpoint, /api/geo, which stands in for
// the platform header that Cloudflare (cf-ipcountry) or Vercel (x-vercel-ip-country) will
// supply in production. The country now only gates the GDPR consent banner: the root / always
// opens the English home /en/, and language is changed solely through the header menu.
//
//   npm run dev                 build + serve on http://localhost:5173
//   PORT=8080 npm start         another port
//   http://localhost:5173/__geo?country=DE   pretend the visitor is in Germany for this browser
//   http://localhost:5173/__geo?country=      stop pretending
//
// Two more routes exist only to make browser verification scriptable; they are not part of a
// deployment because they live in this file, not in dist/:
//   GET  /__files/<name>          the generated fixtures in test-files/ (a page fetches these
//                                 and wraps them in a real File object before dropping it)
//   POST /__save?name=<file>      tool output goes to test-files/out/ so Node can inspect the
//                                 bytes the browser actually produced
//   GET  /__script/<name>.mjs     scripts/browser/<name>.mjs, the verification driver, so the
//                                 browser test code lives in a reviewable file
import { createServer } from 'node:http';
import { readFile, stat, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, extname, normalize, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const FIXTURES = join(ROOT, 'test-files');
const OUT = join(FIXTURES, 'out');
const PORT = Number(process.env.PORT || 5173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.gif': 'image/gif',
  '.zip': 'application/zip',
  '.csv': 'text/csv; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const readCookie = (header = '') => Object.fromEntries(
  header.split(/;\s*/).filter(Boolean).map(p => {
    const i = p.indexOf('=');
    return i < 0 ? [p, ''] : [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
  }));

async function resolve(pathname) {
  // never allow ../ to escape dist/
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const p = join(DIST, clean);
  if (!p.startsWith(DIST)) return { status: 403, body: 'forbidden', wanted: clean };
  // /en/ and /en/image/qr-code-generator/ are directories: they resolve to their index.html,
  // which is exactly how the URLs in the sitemap and in every nav link are written
  let s = await stat(p).catch(() => null);
  if (s?.isDirectory()) {
    const idx = join(p, 'index.html');
    if (await stat(idx).catch(() => null)) return { file: idx };
  }
  if (s?.isFile()) return { file: p };
  if (!extname(p)) {
    // extensionless URL: /es/pdf/compress-pdf -> /es/pdf/compress-pdf/index.html
    const asDir = join(p, 'index.html');
    if (await stat(asDir).catch(() => null)) return { file: asDir };
  }
  return { notFound: true, wanted: clean };
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const cookies = readCookie(req.headers.cookie);

  if (url.pathname === '/api/geo') {
    // priority: explicit override -> dev cookie -> env default -> unknown
    const country = (url.searchParams.get('country') || cookies.dev_country || process.env.DEV_COUNTRY || '').toUpperCase();
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({ country, note: country ? 'simulated by dev-server' : 'no country: the site falls back to browser language and timezone' }));
  }

  if (url.pathname === '/__geo') {
    const country = (url.searchParams.get('country') || '').toUpperCase();
    res.writeHead(302, {
      location: url.searchParams.get('go') === '0' ? '/en/' : '/',
      'set-cookie': `dev_country=${country}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`
    });
    return res.end();
  }

  // ---------------------------------------------------------- test-only helpers (never in a build)
  // /__files/photo.png  -> bytes of test-files/photo.png, so a page can build a real File object
  if (url.pathname.startsWith('/__files/')) {
    const name = basename(url.pathname.slice(9));
    if (!/^[\w.\- ]+$/.test(name) || name.includes('..')) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad fixture name');
    }
    const body = await readFile(join(FIXTURES, name)).catch(() => null);
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('no such fixture: run  node scripts/fixtures.mjs');
    }
    res.writeHead(200, {
      'content-type': MIME[extname(name).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      'access-control-allow-origin': '*'
    });
    return res.end(body);
  }

  // POST /__save?name=out.pdf  <- tool output, so Node can inspect what the browser produced
  if (url.pathname === '/__save' && req.method === 'POST') {
    const name = basename(url.searchParams.get('name') || 'out.bin');
    if (!/^[\w.\- ]+$/.test(name) || name.includes('..')) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad name');
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, name), Buffer.concat(chunks));
    res.writeHead(200, { 'content-type': MIME['.json'], 'access-control-allow-origin': '*' });
    return res.end(JSON.stringify({ saved: name, bytes: Buffer.concat(chunks).length }));
  }

  // GET /__files  -> what the fixture folder holds, for the verification scripts
  if (url.pathname === '/__files') {
    const entries = await readdir(FIXTURES, { withFileTypes: true }).catch(() => []);
    const files = entries.filter(e => e.isFile()).map(e => e.name).sort();
    const captured = await readdir(OUT).catch(() => []);
    res.writeHead(200, { 'content-type': MIME['.json'], 'cache-control': 'no-store' });
    return res.end(JSON.stringify({ fixtures: files, captured: captured.sort() }));
  }

  // GET /__script/<name>.mjs  -> scripts/browser/<name>.mjs, so the verification driver lives in
  // a real file (editable, reviewable) instead of being pasted into every browser eval. .json
  // beside it is the sweep plan: which tool gets which fixture and which field values.
  if (url.pathname.startsWith('/__script/')) {
    const name = basename(url.pathname.slice(9));
    if (!/^[\w.-]+\.(mjs|json)$/.test(name)) {
      res.writeHead(400, { 'content-type': 'text/plain' });
      return res.end('bad script name');
    }
    const body = await readFile(join(ROOT, 'scripts', 'browser', name)).catch(() => null);
    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end(`no such driver: scripts/browser/${name}`);
    }
    res.writeHead(200, {
      'content-type': MIME[extname(name)] || 'text/plain',
      'cache-control': 'no-store'
    });
    return res.end(body);
  }

  const r = await resolve(url.pathname);
  if (r.status) {
    res.writeHead(r.status, { 'content-type': 'text/plain' });
    return res.end(r.body);
  }
  if (r.notFound) {
    // serve the locale 404 page when the first path segment is a locale, else the English one
    const LOCALES = ['en', 'zh', 'es', 'fr', 'de', 'pt', 'ja', 'ko', 'ru', 'vi', 'ms', 'id', 'hi'];
    const guess = r.wanted.split(/[\\/]/).filter(Boolean)[0];
    const page = join(DIST, LOCALES.includes(guess) ? guess : 'en', '404.html');
    const html = await readFile(page).catch(() => Buffer.from('Not found'));
    res.writeHead(404, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
    return res.end(html);
  }
  const body = await readFile(r.file);
  const ext = extname(r.file);
  res.writeHead(200, {
    // everything is no-store here on purpose. Production caches assets for a year (vercel.json,
    // _headers), but a dev server that does the same shows you last week's JavaScript: rebuild,
    // reload, and the browser keeps the old module. The sweep hit exactly that.
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': 'no-store',
    'cross-origin-opener-policy': 'same-origin-allow-popups'
  });
  res.end(body);
});

server.listen(PORT, HOST, () => {
  console.log(`\n  ${DIST} served on http://localhost:${PORT}\n`);
  console.log('  routing: the root / always opens the English home /en/ (no IP / browser / cookie guess):');
  console.log('    http://localhost:' + PORT + '/                  → /en/');
  console.log('    http://localhost:' + PORT + '/__geo?country=CN   → still /en/; the country now only gates the GDPR consent banner');
  console.log('    http://localhost:' + PORT + '/__geo?country=     → clear the simulated country');
  console.log('    change language with the header 🌐 menu, e.g. 中文 → /zh/');
  console.log('    http://localhost:' + PORT + '/en/?noads=1        → force-hide live ad slots (ads are off by default)');
  console.log('\n  the site never uploads files: open a tool page and watch the Network tab\n');
});
