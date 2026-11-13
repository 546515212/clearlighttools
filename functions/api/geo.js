// Cloudflare Pages Function: GET /api/geo
// Cloudflare puts the visitor country on every request as cf-ipcountry, so the site can
// choose a language without calling a third-party geolocation API and without logging IPs.
// Deploy: this file is picked up automatically by Pages Functions (no extra config).
export async function onRequestGet(context) {
  const { request } = context;
  const country = (request.headers.get('cf-ipcountry') || '').toUpperCase();
  return new Response(JSON.stringify({ country }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // a per-visitor value: keep it out of shared caches
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff'
    }
  });
}
