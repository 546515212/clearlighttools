// Vercel Serverless Function: GET /api/geo
// Vercel adds x-vercel-ip-country to every request, so the site can pick a language from the
// visitor's country without a third-party geolocation lookup and without storing any IP address.
// The edge network already resolves it, so this is a ~0 ms read of a request header.
//
// Cloudflare Pages serves the same contract from /functions/api/geo.js (cf-ipcountry).
// The client only ever consumes { "country": "DE" }, so both platforms are interchangeable.

const DEV_COOKIE = 'dev_country';

function countryFromCookies(header = '') {
  // lets you force a country in a real browser: document.cookie = 'dev_country=DE; path=/'
  for (const part of header.split(';')) {
    const [k, v] = part.trim().split('=');
    if (k === DEV_COOKIE && v) return decodeURIComponent(v).toUpperCase();
  }
  return '';
}

export default function handler(req, res) {
  const country =
    (req.headers['x-vercel-ip-country'] || '').toUpperCase() ||
    countryFromCookies(req.headers.cookie);
  res.setHeader('cache-control', 'private, no-store');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-type', 'application/json; charset=utf-8');
  // preflight for the (rare) case the page is served from a different origin
  if (req.method === 'OPTIONS') {
    res.setHeader('access-control-allow-origin', '*');
    return res.status(204).end();
  }
  return res.status(200).end(JSON.stringify({ country }));
}
