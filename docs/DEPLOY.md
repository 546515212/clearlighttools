# Deploying ClearLight Tools

The site is static. A deploy is: build `dist/`, publish `dist/`, point a domain at it. There is one
tiny server-rendered endpoint (`/api/geo`, ~15 lines) and it exists on both platforms.

Pick a platform first — Vercel or Cloudflare Pages — because that decides which country header you
get and where `_headers` lives. Either way the repo is the source of truth; nothing is configured in
the hosting UI except the project itself and the domain.

## 0. Fill in the placeholders

`config/site.json`, then `node build.mjs`:

```jsonc
{
  "brand": "ClearLight Tools",             // what appears in titles and the header
  "baselineUrl": "https://your.domain",    // was https://example.com — canonical, og, sitemap
  "supportEmail": "you@your.domain",       // privacy page, footer, DMCA
  "ads": { "clientId": "ca-pub-XXXXXXXX" },// empty until AdSense approves the site
  "analytics": { "gtagId": "" }            // optional; leave empty if you use nothing
}
```

`baselineUrl` is the one that must be right before the first page is indexed: it is baked into
`<link rel="canonical">`, `og:url`, `robots.txt`, the single `sitemap.xml` and `llms.txt`. Changing it
later means re-submitting the sitemap and waiting for re-crawl.

Also add your own `src/assets/og.png` (1200×630). The build warns while it is missing.

## 1. Vercel

`vercel.json` is already correct: `framework: null`, `buildCommand: node build.mjs`,
`outputDirectory: dist`, and `api/geo.js` as a 128 MB / 10 s function.

```
npm install -g vercel
vercel link                    # pick the GitHub repo and the production branch
vercel                         # preview deployment, check a URL or two
vercel --prod
```

Or push the repo to GitHub and import it at vercel.com/new — no settings to change, the config file
is read automatically.

Vercel adds `x-vercel-ip-country` to every request. `api/geo.js` reads it and returns
`{"country":"DE"}`; the site turns that into a language through the table in `config/site.json`. No
IP address is stored, logged or sent anywhere, and no third-party geolocation call is made.

Domain: add it in the Vercel dashboard (DNS records are shown there). Then set
`baselineUrl: "https://your.domain"` and redeploy.

## 2. Cloudflare Pages

Same output directory, same build command. Cloudflare reads `functions/api/geo.js` automatically
and it reads `cf-ipcountry` instead.

```
npm install -g wrangler
wrangler pages project create clearlight-tools
npm run build
wrangler pages deploy dist --project-name clearlight-tools
```

or connect the Git repository in the Cloudflare dashboard (build command `node build.mjs`, output
directory `dist`).

`build.mjs` writes `dist/_headers` with the same security and cache policy that `vercel.json`
declares, so the two platforms behave identically. Keep them in sync when you change one.

If you use a custom domain, enable "Always HTTPS" and set the root path to `/en/` — the site's `/`
is a small page that redirects to `/<locale>/` once the language is known.

## 3. Google AdSense

The site ships with ads **off** (`config/site.json → ads.enabled: false`, the `ENABLE_ADS` master
switch). While it is off — or while `clientId`/`slotIds` are still empty — the native `adSlot()`
renderer emits **zero ad DOM** on every page: no placeholder boxes, no loader script, nothing
requested from Google. This is the clean state to submit for AdSense review and to test locally.

1. Apply with the site live. Ads are refused on a domain with too little content; the 78 tool pages
   each carry a localized intro, how-to, FAQ and overview, so apply once the site is live and indexed.
2. After approval, flip the switch on and fill the ids. In AdSense create the ad units and put the
   slot ids in `ads.slotIds` — the ids are separate from `ads.slots`, which only describes size and
   format:

   ```jsonc
   "ads": {
     "enabled": true,
     "clientId": "ca-pub-XXXXXXXX",
     "slotIds": { "header": "1234567890", "inContent": "2234567890" },
     "slots":   { "header": { "format": "horizontal", "size": "970x250" }, … }
   }
   ```

   Slot names: `header` (above the tool) and `inContent` (below the results). Density is capped in
   `src/templates.mjs`: tool/home/category pages render at most these 2 slots, legal pages 1. A slot
   with no id renders nothing — there is never an empty box. `?noads=1` force-hides any live slots for
   screenshots. No popups or interstitials are used anywhere.
3. `ads.enabled: false` takes the loader and every ad container out of the build entirely.
4. `ads.txt` is generated for you: as soon as `ads.enabled` is true and `ads.clientId` is set,
   `node build.mjs` writes `dist/ads.txt` with the standard Google line. While the id is empty the
   build says so instead of shipping a monetised site with no ads.txt — a guaranteed review failure.

## 4. Consent (this is a legal requirement, not a preference)

With `ads.clientId` set and EU/EEA/UK traffic, AdSense requires a confirmed consent state before it
serves personalised ads, and you need a TCF-Compatible Consent Management Platform for it to reach
Google's ad stack. `config/site.json → consent` shows the simple local banner that exists now; it
is a placeholder for a real CMP.

Pick one before turning ads on:

- Google's own "GDPR Consent" message (free, part of AdSense → Settings → Access and consent).
  Lowest effort, and it is what AdSense recognises.
- A paid TCF v2.2 CMP (Sourcepoint, Consentman, Cookiebot…). Needed if you also serve other
  networks or want audit records.

Whichever you choose, remove or disable the local banner (`consent.enabled: false`) so the visitor
does not get asked twice, and re-check that `privacy` and `terms` pages describe the actual
processor list.

## 5. Post-deploy checks

```
# routing: the root / always opens the English home /en/ (permanent redirect, no IP/browser/cookie guess)
curl -sI https://your.domain/                       # 301/308 -> /en/ (vercel.json / _redirects)
curl -s  https://your.domain/api/geo                # {"country":"…"} for your own IP — gates the consent banner only

node scripts/browser-report.mjs --strict            # against the local build
```

Then by hand, on the live domain:

1. `/de/pdf/compress-pdf/` renders with `Deutsch` navigation and no console errors.
2. View-source on one page: `canonical`, `og:url`, `hreflang` alternates all say the real domain,
   not `example.com`.
3. `https://your.domain/sitemap.xml` opens and lists all 1183 indexable URLs (13 locales × 91).
4. Submit the sitemap in Google Search Console and Bing Webmaster Tools; verify the domain first.
5. One tool run on a phone (iOS Safari especially — clipboard and `showSaveFilePicker` differ).

## 6. Updating

Push to the production branch; both platforms rebuild on every push. `node build.mjs` is deterministic
except for `lastmod` in `sitemap.xml`, so a rebuild with no source change only moves those dates.

To add a tool: entry in `src/data/tools.json`, implementation in the right
`src/scripts/tools/<category>.js` bundle, copy in `src/locales/en.tools.json` (+ `titles.json`),
then `npm run check` and the browser sweep. The build regenerates pages, `sitemap.xml`, RSS and the
search index; there is nothing to edit by hand.
