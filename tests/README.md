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
| `unit/i18n.test.ts` | SPEC sections 2 and 10: every string in `src/i18n/vi.json` is non-empty and has no common English UI words; no string literal with Vietnamese letters in `src/` code outside `src/i18n/` (comments are skipped); every approved string of section 10 (the three cards, the verdict actions, the satellite panel, the `where` answer, the 10.6 HUD labels), the 6.2 circle legend, the 6.4 credit lines, and the 6.3 storm-summary and verdict-wind templates are in it word for word |
| `unit/data.test.ts` | SPEC section 3: `yagi.json` (81 points, 3 hours apart, 2024-08-30 12:00 to 2024-09-09 12:00 UTC, every time written with `Z` or an offset, source `IBTrACS v04r01`, every value equal to the CSV's LAT, LON, USA_WIND and USA_R34_*, blanks as null); `scripts/build-storm.mjs` writes the same bytes twice; `provinces.json` (34 unique ids, the names exactly the 34 units named in the SOURCES.md rows `names-23-merged` and `names-11-unchanged`, each once, all with numeric lat and lon inside Vietnam's lat/lon box, `name` without a "tỉnh "/"thành phố " prefix except `TP. Hồ Chí Minh` (the only `TP.` name, on `ho-chi-minh`), `fullName` = bare name with that prefix when the source gives one, bare names and full names found in `web/SOURCES.md`, each entry's lat and lon written in its own SOURCES.md row `| {id} |`) |
| `unit/build.test.ts` | SPEC section 2: builds with `vite build` into `unit/.build-out/` (deleted after), then checks relative `./` paths in `index.html`, the start-up JS ≤ 90 kB gzip, three.js in its own lazily loaded chunk, `usui-avatar` and `usui-pose` .webp files and the `usui-chan` .glb model in the output |
| `unit/clips.test.ts` | SPEC 6.8: the 9 clips (`idle`, `hello`, `talk`, `alert`, `point`, `nod`, `relief`, `think`, `lookUp`) are exported from `src/assistant/clips/`; each returns finite bone rotations (`J_Bip_*`) and face weights (`Fcl_*`, in [0, 1]) for t in [0, 10] s, gives the same result for the same t, also when the times are asked forward, backward or shuffled with calls to other clips in between, and moves; every bone and face-shape name a clip returns exists in `usui-chan.glb` (read from the file in `web/`); every two clips differ; one check per clip from the 6.8 table (`talk` mouth cycling, `idle` blink, `hello` smile, `alert` brows, `relief` joy, `think` head tilt and hand, `lookUp` head turn); `idle` keeps moving with the same range 10 minutes in; `hello` and `nod` do their move in the first 4 s and stay near neutral from 5 s to 10 s; `point` gives different right-arm poses for opposite directions and holds its aim from 2 s to 5 s |

`unit/ref.ts` holds the tests' own haversine, bearing and track builders. The unit tests use small made-up tracks, not the real data.

`content.mjs` holds the approved copy of SPEC sections 6 and 10, copied word for word, and the tests' own wind-level table. Items that section 10 names only by id (B2, H1, F3 and so on) are read from the Vietnamese column of `web/SOURCES.md`, from the `### Verified` table of the matching section (Safety or GK-2A) only. Both the unit tests and the UAT scripts use it.

How the tests read the clip library (SPEC 6.8 names the folder, not the API):

- Every `.ts`/`.js` file in `src/assistant/clips/` is imported. A clip is a named export with the clip's name, the default export of a file named after it, or a property with its name on an exported object. It is a function `(t, param?)`, or an object with a `sample`, `at`, `evaluate` or `pose` method. `t` is in seconds.
- In a result, any key starting with `J_Bip_` is a bone rotation (Euler `[x, y, z]` / `{x, y, z}` in radians, or a quaternion `[x, y, z, w]` / `{x, y, z, w}`), and any key starting with `Fcl_` is a face weight. Keys may nest (`{ bones, face }` or flat); a `Map` counts as an object.
- The `point` direction is tried as `{ x, y }`, `[x, y]`, an angle in radians, `{ direction: { x, y } }` and `{ dir: { x, y } }`, in that order; the first form the clip answers to is used.
- "Neutral" is the rest pose or the clip's own pose at t = 0, because SPEC does not say whether clips return offsets or whole poses.
- The model's names are every string starting `J_Bip_` or `Fcl_` in the glTF JSON of the first `usui-chan*.glb` found under `web/` (`public/` and `src/` first; `node_modules`, `dist`, `.git` and `tests` skipped).
- Face shapes in the per-clip checks are matched by the model's own prefixes: mouth `Fcl_MTH_`, eye close `Fcl_EYE_Close`, brows `Fcl_BRW_`, joy `Fcl_*Joy*`, smile `Fcl_*Joy*`, `*Fun*` or `*Smile*`.
- `CLIPS_DIR=<folder>` and `MODEL_GLB=<file>` point the test at another folder and model; they exist only to check the tests themselves against a stand-in library.

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
| `onboarding.mjs` | first-run dialog, 3 steps (step 3 has only `Bắt đầu`), text-size preview, the size and mode chosen in it are kept, finish and skip both save and never show again, the size chosen on step 1 is kept when skipping at step 2 |
| `check.mjs` | `__app.ready` resolves only after WebGL draw calls (the globe's first frame); `__app.now` is an ISO string; title, `Cài đặt`, storm summary `Bây giờ (07:00, 05/09): bão Yagi ở Biển Đông · sức gió cấp 17 (ước tính)`, the check button with location allowed (Hải Phòng affected, TP. Hồ Chí Minh not), `__app.verdict` for both equal to the tests' own SPEC 5 verdict on `yagi.json` (times ±30 min, distance ±1 %, wind ±1 kt), the verdict headings with `vị trí của bạn` in lower case inside a sentence and `Vị trí của bạn` at its start, `verdict-wind` (`Sức gió mạnh nhất gần tâm bão: cấp {n} (ước tính)`) from `peakWindKt` on an affected card only, `verdict-note` on an unaffected card only, the 3 actions of SPEC 10.3 in order, `verdict-source` under them in small text (font size below the root font size), the pin inside the globe and labelled `Vị trí của bạn`, no camera move after the verdict (storm marker in the same place), location refused (picker within 3 s), location failing, no answer for 8 s, the province picker, the pin, `Chọn nơi khác` round trip, `geo_result` and `province_pick` events |
| `modes.mjs` | easy mode by default (`Dễ dùng` chosen in settings); full mode from settings (saved) and from `?mode=full` (not saved); `?mode=easy` over a saved `Đầy đủ` for one load (not saved); time slider and readout, the slider starting at now (44 steps), the storm marker inside the globe, moving with the slider in full mode and staying put in easy mode; `storm-summary` still describing now with the slider at the end; drag and scroll change neither the globe image nor the marker's place in either mode (reduced motion); the fixed view frames the track (marker inside the globe at the first and last point) and Vietnam (pin inside the globe at its four extreme points, our test points), phone and desktop; timeline order, row text (`tâm bão cách {km} km`), the sub-heading `Không có gió từ cấp 8 trở lên` between the affected and unaffected rows, and tapping a row, compared with the tests' own SPEC 5 rule on `yagi.json`, and tapping an unaffected row (unaffected verdict for that province); the storm marker at the selected time's track position (a pin placed there with `setPlace` at now, now + 24 h and the last point in full mode, at now in easy mode); a pinch on the map on a phone changes neither the image nor the marker; the 3 knowledge cards with their SPEC 10 text in order and their source lines, and the `Tìm hiểu thêm` disclosure; `learn-source` in small text; a `learn_open` event with `{ card }`; `__app.cone` (3 circles at now + 24/48/72 h, centred on the track position at that time, radii 86/148/217 km) and the `cone-legend` text, in easy and full mode; `slider` events at most one per 2 s |
| `settings.mjs` | the 4 credit lines in `credits` inside settings, text size 16/20/24 px as 3 radios, theme, saved across reload, theme follows `prefers-color-scheme` on first visit, `__app.settings` follows the choices (the same value each time `Lớn` is chosen, different from `Vừa`), every localStorage and sessionStorage key matches `stormdemo.<name>.v<N>`, page works when storage methods throw and when reading `localStorage` throws |
| `assistant.mjs` | Usui-chan portrait loads and sits in a corner, warning once per session (again on a new page open in the same browser) and only when affected, Esc and ×, `setPlace` label and its verdict against the tests' own, the 7 question chips and what each answer must contain (`prepare`: the 3 SPEC 10.3 actions; `windlevel` and `radius`: each SPEC 10.1 / 10.2 line; for these three, nothing besides the approved lines but a short joining phrase; `where` follows the SPEC 10.5 sentence: time, position and wind level at now in easy mode, and at the slider's time in full mode; `when` for an unaffected place: no time window, any time or km is the closest approach; `affected` with location refused shows the province picker), voice (`mình` / `bạn`, no `tôi`) |
| `satellite.mjs` | the flights out and back last 0.8–1.2 s (still moving in a stretch starting 0.6–0.8 s after the click, still from 1.3 s to 2.5 s, `__app.view` changed within 1.25 s); the model fills about half of the view's shorter side; `__app.satellite` `{ yaw, pitch, zoom }`, zoom 1 on arrival; the slow automatic turn with motion allowed, stopped while the mouse is held down on the view, and none under reduced motion; mouse drag turns (yaw, pitch) and changes the picture; scroll stops at the 0.6×–2× limits and the model's size on screen changes about 3.3× between them; Tab reaches the view and arrow keys turn it; one-finger drag and pinch on a phone; `satellite-hud` with the 10.6 header and exactly the 10.6 `hud-label`s and no other text, numbers (GK-2A aside) in the monospace stack; part-label leaders end inside the model's box, point at different places, move with the parts under drag and under the automatic turn, and come back when the model is turned back; over a full turn each of the four part labels has a leader at some yaw, and the AMI and dish leaders are hidden at some yaw; the SPEC 10.4 heading, facts in order and exactly one source line after them, in small text, and nothing else in the panel; Esc; reduced motion is a cut; `btn-back` returns to the same map view (image compared) |
| `figure.mjs` | SPEC 6.8: the `assistant-figure` and its `data-clip` in each context of the 6.8 table (onboarding step 1, warning, sheet first and later opens, the chips with affected and unaffected answers, `where`, `source` and the satellite view's first visit, waiting for location), back to `idle` where the table says so; no `lookUp` on a second satellite visit; the page fetches `usui-chan.glb`; with motion allowed the figure image changes; the corner avatar stays the static portrait; the figure about 120 px tall on phone and 160 px on desktop (sheet, warning, onboarding step 1); under reduced motion `data-clip` and the figure image stay still; `usui-pose.webp` shows when the `.glb` cannot load, and while it is still loading, then a canvas replaces it; no drawing outside the globe while no figure is on screen, and none at all with the tab hidden |
| `log.mjs` | event log types and values (`open.theme` is the current theme, `open.textSize` follows the setting, one `setting` event per choice, `verdict_shown.place` as the label string or an object with that label), a new session id per page open, export file name and full content, clear (also in storage), no export button without `?test=1` |
| `layout.mjs` | 375×812 and 1440×900 in light and dark, with the onboarding, verdict, assistant sheet, settings, satellite view and full mode open: no horizontal scroll, every target at least 44×44 px; focus ring on every control reached by Tab; no web font; no English UI words on screen; demo label visible and not covered; phone and desktop split, also at 899 and 900 px wide; no running animation under reduced motion, the globe still by itself and no camera move after a verdict; no WebGL draw call while the tab is hidden; screenshots in `uat/shots/` |
| `prod.mjs` | builds into `uat/.prod-build/` (deleted after), serves it with `vite preview` on port 4179 (`PROD_PORT`): no `window.__app` and no export button without `?test=1`, both present with it |

Every page these scripts open fails the run on an uncaught page error, on any request off the page's origin, on any method other than GET, on a beacon, and on a fetch or XHR carrying a query string (SPEC 2 and 7).

The scripts use only the `data-test` names, `window.__app` hooks and Vietnamese copy written in `SPEC.md`. `uat/lib.mjs` holds the shared helpers.

## How the scripts read the page

- `storm-marker`, `place-pin` and `satellite-model` carry `data-test` values in SPEC, so they are read as DOM elements positioned over the 3D object (an overlay or a stand-in). Their box on screen is what the tests measure. "No camera move" is checked as the `storm-marker` box staying within 1 px.
- The HUD leaders have no `data-test` in SPEC. The tests read them as the visible SVG `line`, `polyline` and `path` elements inside `satellite-hud`: a line with one end within 12 px of a part label's box (AMI, KSEM, wing, dish) is that label's leader, and its other end is the anchor on the model. A line with both ends within 40 px of one corner of the view is a corner bracket and is left out. A leader drawn on the canvas cannot be seen by the tests.
- A full turn of the model is made of 40 px sideways mouse drags (up to 150) until yaw has turned 360°.
- "Tab reaches the view": Tab, pressed up to 40 times, puts focus on `[satellite]` or a non-control element inside it (not a button, link or form field).
- `__app.ready` is checked by an init script that hooks `window.__app` as the app sets it and reads the WebGL draw-call count when `ready` resolves.
- `data-clip` is read from every visible `assistant-figure` every 40 ms. A value may hold two clip names ("alert talk", "alert+talk"); any non-letter separates them. Before each chip the test waits (up to 8 s) for `idle`, so the chip's clip shows as a change.
- A pinch and a one-finger drag are sent as touch events through the Chrome DevTools protocol.
- "Drawn outside the globe" counts WebGL draw calls on every canvas except the largest one on the page, including canvases not in the page (`OffscreenCanvas`).
- The approved texts of a block are read as its list items, or else its direct child elements: the safety actions in `verdict-actions`, and each knowledge card as the largest block under `learn` that holds one `learn-source`. Options in a radio group, a select or a button group are found by their label text.
- "The globe image" is a screenshot of the area of the largest visible canvas, with the warning pop-up masked. Two images are "the same" when fewer than 0.5 % of the pixels differ by more than 8 in a channel.
- The hidden tab is simulated: the test sets `document.hidden` to true and `document.visibilityState` to `"hidden"`, sends `visibilitychange`, and counts WebGL draw calls (`drawArrays`, `drawElements` and their instanced forms) for 1 s.

## Thresholds that are ours

SPEC gives no figure for these; the tests use their own:

- The province picker shows within 3 s after a refused or failed location (SPEC sets 8 s only for no answer).
- A cut under reduced motion is a change within 500 ms.
- Flight timing (SPEC: 0.8–1.2 s): the page copies the largest canvas into a 160 × 120 picture every 100 ms (or later when busy; WebGL canvases are made with `preserveDrawingBuffer` for this). "Flying" is more than 2 % of those pixels changing by more than 8 in a channel between two copies. The camera must be flying in some stretch that starts 450–750 ms after the click, and in no stretch that starts from 1300 ms up to 2500 ms. `__app.view` must change within 1.25 s.
- "Fills about half of the shorter side": the model's larger side is 35–70 % of the view's shorter side.
- `__app.satellite.zoom` is 1 on arrival (within 0.01), and at the limits is 0.6 and 2 (distance) or 0.5 and 1/0.6 (magnification), within 0.02. The model's size on screen at one limit is 2.6–4.2 times its size at the other (2 / 0.6 = 3.3).
- Any change of `yaw`, `pitch` or `zoom` above 0.001 counts as a change.
- A leader "ends inside the model's box" with an 8 px margin; a leader "moves with its part" when its end moves more than 2 px: every anchor after a yaw turn of 30° or more plus a pitch turn, and at least one anchor after the automatic turn has moved yaw 10°. Anchors on arrival are pairwise more than 10 px apart. After 5 × ArrowRight then 5 × ArrowLeft, yaw is back within 0.001 and each anchor within 2 px.
- Holding the mouse down on the view stops the automatic turn: yaw changes by 0.001 or less from 300 ms to 1300 ms after the press.
- The storm marker at the track position: its centre inside the box of a pin placed at that position (8 px margin), and the same marker-to-pin offset at each time within 4 px.
- The figure is animated: more than 0.5 % of its pixels change in at least one of four 1 s windows. The `.glb` is held back for the "until it loads" check; the canvas must replace the image within 8 s after it is let through.
- A chip answer adds nothing beyond the approved lines when the rest has no digit and at most 15 words.
- Usui-chan's clip for a context shows within 3 s of the action; "then idle" is within 10 s. The figure's height is within 25 % of 120 px (phone) or 160 px (desktop).
- Vietnam's four extreme points used for framing: 23.39 N 105.32 E, 8.56 N 104.82 E, 12.65 N 109.46 E, 22.40 N 102.14 E.
- Clip unit tests: "near neutral" is every bone within 3° and every face weight within 0.05, at t = 10 s and at every sample from 5 s to 10 s ("one wave", "one nod"); `hello` turns a right-arm bone at least 20° and `nod` the head or neck at least 5° in the first 4 s; `point` reaches its aim by t = 2 s, where opposite directions differ by at least 10°, and its right arm stays within 3° of that pose until 5 s; `idle`'s range 600–610 s is 0.5–2 times its range 0–10 s; two clips are different when, at some t in [0, 10] s, a bone differs by 5° or a face weight by 0.2; `talk`: a mouth weight rises above 0.3 and falls below 0.1 at least twice in 3 s; `idle`: an eye-close weight above 0.5 once in 10 s; `hello`: a smile weight above 0.2; `alert`: a brow weight above 0.3; `relief`: a joy weight above 0.3; `think`: head at least 5° and a hand or lower arm at least 20°; `lookUp`: head at least 5°. Turns are measured from the clip's t = 0 pose.
- The avatar is "in the corner" when it is within 24 px of two edges of the viewport.
- "Small text" for a source line is a font size below the root font size.
- The pixel-comparison limits above (0.5 % of pixels, 8 per channel).

## Not checked automatically

- The strong-wind area drawn around the marker, the uncertainty circles themselves, and the past track drawn solid with the forecast dashed: WebGL drawing with no DOM element or hook in SPEC. Only `__app.cone` and the legend are checked.
- Natural Earth 10m coast for the Vietnam region and 110m for the rest (SPEC 3.3): SPEC names no file or hook for the coast data.
- Province-name labels on the place markers in full mode: SPEC gives them no `data-test`.
- The satellite's place (0° N, 128.2° E, about 35,786 km up), Earth as a dim disc behind it and the dotted orbit: SPEC gives no hook for them.
- The pale-ink wireframe, its parts, and the HUD's corner brackets: drawn with no `data-test`.
- Which part faces away at a given yaw: no hook says so. The tests check only that the AMI and dish leaders are hidden at some yaw of a full turn (both parts face one way, toward Earth) and shown at another.
- That `point` aims at the storm marker on screen, and that it points to the side asked for and not the mirror side (that needs the rig's kinematics), and the look of each clip beyond the unit checks: the tests check only `data-clip` in the page.
- That `lookUp` turns the head up (pitch) rather than in another direction: the clip test checks a head turn of 5° or more.
- The `usui-pose.webp` image when WebGL fails: making WebGL fail would also stop the globe, so only a failed or slow `.glb` is tested.
- The still neutral pose under reduced motion: SPEC gives no `data-clip` value for it, so only "does not change" is checked.
- That a leader ends at its own part rather than another part: no hook gives the parts' points on screen.
- That the `where` chip highlights the storm marker: SPEC gives no hook for the highlight.
- That one render loop serves all figures.
- Onboarding step 2, "one line on each choice": SPEC gives no wording, so only the two mode names are checked.
