// Client helpers for the manual-only language UI and the GDPR consent banner.
//
// There is deliberately NO automatic language detection here. The root path / always opens the
// English home (/en/) — see src/scripts/router.js plus the server 301 in vercel.json /
// dist/_redirects — regardless of the visitor's cookie, IP country, browser language or timezone.
// A visitor changes language only by clicking the header language menu, which calls writeCookie()
// and navigates to /<locale>/ explicitly. The former detectLocale / fromCountry / fromBrowser /
// supported / readCookie auto-routing helpers were removed so nothing can silently re-guess a
// language from the visitor's environment.
//
// geoCountry() survives for one unrelated job: deciding whether the AdSense consent banner must
// show in EU/EEA/GB/CH regions. It reads the platform header via /api/geo (cf-ipcountry /
// x-vercel-ip-country, or the dev server's simulation) and never contacts a third-party geolocation
// API, so the visitor's IP stays out of anyone else's logs.
export const COOKIE = 'th_locale';
export const DAY = 86400e3;

// Persist a manual language choice. Nothing reads it to redirect any more (the root is fixed to
// English and every in-site link is already locale-prefixed); it is kept as a single explicit write
// so a future preference surface can reuse it without re-introducing environment-based guessing.
export function writeCookie(value, days = 365) {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; SameSite=Lax${secure}`;
}

// The visitor's country from the platform header. Used ONLY for the GDPR consent banner, never to
// pick a language or to redirect.
export async function geoCountry(timeout = 900) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch('/api/geo', { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return '';
    const data = await res.json();
    return (data.country || '').toUpperCase();
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}