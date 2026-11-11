# Acceptance tests

These tests check the storm demo against `SPEC.md`. They were written before the app, by someone who does not build it.

## The tests are locked

No one edits, deletes or skips a test to make the app pass. If a test looks wrong, write down the test, the change you propose and the reason, and send it to the project owner. The test changes only after the owner says yes. Fix the app, not the test.

## Unit tests (vitest)

```bash
npx vitest run
```

| File | Checks |
|---|---|
| `unit/verdict.test.ts` | SPEC section 5: the inside test (d ≤ radius × 1.852 km), quadrant by bearing, null radius, 30-minute steps from now to the last point with linear position, wind and radius (null at either end of a segment for wind, at the end for radius), checked through `verdict()` results, only times ≥ now, `firstInside`, `lastInside`, `closest`, `peakWindKt`; `windLevel` from the Decision 18/2021 table (knots × 0.514444 → m/s; 33 kt → 7, 34 kt → 8, 130 kt → 17, above 61.2 m/s → 17, null → null, both sides of every level's lower bound, every whole knot 0–200) |
| `unit/timeline.test.ts` | SPEC section 5: `timeline()` order |
| `unit/i18n.test.ts` | SPEC sections 2 and 10: every string in `src/i18n/vi.json` is non-empty and has no common English UI words; no string literal with Vietnamese letters in `src/` code outside `src/i18n/` (comments are skipped); every approved string of section 10 (the three cards, the verdict actions, the satellite panel, the `where` answer), the 6.2 circle legend and the 6.4 credit lines is in it word for word |
| `unit/data.test.ts` | SPEC section 3: `yagi.json` (81 points, 3 hours apart, 2024-08-30 12:00 to 2024-09-09 12:00 UTC, every time written with `Z` or an offset, source `IBTrACS v04r01`, every value equal to the CSV's LAT, LON, USA_WIND and USA_R34_*, blanks as null); `scripts/build-storm.mjs` writes the same bytes twice; `provinces.json` (34 unique ids, the names exactly the 34 units named in the SOURCES.md rows `names-23-merged` and `names-11-unchanged`, each once, all with numeric lat and lon inside Vietnam's lat/lon box, `name` without a "tỉnh "/"thành phố " prefix except `TP. Hồ Chí Minh` (the only `TP.` name, on `ho-chi-minh`), `fullName` = bare name with that prefix when the source gives one, bare names and full names found in `web/SOURCES.md`, each entry's lat and lon written in its own SOURCES.md row `| {id} |`) |
| `unit/build.test.ts` | SPEC section 2: builds with `vite build` into `unit/.build-out/` (deleted after), then checks relative `./` paths in `index.html`, the start-up JS ≤ 90 kB gzip, three.js in its own lazily loaded chunk, and `usui-avatar` and `usui-pose` .webp files in the output |

`unit/ref.ts` holds the tests' own haversine, bearing and track builders. The unit tests use small made-up tracks, not the real data.

`content.mjs` holds the approved copy of SPEC sections 6 and 10, copied word for word, and the tests' own wind-level table. Items that section 10 names only by id (B2, H1, F3 and so on) are read from the Vietnamese column of `web/SOURCES.md`, from the `### Verified` table of the matching section (Safety or GK-2A) only. Both the unit tests and the UAT scripts use it.

How the tests call `src/storm/verdict.ts`:

- `verdict(place, track, now)`: `place` is `{ lat, lon }`; `track` has the shape of `yagi.json` (`{ name, season, source, points }`); `now` is a `Date`. SPEC does not fix the type of `now`; a `Date` also works for code that calls `new Date(now)` or `Date.parse(String(now))`.
- `timeline(provinces, track, now)` returns one row per province; a row is the verdict with the province's `id`, or `{ province, verdict }`.
- Times in results may be a `Date`, an ISO string or milliseconds.
- Distances are checked to within 1 %, so any usual Earth radius (6371–6378 km) passes.

## UAT (Playwright, headless Chromium)

Start the dev server, then run all areas:

```bash
npm run dev            # serves http://localhost:5195
node tests/uat/run-all.mjs
```

`UAT_URL` sets the page (default `http://localhost:5195/?test=1`). `UAT_READY_MS` sets how long to wait for `window.__app.ready` (default 20000). One area runs alone with `node tests/uat/<area>.mjs`.

Each script prints `PASS` or `FAIL` per check, then `N/M PASS`, and exits 1 if any check failed. `run-all.mjs` exits 1 if any area failed.

| Area | Checks |
|---|---|
| `onboarding.mjs` | first-run dialog, 3 steps, text-size preview, the size and mode chosen in it are kept, finish and skip both save and never show again |
| `check.mjs` | title, `Cài đặt`, storm summary with `sức gió cấp 17 (ước tính)`, the check button with location allowed (Hải Phòng affected, TP. Hồ Chí Minh not), `__app.verdict` for both equal to the tests' own SPEC 5 verdict on `yagi.json` (times ±30 min, distance ±1 %, wind ±1 kt), the new verdict headings, `verdict-wind` from `peakWindKt` on an affected card only, `verdict-note` on an unaffected card only, the 3 actions of SPEC 10.3 in order, `verdict-source` under them in small text (font size below the root font size), the pin inside the globe, location refused (picker within 3 s), location failing, no answer for 8 s, the province picker, the pin, `Chọn nơi khác` round trip, `geo_result` and `province_pick` events |
| `modes.mjs` | easy mode by default (`Dễ dùng` chosen in settings); full mode from settings (saved) and from `?mode=full` (not saved); `?mode=easy` over a saved `Đầy đủ` for one load (not saved); time slider and readout, the slider starting at now (44 steps), the storm marker inside the globe, moving with the slider in full mode and staying put in easy mode; drag and scroll change the globe in full mode and do not in easy mode (globe image compared, reduced motion); timeline order, row text and tapping a row, compared with the tests' own SPEC 5 rule on `yagi.json`; the 3 knowledge cards with their SPEC 10 text in order and their source lines, and the `Tìm hiểu thêm` disclosure; `learn-source` in small text; a `learn_open` event with `{ card }`; `__app.cone` (3 circles at now + 24/48/72 h, centred on the track position at that time, radii 86/148/217 km) and the `cone-legend` text, in easy and full mode; `slider` events at most one per 2 s |
| `settings.mjs` | the 4 credit lines in `credits` inside settings, text size 16/20/24 px as 3 radios, theme, saved across reload, theme follows `prefers-color-scheme` on first visit, `__app.settings` follows the choices (the same value each time `Lớn` is chosen, different from `Vừa`), every localStorage and sessionStorage key matches `stormdemo.<name>.v<N>`, page works when storage methods throw and when reading `localStorage` throws |
| `assistant.mjs` | Usui-chan portrait loads and sits in a corner, warning once per session and only when affected, Esc and ×, `setPlace` label and its verdict against the tests' own, the 7 question chips and what each answer must contain (`windlevel` and `radius`: each SPEC 10.1 / 10.2 line; `where` follows the SPEC 10.5 sentence: time, position and wind level at now in easy mode, and at the slider's time in full mode), voice (`mình` / `bạn`, no `tôi`) |
| `satellite.mjs` | satellite view opens and closes, the flight still moving 2.0–2.8 s after the click, the SPEC 10.4 heading, facts in order and exactly one source line after them, Esc, reduced motion is a cut, `btn-back` returns to the same globe view (image compared) |
| `log.mjs` | event log types and values (`open.theme` is the current theme, `open.textSize` follows the setting, one `setting` event per choice, `verdict_shown.place` as the label string or an object with that label), a new session id per page open, export file name and full content, clear (also in storage), no export button without `?test=1` |
| `layout.mjs` | 375×812 and 1440×900 in light and dark, with the onboarding, verdict, assistant sheet, settings, satellite view and full mode open: no horizontal scroll, every target at least 44×44 px; focus ring on every control reached by Tab; no web font; no English UI words on screen; demo label visible and not covered; phone and desktop split, also at 899 and 900 px wide; no running animation under reduced motion, the globe still by itself and the camera move to the place a cut; no WebGL draw call while the tab is hidden; screenshots in `uat/shots/` |
| `prod.mjs` | builds into `uat/.prod-build/` (deleted after), serves it with `vite preview` on port 4179 (`PROD_PORT`): no `window.__app` and no export button without `?test=1`, both present with it |

Every page these scripts open fails the run on an uncaught page error, on any request off the page's origin, on any method other than GET, on a beacon, and on a fetch or XHR carrying a query string (SPEC 2 and 7).

The scripts use only the `data-test` names, `window.__app` hooks and Vietnamese copy written in `SPEC.md`. `uat/lib.mjs` holds the shared helpers.

## How the scripts read the page

- `storm-marker`, `place-pin` and `satellite-model` carry `data-test` values in SPEC, so they are read as DOM elements positioned over the 3D object (an overlay or a stand-in). Their box on screen is what the tests measure.
- The approved texts of a block are read as its list items, or else its direct child elements: the safety actions in `verdict-actions`, and each knowledge card as the largest block under `learn` that holds one `learn-source`. Options in a radio group, a select or a button group are found by their label text.
- "The globe image" is a screenshot of the area of the largest visible canvas, with the warning pop-up masked. Two images are "the same" when fewer than 0.5 % of the pixels differ by more than 8 in a channel.
- The hidden tab is simulated: the test sets `document.hidden` to true and `document.visibilityState` to `"hidden"`, sends `visibilitychange`, and counts WebGL draw calls (`drawArrays`, `drawElements` and their instanced forms) for 1 s.

## Thresholds that are ours

SPEC gives no figure for these; the tests use their own:

- The province picker shows within 3 s after a refused or failed location (SPEC sets 8 s only for no answer).
- A cut under reduced motion is a change within 500 ms; for the camera move to the place, the globe is still from 500 ms after the verdict shows.
- The flight to the satellite is still moving 2.0–2.8 s after the click (from SPEC's 3–5 s; only the lower bound is checked).
- The avatar is "in the corner" when it is within 24 px of two edges of the viewport.
- "Small text" for a source line is a font size below the root font size.
- The pixel-comparison limits above (0.5 % of pixels, 8 per channel).

## Not checked automatically

- The strong-wind area drawn around the marker, the uncertainty circles themselves, and the past track drawn solid with the forecast dashed: WebGL drawing with no DOM element or hook in SPEC. Only `__app.cone` and the legend are checked.
- Natural Earth 10m coast for the Vietnam region and 110m for the rest (SPEC 3.3): SPEC names no file or hook for the coast data.
- Province-name labels on the place markers in full mode: SPEC gives them no `data-test`.
- Where the camera ends: the satellite at 0° N, 128.2° E about 35,786 km up, the camera about 42,000 km from Earth's centre, Vietnam visible, and the upper bound of the 3–5 s flight. SPEC gives no camera hook, and does not say the scene is still after the flight.
- That the camera is locked over Vietnam in easy mode is checked only as "drag and scroll do not change the globe image", not by position.
- Onboarding step 2, "one line on each choice": SPEC gives no wording, so only the two mode names are checked.
