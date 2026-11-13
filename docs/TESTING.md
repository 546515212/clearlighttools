# Testing this site

Three layers, cheapest first. All of them run on your laptop with no network access beyond the
vendor files already in `vendor/`.

```
npm run check          # build + translation gaps + static checks + fixtures + headless smoke (a few minutes)
```

## 1. The build itself

`node build.mjs` writes 1198 pages to `dist/` and prints what it did:

- page count and per-locale translation coverage bars;
- missing vendor files (`npm run vendor` fetches them);
- a note when `src/assets/og.png` is absent;
- placeholder config values that still need a real domain or ad client id.

It fails loudly rather than quietly: a tool with no dictionary entry or a template that throws
stops the build.

### The static checks inside `npm run check`

| command | what it proves | why it exists |
|---|---|---|
| `npm run check:imports` | every shared helper a tool file *calls* is imported or declared there | `markdown-to-html` threw `loadLib is not defined` inside a `catch` that printed "The Markdown library could not be loaded" — a wrong explanation, so the real cause never surfaced |
| `npm run check:nullchildren` | no `null`/`undefined` is ever handed as a child to a native DOM child call (`append`, `prepend`, `replaceChildren`, `insertBefore`, `before`, `after`) — where it becomes a text node literally reading "null" | `el()` drops a null child, so `el('div', {}, a, cond ? b : null)` is normal here and works. The DOM's own `append()` does not: its argument is "Node or DOMString", and null converts to the DOMString `"null"`. Eight panels did that, and the word appeared under a result on every page in all 13 locales — it is not translatable, so no dictionary check could see it, and it is a legal text node, so the HTML and placeholder checks saw nothing wrong either. 9 selftest cases, 6 of which must stay silent on purpose (`el()`'s null, `add()`'s null) because the fix is `add()`/`fill()`, not a ban |
| `npm run check:labels` | each `L('key', 'fallback')` fallback matches the merged English dictionary | the flat dictionary namespace means two tools sharing a key silently overwrite each other's label: "Target quality" appeared on a file-size field |
| `npm run check:wrap` | every string a tool renders comes from a dictionary call, never from English written in code — 15 codemod fixture cases plus a live `--check` over all 78 tools | `markdown-to-html` passed `L('inputText', 'Markdown')` and users read "Text to hash", because the key already meant something else for the hash tool. Machine translation has nothing to work on until every visible string is a key |
| `npm run check:notes` | every `note()` (the grey line under a result) takes its text from the dictionary or a variable | a result message is the one line a visitor reads after pressing the button, and it was the last place English survived a "fully localised" page |
| `npm run check:translations` | every locale layer file is well-shaped JSON, every key it supplies lands on a real English string, `{0}`-style arguments and literal markup survive, no 3-word sentence is a copy of the English, and no sentence-shaped key was answered with a fragment (`THIN`) | a shard nested under `"tools"` instead of `"t"` parses, merges, builds and ships — and the locale stays English forever with every green number it has ever had. The `THIN` half is newer: Hindi arrived with every key present, in Devanagari, with no placeholder lost, and 49 `desc`/`intro` values that were two-word summaries of a 150-character English sentence ("बढ़ोत्री और कमी।" for "Answer the four percentage questions people actually search for: …"). Coverage said 100 %, every other rule said clean |
| `npm run check:parity` | a translated shard ships **exactly** the keys the skeleton asked for: nothing dropped, nothing stale, nothing left empty | `check:translations` proves every key a shard *does* supply is real, and the coverage report prints a number, but a translator who deletes forty lines while pasting loses nothing: the keys fall back to English, the percentage ticks down and the build stays green. The parity check recomputes the very list `translation-shard.mjs --emit` would have written — same loader, same `titles.json` credit — so "translated the batch" and "shipped the batch" become one statement |
| `npm run check:serp` | every built tool `<meta name="description">` fits its per-script SERP window — EN 135-158 cp, CJK (zh/ja/ko) 70-85 cp, other locales ≤160 cp — measured from `dist/` across all 13 locales (1014 tool pages) | the owner's overhaul replaced one global cap with a per-script budget: a 158-char English desc is right, but the same byte budget would let a Chinese desc run to 158 Han characters, far past what Google shows for CJK. French, German, Spanish, Portuguese and Russian run 10-25 % longer than English, so a single cap shipped pages Google truncates mid-sentence. The dictionary checks cannot see it — the string is correct, complete and translated, it just does not fit the SERP |
| `npm run check:tkd` | every built page (1197: home, 6 categories, all, 78 tools, 5 legal, 404 per locale + the root chooser) carries a search-shaped **T**itle, **D**escription and **H**1 in its own language, with **no `<meta name="keywords">` anywhere** (the K of TKD was removed site-wide for 2026 Google norms). Tool title/desc/h1 are re-derived byte-for-byte with the template's own `src/seo/compose.mjs` composers from that locale's seed (`src/seo/tool-seo/<locale>.json`) and the built client dict's `search[id].title`; per-script length windows are the owner's (EN title ≤60 with <50 a soft long-name fallback, CJK title ≤30; EN desc 135-158, CJK desc 70-85, other ≤160). Home title/desc are owner-exact per locale from `src/seo/keywords.json`; category/all/legal/404 titles are `plainTitle(label, brand)`. `noindex` pages (404, contact) are exempt from the length window only — brand, exact-form and no-keywords still bind | the site once shipped no keywords at all and bare navigation-label titles; the overhaul removed keywords entirely and composed keyword-first titles. A French↔Spanish swap looks fine to every dictionary check (both Latin), so this reads the built page and re-derives what *that* locale should produce. The `noindex` length exemption is proven by counter-proof: the same over-length string fires hard on an indexable page. ~40 selftest cases, one per rule, each isolated so it must fire |
| `npm run check:fullwidth` | no U+FF0B/FF0D/FF1D/FF05 anywhere, and no fullwidth `：；（），` outside zh/ja/ko | two labels were typed in an IME and shipped as `＋ inches`; a fullwidth plus is invisible in a screenshot. `--selftest` asserts the rule still bites — without it the check would go green by stopping work |
| `npm run check:locale` | every built `dict.<l>.js` title equals **that locale's own** override, and no page's `<h1>` is another locale's string | `deepMerge` returned aliased nested objects, so each locale's override was written into the table the next locale started from: nine of thirteen locales shipped the Indonesian headline "Kompres PDF". The pages were valid, translated-looking and green everywhere else |
| `npm run check:widgets` | every widget label a locale *authors* (`w`: width, level, download, quality …) is what the built dictionary says — in `<l>.json`, `<l>.tools.json` **and** every `src/locales/<l>/*.json` shard | the English widget table was merged *over* the locale layer, and 54 of the 56 authored keys exist in English too, so 11 locales lost their field labels back to English. The coverage report never counts the `w` layer, so no number moved. The check then went blind a second way: it carried its own two-file list, so a label supplied by a shard was authored text nobody compared |
| `npm run check:tokens` | every dictionary key that a tool hands to `toLocale*`/`new Intl…` **as an option value** still says exactly what the source's own fallback says, in all 13 built dictionaries | `{ weekday: L('long', 'long') }` reads like a label, so the hardcoded-English sweep wrapped it into the dictionary and twelve machine translations translated it. `RangeError: Value largo out of range for Intl.DateTimeFormat options property weekday` then killed the date calculator — correct HTML, correct coverage, dead page. The token list is extracted from the tool sources at check time, so a second occurrence in a new tool is covered without editing the check |
| `npm run check:locales` | all 12 non-English locales mounted and clicked, 936 tool runs in total (`smoke-all.mjs`), each against its own built dictionary | see `check:tokens`: the English-only smoke cannot see a crash that only happens once a locale's words reach the code. Running the page with *that* dictionary is the execution half of the translation gate, and it catches any other locale-specific value that turns out not to be prose |
| `npm run check:routing` | the shipped `countryToLocales` table is followed exactly, and the resolver never answers with a locale the site does not build | a routing bug is invisible locally: everything looks right until a visitor from the wrong country gets the wrong language. 32 table-derived cases plus the invariant "never an unbuilt locale" over every country × 8 browser languages |
| `npm run check:residual` | the 1523 strings each page really **renders** are in that page's own language — `smoke.mjs` dumps every text node of all 78 mounted panels per locale and the audit compares each dump against the English one under five rules: same string (R1), same string with its numbers written the local way (R3), English words inside otherwise-translated text (R2), an English value poured into a translated `{0}` sentence (R4), and a rendered string that is not a word in any language (`null`, `NaN`, `[object Object]`) (R5) | twelve locales shipped `30 days 後`, a loan table headed `Paid in year`, `fails WCAG` and a password meter reading `very strong` — and every gate said 100 %, because those strings came from template and array literals in the tool bundles and never asked `L()` for anything. A check that reads dictionaries cannot see a string the code never put in one, so this reads the other artefact. R3 exists because a German BMI band printed `Healthy 18,5 – 24,9`, which differs from English only by a comma; R4 because `Basiseinheit: meter` had a translated sentence and an untranslated argument; R5 because a page printing the word "null" is not a translation problem at all — and it is checked on the English page too, which no other rule in the file reads |

`check:fullwidth --selftest` is the pattern worth copying: it runs the scanner over in-memory
samples, including two that must stay silent (CJK typography in zh/ja/ko) and five that must be
caught, then re-runs them with English added to the CJK list and refuses to pass unless that
mutation changes a verdict. An empty hit list otherwise cannot tell "fixed" from "not looked".
`check:locale` (9 cases), `check:widgets` (9 cases), `check:translations` (20 cases) and
`check:tokens` (9 cases) follow it, and each has been fired against the real `dist/` by hand: two
German strings reverted to English in `dict.de.js` and the check named both and exited 1; a seventh
Spanish label added to `src/locales/es/10-w.json` without rebuilding printed
`w.nonceLabel … -> (absent)` and exited 1 under `--strict`; moving `src/locales/id/10-w.json` out of
the tree drops the widget-label comparison from 8640 authored labels to 7974 — exactly that shard's
666 — which is the proof that the labels a shard supplies are in the comparison and not merely on
disk; and rewriting `"numeric":"numeric"` to `"numerisch"` in `dict.de.js` made `check:tokens` print
`FAIL de: src/scripts/tools/calc.js:171 passes { day: L('numeric', 'numeric') } … "numerisch"` and
exit 1, then the same sabotage in `dict.zh.js` made the locale smoke mount 48/49 tools instead of
49/49. `check:tokens`' own selftest ends with the mutation proof in the other direction: it re-runs
the real extracted token list against a deliberately correct dictionary and fails if that reports a
finding, and fails if an empty token list still manages to "compare" something.
`smoke-all --selftest` goes one step further than an in-memory sample: it sabotages a real
`dist/_assets/dict.<l>.js`, requires the locale to fail, and restores the file byte for byte in a
`finally` (a sabotage that survived into the next command would look like a translation bug).
`check:translations` (20 cases) and `check:widgets`' last two cases run against a fixture tree under
`test-files/`, never against `src/locales/`, so a selftest can be wrong without damaging a
dictionary. Every one of these checks also counts what it compared and fails on a count of zero, so a
moved file or a renamed namespace cannot present as a pass.

`check:tkd` was rebuilt for the owner's SEO overhaul and verified against the real `dist/`: all 1197
built pages carry a search-shaped title, description and h1 in their own language, with no
`<meta name="keywords">` anywhere, and the gate exits 0. Its selftest carries roughly forty in-memory
cases, one per rule, each isolated so it must fire and each paired with a counter-proof:

- **NK** — keywords on a tool page *and* on the home page both fire (the old home exemption is gone);
  absent keywords stay silent.
- **T1–T4** — missing title; over-60 EN / over-30 CJK title fire hard while an EN long-name fallback
  (<50) is only a soft note; a title without the brand fires T3; a bare navigation-label title or one
  wearing another locale's "Free Online" modifier fires T4 (the regression the composer exists to prevent).
- **D1–D3** — missing description; EN 159/134, CJK 86/69 and other-locale 161 fire hard, other-locale
  100 is soft; a description that is not the composed form fires D3. The home length exemption is
  proven home-only: the same 163-char description is exempt on home but fires D2 hard on a tool.
- **H1 / SCRIPT** — a missing or non-composed h1 fires H1; the root chooser needs no h1; a zh category
  title written in Latin fires SCRIPT while one carrying Han stays silent.
- **noindex exemption** — a `noindex` 404 is exempt from the length window, but the *same* over-length
  string fires hard on an indexable page, and a `noindex` page still fires T3 (missing brand) and NK
  (keywords). `lengthVerdict` mutations pin the per-script edges (CJK title 30 ok / 31 not, EN desc
  158 ok / 159 not).

The home TKD source is gated separately (`judgeData`): `src/seo/keywords.json` must give every locale a
concise, branded, distinct `homeTitle` (CJK ≤30 cp, other ≤60) and a present, distinct `homeDesc`, so a
half-finished or copy-of-English home source is named rather than silently shipping. The tool seeds are
gated by `check:toolseo`. Because the gate re-derives each title/description with the template's own
`src/seo/compose.mjs` composers and the built client dict's `search[id].title`, a French↔Spanish swap
(both Latin, invisible to a script check) is caught by exact re-derivation.

`check:residual` proves itself twice, because it is the only gate that reads what the page renders and a
rendering can go wrong in two independent ways: the comparison can stop working, or the rule set can.
Its 17 in-memory cases name the rule each finding must be credited to (a whole-string judge reports
"Paid in year" and misses the other five), and then the real pipeline is asked to plant two things:
`smoke.mjs`'s probe panel appends an untranslated phrase *and* a literal `null` — the original bug, made
the original way — and the run refuses to continue unless the translated sweep reports both and the
English-side scan reports the null too. Severing the not-a-word rule (`const broken = []`) printed
`FAIL "a value, not a word" is not caught by the rule it exists for (got nothing)` plus
`FAIL the panel that appends a null to itself reported 0 not-a-word finding(s) on the de probe`, which is
the difference between a clean site and a blind audit.
`check:nullchildren` carries the same idea statically: 9 cases, 6 of which must stay silent on purpose —
`el('div', {}, a, cond ? b : null)` and `add(x, y && null)` are supported here — and its mutation is
ignoring the callee name, which flips 4 verdicts and is therefore refused.

`THIN` needed a different kind of proof, because its evidence is a distribution and a distribution can
be quiet for the wrong reason. Its five fixture cases all declare how many prose leaves they expect to
have compared (`prose=18(want 18)`), so "no findings" and "no sample" print differently; the pair that
matters is the baseline at normal density (must be silent) against the same dictionary with one leaf
stubbed (must report exactly 1); and the last case is a locale stubbed *all the way down*, where the
median itself is a stub, the relative rule can see nothing, and only the absolute floor reports it.
The selftest then runs the rule over the real tree and fails if the pattern stops matching the real
keys — it prints the locale medians it read (`zh 0.30, ja 0.53, es 1.18 … hi 1.08`), which is also the
number to watch if a future sweep starts summarising again: CJK legitimately sits at a third to a half
of English length, which is exactly why the cut-off is each locale's own median times 0.35 and not a
constant (a constant at 0.4 would have flagged 63 honest Chinese strings and caught nothing new).
`check:serp` is calibrated the same way and carries the same two halves: in-memory rows that flip
verdict at each per-script window edge (EN 135-158, CJK 70-85, other ≤160), and one real page parsed
out of `dist/`, because a template that renames its `content` attribute would otherwise leave the
check measuring nothing.

Six dictionary bugs, one lesson each: **a locale's own words must never lose to the English base
layer**, **a check that hardcodes the list of files to read is one refactor away from reporting
nothing**, **a dictionary value is not necessarily prose**, **a supplied key is not necessarily a
translation**, **a correct translation is not necessarily a usable one**, and **a built dictionary is
not the locale's own words.** The first two were
invisible to the numbers people look at — coverage percentage, build success, page HTML validity — and
were only findable by comparing the built artifact against what the locale authored, so both checks
read `dist/` rather than re-implementing `build.mjs`: a check that re-runs the merge in its own code
tests the check, not the build. The third was the same failure in the checker itself: it re-listed the
locale's files instead of asking the loader, and stayed green over a layer it had stopped reading.
`scripts/lib-locale-layers.mjs` exists so build, coverage report, translation checker and widget-label
checker cannot drift apart again. The fourth is newer and nastier: every translation gate passed on a
locale whose calculator threw, because `L()` had been asked for something that is an API enum rather
than a word — so the fix is not another string rule but two execution rules, `check:tokens` (the built
value must equal the source's own fallback) and `check:locales` (the page must actually run in that
locale). The fifth was the Hindi bulk layer: 49 tools × `desc` + `intro` arrived as summaries, and
every key-level rule in the project — shape, dead keys, placeholders, markup, identical-to-English,
parity, coverage — had nothing to say about a value that is in the right language and simply short.
The lesson is that a count of supplied keys measures *presence*, so length had to become a checked
property, and that the stubs were hiding in `<l>.tools.json`, the one layer no shard sweep touches:
the fix moved those 98 keys into `src/locales/hi/2x-t-*.json` shards so parity and THIN both see them,
and left `hi.tools.json` holding only the titles it is actually responsible for. The sixth was the
rendered-audit reading `dist/_assets/dict.de.js` as "what German ships": the built file is English
merged *under* the locale, so every key German has not answered yet still carries its English value
there — the audit's suppression list contained every English word, and it reported 3 findings on a page
that had 30, including the `Healthy 18.5 – 24.9` band it was written to catch. It reads
`ownLayer(sources)` now, the same loader the build uses, which is the locale's own contribution with the
English underneath it removed; the same sweep prints 30 and reaches 0 when the translations land. A
related trap in the same loader: `localeSources(l)` took an *optional* `toolIds`, and a seventh caller
that omitted it could no longer read `hi.tools.json` / `zh.tools.json`, because accepting a bare map of
tool ids requires knowing which ids are real — so the list is resolved inside the loader (with a floor
of 40 ids, since a short list cannot classify anything) and no caller can forget it again.

Two more bugs, neither of them in a dictionary, both found by the same rendered-text comparison.
**`append(null)` prints the word "null"**: `el()` was written to drop a null child and eight panels used
that shape with the DOM's own `append()`, which converts null to the string "null" — so the same
expression was correct one line and visible garbage the next, in all 13 locales, in identical English on
every page (which is exactly why comparing locales against each other could not see it: the finding was
not "different from English", it was "not a word in any language"). `add()`/`fill()` restore `el()`'s
rule, `check:nullchildren` keeps new call sites out, and rule R5 of the rendered audit reports any page
that still does it — including the English one. **A dropdown can be dead without rendering any English**:
`select(Object.keys(PRESETS))` passed bare strings to a helper expecting `[value, label]` pairs, so the
regex tester's Examples menu took its label from the *second character* of each key and picked its
pattern from a lookup that could never hit — nine single letters where a visitor expected "Email", "URL",
"IPv4", in every locale, with a clean residual report and a green smoke, because nothing was mis-translated.
`select()` now treats a bare string as its own label, and the presets are `[id, label, pattern]` triples
with the labels keyed. The lesson: a rendered-text audit only sees text that is *on* the page; a widget
whose content is wrong-but-Latin, or a control that does nothing, needs a click, which is what the smoke
and the browser report are for.

## 2. Fixtures — `npm run check:fixtures`

`scripts/fixtures.mjs` writes small *real* files into `test-files/` (a 3-page PDF with a known
title, a 12-page one, an RGBA PNG with a drawn disc, a 1.2 s 440 Hz WAV). Nothing is downloaded;
every byte is generated.

`scripts/fixtures-check.mjs` then parses them back with pdf-lib and a hand-written chunk walker,
and prints e.g.

```
  sample-a.pdf   pages=3   title="ALPHA fixture"  bytes=2425  p1=420x560
  photo.png      sig=true  dims=240x160 depth=8 ct=6 pixels=153760 ok=true
  tone.wav       RIFF/WAVE fmt=1 ch=1 rate=44100 bits=16 dur=1.20s
```

That step exists because a tool that "works" on a broken fixture proves nothing.

`photo.jpg` and `clip.webm` cannot be made in Node (they need canvas and MediaRecorder) and are
listed as optional; the browser run below can seed them and they are kept afterwards.

## 3. Headless smoke — `npm run smoke`

`scripts/smoke.mjs` mounts every one of the 49 tools in jsdom with hand-written stubs for canvas,
Web Audio and the PDF stack, then clicks every button. It catches mount failures, uncaught
exceptions and buttons that only ever show an error note.

One run is one dictionary: `--locale` selects which `dist/_assets/dict.<l>.js` the pages mount with,
and `npm run smoke` asks for English. Twelve more dictionaries exist, and a translation can be perfect
as prose and still break a tool, so `npm run check:locales` (`scripts/smoke-all.mjs`) runs the same 49
mounts for every non-English locale — 588 in total, about a minute — and takes each child's exit code
as its verdict. That is what turned the `long`/`numeric` finding from a static rule into a caught bug:
with `"long":"lang"` in the German dictionary the age calculator stops mounting, 48/49, exit 1.

What it cannot do: prove a JPEG really decodes, that pdf.js renders a page, or that the browser
would accept the blob. Those are exactly what step 4 is for.

## 4. Real browser sweep

The sweep drives the actual tool code in Chrome, feeds it the real fixtures, and posts the
produced bytes back to Node so a script can parse them.

```
npm run dev                      # build + serve on http://127.0.0.1:5173
```

Then in the browser, on any tool page (DevTools console, or via a browser automation tool):

```js
const d = await import('/__script/drive.mjs');
await d.bustCache();                                  // see the warning below
const plan = await (await fetch('/__script/sweep-plan.json')).json();
d.startSweep(plan.tools, plan.results);               // returns at once, runs in the background
```

and in another terminal:

```
node scripts/browser-report.mjs            # human readable, as it goes
node scripts/browser-report.mjs --strict   # exit 1 unless every tool passed and finished
```

### What the driver does

`scripts/browser/drive.mjs` (plan in `scripts/browser/sweep-plan.json`)

1. `fetch('/__files/<fixture>')` → wrap in a real `File`;
2. hand it to the tool through a synthetic `DataTransfer` + `DragEvent('drop')` on `.drop` — the
   same code path a manual drag takes, and the only headlessly driveable one (the hidden
   `<input type=file>` cannot be given a file by script);
3. fill fields matched by their visible label (`set: { 'Page range': '1-2' }`) and paste text into
   the first textarea (`text`, or `@b64:photo-small.png` for a fixture as base64);
4. click the primary buttons (`.btn` without `.ghost`), wait for the button to re-enable — lib.js
   `run()` only restores it in its `finally` block — then click the download buttons that appeared;
5. intercept every `<a download>` click, read the blob and `POST /__save?name=…` so Node gets the
   exact bytes.

By default it mounts each tool into a scratch `<div>` through the same `/_assets/tools/*.js`
bundle the real page imports, which is the only way to sweep 49 tools inside one page load. It
preloads the tool's declared `needs` libraries first, the way `runtime.js` does. The price is that
this bypasses the page shell — so also drive a few tools on their real URL (call `run()` with no
`tool` key after navigating to the page) to prove the shell, routing and `data-libs` preload.

### Dev-only routes

They live in `dev-server.mjs`, not in `dist/`, so they never ship:

| route | purpose |
|---|---|
| `GET /__files` | which fixtures and captured outputs exist |
| `GET /__files/<name>` | the fixture bytes |
| `POST /__save?name=<file>` | store tool output bytes in `test-files/out/` |
| `GET /__script/<name>` | serve `scripts/browser/<name>` (driver, plan) |
| `GET /api/geo?country=DE` | pretend the visitor is in Germany (consent banner only) |
| `GET /__geo?country=DE` | same, as a cookie + redirect to `/`, which opens `/en/` |

### The cache trap

Production serves `/_assets/*` immutable for a year. If your browser ever saw that header it will
not re-request the file after a rebuild, and the sweep will test last week's code and report bugs
you already fixed. The dev server answers `no-store` for everything to stop this on reloads;
`await d.bustCache()` clears an entry that is already poisoned. When in doubt, run
`(await import('/_assets/lib.js')).downloadZip.toString()` and compare with the source.

### The throttled-tab trap

The browser tab nobody is looking at is a lie detector: it reports "slow tool" instead of "hidden
tab". Chrome clamps `setTimeout` in a hidden or occluded window to roughly one call every 300 ms,
and harder after five minutes. That matters twice — the driver's waits stretch out, and worse, pdf.js
paints in chunks that resume through `setTimeout(0)`, so a three-page raster job that takes seconds in
a visible tab took 171 s in a background one and first appeared as a timeout.

The driver does not fight this. An earlier version replaced its waits with MessageChannel yields
(which are not throttled) and it made things worse: the sweep's own spin loop competed with the tool's
chunked rendering, and `pdf-to-jpg` then never finished inside 120 s at all. Waits are ordinary
timers again.

What it does instead is measure: every row carries `throttleMs`, the real duration of a 50 ms timer
in that tab. `throttleMs` around 50 means the numbers are trustworthy. A few hundred means a
`timedOut` row is the environment, not the tool, and must be re-run with the window in the foreground
before you believe it. (Dedicated workers are not throttled — a `setTimeout` inside a worker answered
in 56 ms while the page needed 314 ms — which is why PDF parsing stays quick and only main-thread
painting crawls.)

### A result that goes nowhere

`image-to-gif` and `image-contrast-brightness` both passed every check a static review could make:
they mounted, the button worked, no error appeared, and the file was really encoded. They were also
both completely broken, because each one declared `const out = el('div', { class: 'out output-box' })`
and never appended `out` to the page — the animation was written into a node that no screen ever
showed, and the user saw a button that finishes and nothing else.

The driver now watches for it on every row. It wraps `append`/`prepend`/`appendChild`/`replaceChildren`
and remembers each `.out` element that was written to while detached, then reports the ones **still**
detached when the tool finished. The second half is what keeps it honest: every
`el('div', { class: 'out' }, …kids)` is detached while its children are being built, so "written
while detached" alone would flag half the site.

### Rendered numbers and rendered dates

Three more bugs of the same kind — invisible to any parser, obvious in the output text:

- `loan-calculator` reset its running totals every twelfth month to write a per-year table row, and
  then reused those zeroed variables for the summary: "Total interest −20,000.00 · 0.000× the amount"
  on a loan that costs 1,871.19. The summary and the table now keep separate counters, cross-checked
  against the closed-form amortisation total (21,871.19).
- `toLocaleDateString(undefined, …)` means "the visitor's browser language", so on a Chinese Windows
  the **English** age / date / timestamp tools printed `2026年12月7日星期一` while every label around
  it was translated. Dates now go through `locale()`, the site's language.
- Same defect, second face: every `toLocaleString(undefined)` and bare `toLocaleString()` in the
  calculators, in `lib.js` `bytes()`/`num()` and in the text tools printed English digit groups on
  the German and Spanish pages (`1,871.19` where a German expects `1.871,19`). All of them take
  `locale()` now. `hi` correctly gets Indian grouping (`2,75,232`) and no locale falls back to
  non-Latin digits, which is why the change is safe across all 13.
- `bmi-calculator` printed `Your BMI 23.52941176`, and the healthy-weight line said `53.5 undefined`
  after a rounding helper dropped the unit argument.

The lesson for the plan file: `expect: ['1,871.19']` asserts against text the browser actually
rendered. That is the only class of check that caught these.

### Reading a rerun

`node scripts/browser-report.mjs` with no `--file=` reads the newest `sweep-*.json` in
`test-files/out/` by its own `startedAt`, so a rerun cannot silently report the previous green.
`--file=sweep-run2.json` pins a specific run when you want to diff it against another.

### Batching: how 49 rows actually get run

One `startSweep(plan.tools)` in one hidden tab does not finish — see the throttled-tab trap above.
The working procedure is a slice per navigation, each into its own file:

```js
// once per batch, after navigate_page to http://127.0.0.1:5173/en/?noads=1
const p = await (await fetch('/__script/sweep-plan.json')).json();
const d = await import('/__script/drive.mjs?v=' + Date.now());   // fresh import = fresh driver code
d.startSweep(p.tools.slice(0, 6), 'sweep-b13.json');             // returns at once
```

then, in Node, after each file reports `done: true`:

```
npm run report:merge                                   # sweep-b*.json -> sweep-merged.json
node scripts/browser-report.mjs --file=sweep-merged.json --strict
```

`browser-merge` matches rows to plan slots and consumes each row once, so a slot with no row is
printed as `not run by any batch` and the merge exits 1 — a missing tool cannot disappear into a
green average. It also records `_from` per row and prints "slots answered by: …", because "49/49"
has to be attributable to *this* run and not to an old batch file that happened to be in the
directory. Files whose name contains `control` are never merged: they are deliberate failures.

### The real-URL pass, and why the sweep is not enough

The 49-row sweep mounts tools into a scratch `<div>`, which skips the page shell: no router, no nav,
no ad slots, no `data-libs` preload, and no locale dictionary other than the one the scratch page
loaded. So `scripts/browser/sweep-pages.json` is walked one page per navigation, calling
`startSweep([{ url: '/de/pdf/compress-pdf/', … }])` — a row without a `tool` key mounts into the
page's own `#tool-root`.

Two rules that came out of doing this badly:

- **Write expectations from what the page renders, never from what you think it should say.** Three
  rows in this file were wrong in exactly that way: a German row asking for `"Komprimieren"` (the
  tool's own panel says `Stufe`/`Herunterladen`; the headline word is not in the scanned region at
  all), a Spanish word count of `12` for a 14-word sentence, and a Chinese row asking for `"BMI"` on
  a page that renders `你的 BMI`. The honest procedure is: run the row once, read `output` in the
  result file, then write the expectation and say in `_why` where it came from.
- **An expectation must be able to fail.** `"14"` alone also matches the `1493% unique` on the same
  line, so the Spanish row asserts `"Words14"`. Same reason `check:widgets` and `check:locale` print
  how many comparisons they made.

What this pass found, twice: nine of thirteen locales were rendering the Indonesian headline
"Kompres PDF" (a shared-reference `deepMerge` in `build.mjs`), and eleven of thirteen were rendering
English field labels inside otherwise translated panels (the English widget table was merged *over*
the locale's own). Both shipped green through every check that existed at the time; both are now
static checks with counter-proofs, and the second one is why `drive.mjs` scans the panel's own text
for `expect`.

The rows as last run, each on its own navigation, against the current `dist/`
(`test-files/out/page-*.json`):

| row | file | what came back |
|---|---|---|
| `/en/pdf/compress-pdf/` | page-12 | 7,424-byte PDF, `Download` + `Level` in the panel |
| `/de/pdf/compress-pdf/` | page-11 | same 7,424 bytes, `Herunterladen` + `Stufe`, size rendered `7,3 KB` |
| `/zh/calc/bmi-calculator/` | page-05b | `你的 BMI 22.9`, healthy-weight `56.7 kg – 76.3 kg` |
| `/es/text/word-counter/` | page-06 | `Words14` for the 14-word test sentence |
| `/de/calc/loan-calculator/` | page-07 | `607,53` monthly, `21.871,19` total — comma and dot swapped versus the English run of the same tool |
| `/en/image/qr-code-generator/` | page-08 | 4,122-byte PNG + 6,081-byte SVG |
| `/en/pdf/pdf-to-jpg/` | page-09 | 95,189-byte zip of three JPEGs in 14.8 s, driven with `rafShim` |

The German row is the one worth reading closely: before the widget-layer fix it produced a correct
compressed PDF and a red note saying the panel had no download button, because the driver was looking
for the English word. One bug in the product and one in the harness, in the same row.

### The routing rows, run by hand

`sweep-pages.json` also carries a `routing` list, because these are redirect behaviours no
page-internal driver can see. The contract is now: the root `/` always opens the English home
`/en/`, whatever the cookie, IP, browser language or timezone; language changes only through the
header menu. What was observed live on the dev server (real browser navigations):

| step | result |
|---|---|
| `th_locale=zh` + `dev_country=CN` set, then `GET /` | lands on `/en/` — English h1 "Free Online Tools & Fast Browser Utilities", `htmlLang=en`, button "🌐 English"; both cookies present but ignored |
| `#btn-lang` → 中文 | writes `th_locale=zh`, navigates to `/zh/`; Chinese h1 "免费在线工具与快速浏览器实用工具", `htmlLang=zh-CN`, button "🌐 中文"; the menu ticks the current locale and lists all 13 |
| `th_locale=zh` still set, then `GET /` again | still `/en/` — the cookie is inert for routing now |
| `GET /__geo?country=DE` | sets `dev_country=DE`, redirects to `/`, still lands on `/en/`; `/api/geo` answers `{"country":"DE","note":"simulated by dev-server"}` and now feeds only the consent banner |
| production `GET /` | `vercel.json` permanent redirect (308) and `dist/_redirects` `/ /en/ 301`; asserted statically by `check-routing.mjs` R4/R5, since the dev server uses the client fallback in `router.js` |

Cookie attributes are read from `src/scripts/i18n.js` `writeCookie`: `path=/; max-age=365 days;
SameSite=Lax`, plus `Secure` under https. `document.cookie` cannot show them, so they are asserted by
reading the writer, not by sniffing the browser. Nothing reads `th_locale` to redirect any more —
the root is fixed and every in-site link is already locale-prefixed, so a manual choice persists by
URL rather than by an environment guess.

### requestAnimationFrame, or why one row needs a shim

`pdf-to-jpg` ran 261 s in a hidden tab and produced nothing. The cause is not the tool: pdf.js
3.11.174 paces its main-thread render loop with `requestAnimationFrame`
(`RenderTaskStream._scheduleNext()`), and a background tab is handed no frames at all, so
`page.render().promise` never settles. In a real browser this is correct behaviour — the render
pauses while the tab is hidden and resumes when you come back — so the fix belongs in the driver,
not the product. `run({ rafShim: true })` installs a 16 ms timer in place of `requestAnimationFrame`
for the duration of that row and puts the flag in the row's output, so a reader can see the row was
driven with help. It is opt-in per row (`sweep-plan.json` row 6 and the `pdf-to-jpg` page row) and
restored in the same `finally` block that restores `console.error`.

The evidence for "the shim, not luck": the same row, same fixture, same build — 95,189-byte zip in
13.2 s in the scratch host and 14.8 s on the real URL with `rafShim: true`; the pre-shim attempt
stayed at 0 bytes for 261 s, and a control attempt with the flag removed was still producing no row
after seven minutes (`test-files/out/page-10-control-noraf.json`, deliberately named `control` so the
merge refuses to count it). That is an observation of one hung run, not a measured timeout, so treat
the shim as "the frames were missing" rather than "the shim is proven necessary in every tab". What
is proven is the product behaviour: with frames supplied by any means, three pages rasterise to three
valid JPEGs with ink in them.

## Known gaps in coverage

- **The translations have not been read by a human.** Every one of the 1540 keys is supplied in all 13
  locales — chrome, the 810-label `w` table (54 authored in `<l>.json`, 666 in `10-w.json`, 44 result
  lines in `30-w-result.json`, 46 in `40-w-labels.json`) and the 575 `t` leaves — and the rendered-text
  audit reports 0 English strings per locale. What the gates can prove is *language and completeness*:
  that the value is in the right script, is not a copy of English, is not a two-word summary of a
  150-character sentence (`THIN`), still fits the SERP (`check:serp`) and does not crash the page
  (`check:locales`, `check:tokens`). None of them can tell a grammatical, correctly-scripted label from
  one a native tool would not have written — the Hindi timestamp note reads
  `आपकी वैल्यू अजीब हो (जैसे 0 या नेगेटिव तारीख़) तो ऊपर इकाई खुद चुनें।`, which is Devanagari, in the
  right order for the keys it came from, and not how a Hindi tool would phrase it; every rule stays
  green. `docs/TRANSLATION.md` §6 is where that limit is written down; it is the remaining work, and it
  is editorial rather than mechanical.
  (Until this segment the gap here was the opposite one: each locale authored 56 of 418 widget labels,
  so ~300 panel labels rendered English in a German page while coverage printed a healthy number. The
  `w` sweep, `check:widgets` and the `40-w-labels.json` batch closed it; `check:residual` is what stops
  it coming back.)
- **QR payload correctness is unverified.** The generator renders `29×29 modules · 296px · payload
  40 B` for a 40-byte URL and emits a 4,122-byte PNG plus a 6,081-byte SVG, so size, version and
  module count all line up — but there is no decoder in the site or the harness, so nothing here
  proves the modules actually encode the input. A phone camera is the missing check.
- **compress-video** — no video fixture exists, so it is untested. The implementation is written
  and the tool mounts, but nobody has watched it produce a file.
- **html-to-pdf** — its only action is `window.print()`, which blocks the tab and cannot be
  scripted. The sweep asserts the preview iframe renders; the print step needs a human.
- **iOS Safari / Android** — everything here ran on desktop Chrome. `showSaveFilePicker`, the
  clipboard write path and `MediaRecorder` behave differently on mobile and are unverified.
- **AdSense** — the slots, sizing and consent gating are checked only as markup; nothing here
  talks to Google.

## Manual checklist before publishing

1. Open `/de/pdf/compress-pdf/` in a normal window: with `ENABLE_ADS` off (the default) there is no ad
   DOM at all — no placeholder boxes; footer links work, no console errors.
2. Switch language with the picker, reload, confirm the cookie kept it (`th_locale`).
3. `/en/?noads=1` force-hides any live ad slots (when `ENABLE_ADS` is on) without breaking the grid.
4. Kill the network after the page loads (DevTools → offline) and try to reload the tool page.
   Today this **fails**: the site has no service worker, so the HTML is not cached. The badge on
   the home page ("Runs offline after first visit") is therefore not true yet — either add a small
   service worker or change that line in `src/locales/*.json` before launch.
5. Run one tool on a phone.
6. `node scripts/browser-report.mjs --strict` green.
