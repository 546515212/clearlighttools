# Translating the site

1540 English strings per locale, and the whole point of this file is that adding them never breaks a
page silently. Everything below runs locally; nothing is uploaded anywhere.

## 1. How a locale is assembled

`build.mjs`, `scripts/i18n-report.mjs`, `scripts/check-translations.mjs`,
`scripts/check-shard-parity.mjs`, `scripts/check-widget-labels.mjs` and
`scripts/check-residual-english.mjs` all read the same table —
`scripts/lib-locale-layers.mjs` — which
loads four kinds of layer, in this order, later winning a tie against English:

| layer | path | shape |
|---|---|---|
| chrome | `src/locales/<lang>.json` | the whole dictionary of interface copy: `nav`, `common`, `footer`, `legal`, `meta`, `ads`, `home`, plus its own `w` block |
| bulk | `src/locales/<lang>.tools.json` | `{ "w": … }`, `{ "t": … }`, or a bare map of tool ids — only `zh` and `hi` have one |
| shards | `src/locales/<lang>/*.json` | applied last, one file per batch, merged in filename order |
| headlines | `src/locales/titles.json` | `{ "<lang>": { "<tool-id>": "title" } }` — the cheap layer; the h1 follows the title |

A shard is one of three shapes, and nothing else:

```json
{ "w": { "lockRatio": "Verrouiller les proportions" } }
{ "t": { "merge-pdf": { "intro": "…" } } }
{ "c": { "common": { "free": "100 % gratuit" } } }
```

`w` is widget labels, `t` is tool copy (one object per tool id), `c` is chrome. A file that nests its
keys under any other name — `"tool"`, `"tools"`, `"widget"` — is rejected by the loader: the build
stops with the file name and the reason, and `check:translations` reports the same thing as a
`LAYER` finding. That is deliberate. A mis-shaped shard that *parsed* would contribute nothing, and
the locale would keep serving English while every number in the coverage report stayed exactly where
it was.

## 2. The loop

```
node scripts/translation-shard.mjs --locale fr                     # what is left, by layer
node scripts/translation-shard.mjs --locale fr --emit w --out src/locales/fr/10-w.json
node scripts/translation-shard.mjs --locale fr --emit t --category pdf --out src/locales/fr/20-t-pdf.json
# …replace the English values with French ones, keep every key where it is…
node scripts/check-translations.mjs --locale fr                    # shape, keys, placeholders, copies, thinness
node scripts/check-shard-parity.mjs --locale fr --layer w --strict --complete   # every asked key shipped?
node scripts/i18n-report.mjs --locale fr                           # coverage moved?
node build.mjs && npm run check:serp                               # do the descriptions still fit the SERP?
node build.mjs && npm run check                                    # the whole gate
```

`--emit` writes the structure and the English in it, and only the keys still missing — so a translator
(人或模型) changes values and cannot mistype a key. It refuses to overwrite an existing file without
`--force`, and refuses to write a skeleton that does not match the gap list.

`check-shard-parity.mjs` is the other half of that promise: it recomputes the same list and reports
what the shard did *not* ship. A paste that loses forty lines keeps every remaining key valid, so
`check:translations` stays clean and coverage simply dips; parity fails.

Because 666-key batches are too long for one careful pass by hand, the sweep is run as one delegated
job per locale (`--emit w` skeleton in, `10-w.json` out, both checks re-run by the same job). The
review afterwards is not "did it translate" — the checks say that — but "did the translator leave
anything that a checker cannot see": `IDENTICAL` only fires at three or more words, so a single-word
label copied from English passes every gate while still reading as a machine, and the two rules in §6
catch length rather than wording. What no gate can read is idiom, so the last pass over the rewritten
descriptions is a human skimming the locale in a browser.

Suggested numbering, so a category can be reverted on its own: `05-c.json`, `10-w.json`,
`20-t-pdf.json`, `21-t-image.json`, `22-t-text.json`, `23-t-calc.json`.

`test-files/w-skeleton.json` (666 keys) and `test-files/w-skeleton-zh.json` (302) are saved `--emit w`
outputs — the key list a batch of delegated translators works from, kept so a subagent is handed the
structure rather than asked to invent it. They are inputs to a translation pass, not fixtures any
check reads; `check-shard-parity.mjs` recomputes the same list from the loader instead.

## 3. What a translation has to keep

The checker enforces the first three; the rest is what makes a page look machine-made.

- `{0}`, `{1}` … — the arguments a tool interpolates. Order is free, the set is not: dropping one
  shows the visitor `{0}` on screen, adding one shows nothing at all.
- Literal markup and code — `<link rel="icon" href="favicon-32x32.png">`, `<p>`, `<br>`, `#rrggbb`,
  `rgb()`, `hsl()`, `UTF-8`, `data:image/…`. These are examples the visitor copies, not prose.
- `%` where the English computes a percentage (`{1}% of all words`). A bare `100% free` may become
  `完全無料` — the checker only looks at the interpolated form for exactly that reason.
- Names and tokens that stay English everywhere: `ClearLight Tools`, `PDF`, `JPG`, `WebP`, `Base64`, `QR`,
  `Wi-Fi`, `UTC`, `ISO 8601`, `WPA2`, `MD5`, `SHA-256`, `URL`, `Lorem Ipsum`, unit abbreviations
  (`px`, `ms`, `kHz`, `kcal`).
- Values that are *arguments to an API*, not text. `{ weekday: L('long', 'long') }` in the date
  calculator and the case-format demos (`lowercase`, `camelCase`, `aLtErNaTiNg`) look like labels and
  are not: `Intl` validates its option values, so `weekday: "largo"` throws
  `RangeError: Value largo out of range for Intl.DateTimeFormat options property weekday` and the
  whole panel dies. `check:tokens` reads those keys out of the tool sources and requires the built
  dictionary to hold the source's own fallback; `check:locales` runs the 78 tools in every locale and
  would catch the next one that is not an Intl option. Leave such values English — coverage already
  counts a supplied key as translated, and the value is not something the visitor reads.
- Hedging in the medical and financial copy. The calorie, BMI, age and discount disclaimers say "not
  a substitute for professional advice" in so many words on purpose; a fluent translation is allowed,
  a shorter and more confident one is not.
- Nothing else may be invented: no new keys, no restructured `steps` list, no FAQ rewritten as one
  paragraph. A string where English keeps a list, or an extra layer under a key that is a plain
  string, is reported as `TYPE` — those two mistakes render `[object Object]` on the page.

English is never deleted from `src/locales/en*.json` to make a locale pass; the English table is the
source every locale falls back to.

## 4. Strings that are English by design

`meta.dir` (`ltr`), `meta.titleSuffix` (`ClearLight Tools`), unit and codec tokens, filenames and download
names (`favicon.ico`), anything a browser wrote itself (`e.message` after a failed `JSON.parse`), and
the handful of dictionary values that are really API arguments or format demos (`w.long`,
`w.numeric`, `lowercase`, `camelCase`, `aLtErNaTiNg`). They stay English in every locale, and
`check:translations` ignores them: its copy-paste rule (`IDENTICAL`) only fires on strings with three
or more translatable words. For the API arguments that tolerance is deliberate, not an oversight —
`check:tokens` requires the English token back.

## 5. Where each locale stands

`node scripts/i18n-report.mjs` prints the table; `npm run build` prints the same numbers per locale;
`node scripts/translation-shard.mjs --locale <l>` lists what is left per layer. The 1540 English
leaves split three ways: **chrome 155**, **widget labels (`w`) 810**, **tool copy (`t`) 575**.

| locale | chrome | `w` | `t` | total (page-visible) |
|---|---|---|---|---|
| `zh` | 155 ✓ | 810 ✓ | 575 ✓ | 1540 (100 %) |
| `hi` | 155 ✓ | 810 ✓ | 575 ✓ | 1540 (100 %) |
| the other eleven | 155 ✓ | 810 ✓ | 501 ✓ + 74 from `titles.json` | 1540 (100 %) |

That is the end state of the sweep: one delegated job per locale per batch, each re-verified by
parity, the checker and a rebuild. `hi` reached 100 % twice — once by supplying the keys and once,
after the `THIN` finding below, by replacing the ones it had stubbed.

`check:translations` prints 1466 rather than 1540 for ten of those locales: it counts what a locale
*file* supplies, and 74 of the visible keys are the title + h1 that `titles.json` gives 37 tools at
build time. `zh` and `hi` print 1540 because their bulk files carry those titles themselves —
`hi.tools.json` now holds nothing else (see below).

- chrome is complete in all 13 locales, which is why a half-translated page still has a translated
  menu, footer, FAQ heading and legal text.
- `w` is one shared table of 810 labels, in four batches: 54 hand-authored ones inside `<lang>.json`,
  666 in `src/locales/<l>/10-w.json`, 44 result lines in `30-w-result.json`, and 46 in
  `40-w-labels.json` — the last one being the sweep that turned the strings still hardcoded in the
  panels into keys (BMI band chips, unit categories and base units, colour-harmony chips, regex
  presets and the sample sentence, duration words). `zh` puts its first 418 in `zh.tools.json` and 302
  in `10-w.json`; `hi` puts 54 in its bulk file. Every locale ships the same 46 in
  `40-w-labels.json`, and `check:parity` counts them.
- `t` is the 575 leaves of tool copy — title, h1, desc, intro, the `steps` list and the FAQ pairs —
  and it is now present in all 13 locales: real in `zh.tools.json`, and in
  `src/locales/<l>/{20,21,22,23}-t-{pdf,image,text,calc}.json` everywhere else (`hi` needed a second
  pass, `24`–`27`, for the 98 keys its bulk file had stubbed).

So the sweep order was `w` first — 666 labels × 11 locales from one shared key list — then `t`, per
locale, per category (`--emit t --category pdf|image|text|calc`), then the two result batches that the
rendered-text audit asked for. All are closed; what is left in translation is human review, described
next.

## 6. Three things "all keys supplied" does not mean

Coverage says a key has *a* value in the locale. It cannot say the value is a translation of the
English sentence, and it cannot say the sentence is usable where it is shown. Both gaps were found
after the `t` layer closed, and both are now gates.

**`THIN` — a supplied key is not necessarily a translation** (`check:translations`). `hi.tools.json`
answered 98 tool descriptions with a fragment of a clause while every other rule stayed green: the key
was real, the JSON was well-shaped, nothing was English, and coverage counted it. So the checker now
measures every sentence-shaped leaf (`.desc`, `.intro`, `.steps.N`, `.faq.N.q`) whose English is eight
words or more, and compares its length to *that locale's own median*, not to English — because a
compact language is honest at a third of English length (`zh` 0.30, `ja` 0.53) while a Romance locale
running at 1.15 is not asking for 1.15 of anything. A leaf under `min(45 %, median × 0.35)` is
reported as summarised rather than translated, and a locale whose median itself falls under 0.18 is
reported as stubbed all the way down. Fewer than 12 sentence leaves means the locale is not judged — a
partly translated locale is not a verdict. The medians printed by `--selftest` are the calibration
record: `zh 0.30, es 1.17, fr 1.23, de 1.18, pt 1.15, ja 0.53, ko 0.56, ru 1.11, vi 1.07, ms 1.12,
id 1.11, hi 1.08`.

**`check:serp` — a correct translation is not necessarily a usable one.** Google truncates a meta
description at roughly 160 characters, and Romance and Cyrillic translations of the English
descriptions inflate by 10–25 %, so 120 built pages shipped a sentence the search result would cut
off mid-clause. `scripts/check-desc-length.mjs` reads the shipped `<meta name="description">` out of
`dist/<l>/<cat>/<id>/index.html` — the built page, not the shard, because the page is what the crawler
sees — counts code points rather than UTF-16 units (a Devanagari string is one unit per character, an
emoji two), unescapes entities, and fails anything over 170 with notes between 160 and 170. Tightening
happened in the `desc` values only, in place, with `intro`/`steps`/`faq` left byte-identical; the whole
tree now peaks at 160 (`ms` 159, `id` 160, everyone else lower). The rule is a budget, not a target: a
description is a sentence, and dropping a clause is allowed where the clause was the least load-bearing
one — three were dropped across the seven locales that needed it.

**`check:residual` — 100 % coverage does not mean the page speaks the language.** Every rule above reads
a dictionary, and a dictionary read cannot see a string the code never asked `L()` for. Twelve locales
shipped `30 days 後`, a loan table headed `Paid in year`, `fails WCAG` and a password meter printing
`very strong` with coverage at 1450/1450, because those were template and array literals in the tool
bundles. `scripts/check-residual-english.mjs` therefore reads the other artefact: `smoke.mjs` dumps all
1005 text nodes of the 49 mounted panels per locale, and each dump is compared against the English one
tool by tool — same string, same string with only its numbers localised, English inside otherwise
translated text, an English value poured into a translated `{0}` sentence, and a rendered string that is
not a word in any language (`null`, `NaN`, `[object Object]`). A word the locale ships *anywhere*
(`Local` in es, `Unix` in ja) is not residue, and the 15 hand-written token rules in `KEEP_ENGLISH`
cover what must stay Latin — MIME types, `camelCase`, unit symbols. It reads the locale's own layer
(`ownLayer`), never `dist/_assets/dict.<l>.js`: the built file is English merged under the locale, so
using it as the suppression list hushes every untranslated key, which is exactly what the first version
did — 3 findings reported on a page that had 30. Closing the loop took 46 more keys in
`40-w-labels.json`; the audit now prints 0 for all twelve locales, and its probe panel plants both an
untranslated phrase and a literal `null` so that "0" cannot mean "stopped looking".
