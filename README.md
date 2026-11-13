# ClearLight Tools — a 78-tool browser toolbox in 13 languages

Static site: PDF, image/audio, text/code and calculator tools that all run **in the visitor's
browser**. No uploads, no backend, no user data. Ads (Google AdSense) hold their slots in the
layout; language is picked from the visitor's country and can be overridden by hand.

Built as plain HTML + a Node build script. No framework, no bundler, no runtime dependencies.

```
npm install        # only jsdom, and only for the test harness
npm run dev        # build + serve on http://localhost:5173
```

Then open <http://localhost:5173/en/pdf/compress-pdf/> and try something. `npm test` equivalent is
`npm run check` — build, translation gaps, six static checks (imports, label collisions, fullwidth
punctuation, cross-locale title leaks, widget-label survival, the routing table), byte-checked
fixtures and a headless smoke of all 78 tools. Each check carries a `--selftest` that proves it can
still fail. The real browser sweep that feeds files through each tool is `npm run report`; both are
described in [docs/TESTING.md](docs/TESTING.md).

## What is where

```
config/site.json          brand, locales, country table (consent only), ad slots, consent
src/data/tools.json       the 78 tools: id, category, hot flag, vendor libs needed, keywords
src/data/categories.json  the six categories and their copy
src/scripts/lib.js        shared widget helpers (fields, drop zone, run(), download, loadLib…)
src/scripts/runtime.js    what runs on every page: manual language menu, dictionary, mount the tool
src/scripts/tools/*.js    the tools, one bundle per category (pdf, image, audio, video, text, calc)
src/templates.mjs         home, category, tool, legal and 404 page templates
src/locales/              <lang>.json chrome, <lang>.tools.json tool copy, titles.json headlines
src/styles/site.css       the whole stylesheet
vendor/                   pdf-lib, pdf.js, jszip, qrcode-generator, gifenc, marked
build.mjs                 generator → dist/ (1198 pages + sitemap.xml + robots + llms.txt; ads.txt only
                          once config/site.json has a real ads.clientId)
dev-server.mjs            local static server + /api/geo stand-in + test-only routes
scripts/                  fixtures, smoke test, translation report, browser sweep
docs/                     DEPLOY.md · TESTING.md
api/geo.js                Vercel function: visitor country from the platform header
functions/api/geo.js      the same contract for Cloudflare Pages
```

A built page lives at `dist/<locale>/<category>/<tool-id>/index.html`, so
`https://<domain>/de/pdf/compress-pdf/` is the German version of that tool. `/` redirects to
`/<locale>/` once the language is known.

## Language routing

Priority, first match wins (implemented in `src/scripts/runtime.js`, table in `config/site.json`):

1. the `th_locale` cookie, set by the language switcher — a human choice always wins;
2. the visitor country from `/api/geo` (`cf-ipcountry` on Cloudflare, `x-vercel-ip-country` on
   Vercel). For multi-language countries the table lists candidates and the browser language picks
   between them (Malaysia → `ms, en, zh`);
3. `navigator.language`, if it matches a supported locale;
4. the browser timezone, through `routing.timezoneToLocale`;
5. `defaultLocale`.

Locales: en (default), zh, es, fr, de, pt, ja, ko, ru, vi, ms, id, hi.

## Tools

| category | count | examples |
|---|---|---|
| PDF | 11 | compress, merge, split, rotate, watermark, pdf→jpg, pdf→text, images→pdf, html→pdf, page numbers, invoice |
| Image | 14 | compress, convert, resize, base64 both ways, QR, favicon, colour picker, gif, contrast, signature, ID photo, mosaic, grid split |
| Audio | 10 | trim, join, convert, volume, reverse, speed, pitch, equalizer, voice recorder, sound level meter |
| Video | 5 | compress, screen recorder, webcam recorder, camera/mic test, teleprompter |
| Text / code | 22 | word count, case, json, csv→json, markdown, hash, uuid, regex, diff, speech, encrypt, css |
| Calculators | 16 | percentage, BMI, age, dates, loan, discount, units, colour, calories, timestamp, world clock, pomodoro |

Every one of them reads files with the local vendor library and hands back a blob. Nothing is
posted anywhere except to `/_sources/` in your own browser.

## Before you go live

`config/site.json` already carries the live brand and domain (`ClearLight Tools`,
`https://clearlighttools.com`). Ads ship **off** behind the `ENABLE_ADS` master switch
(`ads.enabled: false`):

- while the switch is off — or `ads.clientId` / `ads.slotIds` are empty — the native `adSlot()`
  renderer emits no ad DOM at all: no placeholder boxes, no loader, nothing requested from Google.
  This is the clean state for the AdSense review submission and local testing.
- after approval, set `ads.enabled: true` and fill `clientId` (your `ca-pub-…`) plus the per-unit
  `slotIds`. Tool/home/category pages then render at most 2 slots (above the tool + below results),
  legal pages 1; `?noads=1` force-hides them for screenshots. No popups or interstitials.

`baselineUrl` is baked into every canonical, og:url, sitemap and llms.txt.

Then follow [docs/DEPLOY.md](docs/DEPLOY.md) for the platform, the AdSense slot ids and the GDPR
consent requirement. Verify with [docs/TESTING.md](docs/TESTING.md) before publishing.

## Status

Working and tested locally: all 78 tools implemented, 1198 pages building across 13 locales, the
root / fixed to the English home /en/ (manual language switching only — no IP / browser / cookie
guess), ads off by default behind ENABLE_ADS (no placeholder boxes), and all 13 locales fully
translated (chrome, tool copy, widget labels and SEO). The full `npm run check` chain — build,
translation parity, the SEO gates (`check:tkd`, `check:toolseo`, `check:seotags`, `check:serp`),
fixtures, and the headless smoke + per-locale mounts — exits 0.

Still open, deliberately:

- **AdSense ids** — ads ship off (`ads.enabled: false`, the ENABLE_ADS switch). `ads.clientId` and the
  per-unit `ads.slotIds` stay empty until AdSense approves the site; until then no ad DOM renders at all.
- **No git repository yet** — this tree has never been committed or pushed.
- **compress-video** is implemented but untested: there is no video fixture.
- **html-to-pdf** works, but its final step is the browser print dialog, which no script can
  press. The automated sweep checks the preview render only.
- **Offline badge is not yet true** — the home page promises "runs offline after first visit", and
  there is no service worker. See the last item of docs/TESTING.md.
