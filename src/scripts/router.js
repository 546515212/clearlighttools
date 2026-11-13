// Root page (/): always open the default-locale home (English). The entry point is deliberately
// stable — it is NOT guessed from the visitor's cookie, IP country, browser language or timezone,
// so users and Googlebot alike land on the same /en/ home. Changing language is a manual action:
// the header language menu navigates to /<locale>/ explicitly. This client redirect is the
// universal fallback for plain static hosts; Vercel (vercel.json) and Cloudflare Pages (_redirects)
// issue a server-side 301 from / to /en/ so the hop happens at the edge before this file runs.
const cfg = window.__TH_CONFIG;
const target = (cfg && cfg.defaultLocale) || 'en';
location.replace(`/${target}/`);             // replace: no back-button trap

// if navigation is blocked (unusual), show the language list instead of a blank page
setTimeout(() => {
  const box = document.getElementById('root-msg');
  if (box) box.hidden = false;
}, 1200);