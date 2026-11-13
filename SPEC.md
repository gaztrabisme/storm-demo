# Storm demo — specification

Reader: the agents who write the acceptance tests and build the app. Everything a test checks is named here. If something is not here, it is not required.

## 1. Purpose

A static web page in Vietnamese. It replays a past storm (Yagi, 2024) as if it were a forecast. An older, non-technical user should learn whether their place is in the simulated strong-wind zone, when, and where the official safety advice is. A tester runs sessions on it and exports what users did.

## 2. Stack and rules

- Vite + TypeScript + three.js, no UI framework, no web font (Arial / system sans), no runtime network requests. Every asset ships in `dist/`. Copy patterns from `~/Documents/Work/clients/usac/AstroSphere` (read-only; do not import from it): `vite.config.ts`, `tsconfig.json`, `src/i18n/index.ts`, `src/ui/storage.ts`, `src/ui/mode.ts`, `src/runtime/frameLoop.ts`, `src/scene/earth.ts`, `src/data/land.ts`, `src/guide/*`, `src/styles.css` tokens, `.github/workflows/deploy.yml`, `scripts/sw.template.js`.
- All user-facing text is in `src/i18n/vi.json`, read through `t(key, params)`. No user-facing English, except proper names (Yagi, GK-2A, GPS).
- `base: './'`. The entry JS is ≤ 90 kB gzip. three.js is loaded lazily in its own chunk.
- Storage only through versioned keys, prefix `stormdemo.`, wrapped in try/catch. The page works when storage throws.
- Every interactive target is ≥ 44 × 44 px. There is no horizontal scroll at 375 px width. Visible focus ring on every control. `prefers-reduced-motion: reduce` removes all animation and turns the camera flights into cuts.
- Nothing is drawn while the tab is hidden.
- Times are shown in Vietnam time (UTC+7), format `HH:mm, dd/MM`. Data times are UTC.

### 2.1 Not a warning (club plan, section 9.4; owner, 2026-11-13)
- The page must never read as an official warning. Every rule below is testable.
- **No red.** No element's computed `color`, `background-color` or `border-*-color` has an HSL hue in 330°–30° with saturation above 35% and alpha above 0.1. The map's storm drawing (track, marker, strong-wind area, labels) uses the neutral storm colour of DESIGN.md 3. The Usui-chan model's own textures are exempt.
- **No commands.** The words `sơ tán` and `khẩn cấp`, and the phrases `Bạn nên làm ngay` and `Vẫn nên theo dõi tin bão`, do not appear in any visible text, except inside the official advice quoted with its source: the `Làm gì khi bão tới?` card body and the `prepare` chip answer (10.3).
- **No unprompted messages.** Nothing pops up by itself. Usui-chan speaks only after the user taps her or a chip, or in onboarding.
- The only English on the page is the second half of the footer (6.1) and proper names.

## 3. Data

### 3.1 Storm track — `src/data/generated/yagi.json`

Built by `scripts/build-storm.mjs` from `../experiments/d1_track/work/ibtracs_last3years.csv` (IBTrACS v04r01). Use the rows with `NAME == "YAGI"` and `SEASON == 2024`, all of them (81 rows, 3-hourly, 2024-08-30 12:00 to 2024-09-09 12:00 UTC). The script writes this:

```json
{ "name": "Yagi", "season": 2024, "source": "IBTrACS v04r01",
  "points": [ { "t": "2024-09-05T00:00:00Z", "lat": 19.0, "lon": 115.8,
                "windKt": 130, "r34nm": { "ne": 0, "se": 0, "sw": 0, "nw": 0 } } ] }
```

- `windKt` is `USA_WIND`. `r34nm` is `USA_R34_NE/SE/SW/NW` in nautical miles.
- A blank wind becomes `null`. A blank radius becomes `null` for that quadrant.
- The script is deterministic: running it twice gives the same file, byte for byte.

### 3.2 Provinces — `src/data/provinces.json`

The 34 provincial-level units in force since 1 July 2025. One point per unit: the seat of its People's Committee.

```json
[ { "id": "ha-noi", "name": "Hà Nội", "fullName": "thành phố Hà Nội", "lat": 21.0283, "lon": 105.8544 } ]
```

- `name` is the bare name (no "tỉnh"/"thành phố"), except `TP. Hồ Chí Minh`, so it is not read as the person's name; it is what the UI shows everywhere. `fullName` keeps the prefix as the source gives it.
- All 34 have coordinates. The point is the seat building when one was found; otherwise it is the centre of the ward that contains the seat. Every point is cited in `web/SOURCES.md`.
- The points come from OpenStreetMap, so settings show the credit line `Tọa độ tỉnh: © những người đóng góp OpenStreetMap`.
- No province outlines in this demo: no boundary dataset with a clear licence was found.

### 3.3 Coast

Natural Earth coastlines (public domain). Use 10m for the Vietnam region and 110m for the rest of the globe.

## 4. Demo clock

- The page runs on a fixed simulated "now": **2024-09-05 00:00 UTC (07:00, 05/09 Vietnam time)**.
- Track points before now are drawn as a solid "đã đi qua" (past) line; points after now as a dashed "dự báo" (forecast) line.
- The verdict and timeline only consider times ≥ now.
- A label is always visible on the map: `Mô phỏng nghiên cứu – không phải cảnh báo · dựng lại từ bão Yagi (2024) · Bây giờ (mô phỏng): 07:00, 05/09`.

## 5. Verdict rule — `src/storm/verdict.ts` (pure functions, unit-tested)

1. Interpolate the track to 30-minute steps from now to the last point. Position: linear in lat/lon. Wind and each quadrant radius: linear; if either endpoint is `null`, the result is `null`.
2. At each step, take the great-circle distance d (km) from the place to the centre, and the bearing from the centre to the place. Quadrants: NE [0°, 90°), SE [90°, 180°), SW [180°, 270°), NW [270°, 360°).
3. The place is **inside** at that step when that quadrant's radius is not null and d ≤ radius × 1.852 km.
4. `verdict(place, track, now)` returns:
   - `affected`: inside at any step;
   - `firstInside`: the time of the first step inside, or null;
   - `lastInside`: the time of the last step inside, or null;
   - `closest`: `{ time, distanceKm }` of the smallest d;
   - `peakWindKt`: the largest wind while inside, or null.
5. `windLevel(kt)` returns the Vietnamese Beaufort level (cấp gió) 0–17: convert knots to m/s (× 0.514444), then find the level in the table of Decision 18/2021, Appendix III (SOURCES.md, "Beaufort table"; level n covers its lower bound up to the next level's lower bound). Above 61.2 m/s it returns 17. `null` in gives `null` out. No averaging-period conversion is applied; the UI marks every level as `(ước tính)` (estimate) and the wind card says why (section 10).
6. **What "inside" means in words.** The radius used is IBTrACS's 34-knot wind radius. 34 kt ≈ 17.5 m/s, which is level 8 on the table. So "inside" is said as `gió từ cấp 8 trở lên` (wind of level 8 or more), never as `gió mạnh`: Vietnamese bulletins use "vùng gió mạnh" for level 6 and above, which is a larger area that this data does not give.

`timeline(provinces, track, now)` returns every province sorted by `firstInside` (affected first, earliest first), then the unaffected ones sorted by `closest.distanceKm`.

## 6. Screens and states

Layout:
- **Phone (< 900 px):** a top bar, the globe in the top ~55% of the height, and a bottom panel that scrolls.
- **Desktop (≥ 900 px):** the globe on the left, a 420 px panel on the right.

Each listed element carries the `data-test` value given in brackets.

### 6.1 Top bar
- Title `Bản đồ bão` [`title`].
- `Nguồn dữ liệu` button [`btn-source`], which opens the satellite view (6.6).
- `Cài đặt` button [`btn-settings`], which opens settings (6.5).
- **Official bulletin block** [`official-bulletin`], directly under the top bar and above the map and panel, full width, in its own colour (DESIGN.md 3), visible in both modes and on every view except the satellite close-up. Text: `Bản tin chính thức: Trung tâm Dự báo khí tượng thủy văn quốc gia. Trang này sẽ đặt bản tin chính thức ở đây.` The centre's name is a link to `https://nchmf.gov.vn` with `target="_blank" rel="noopener"` (a link, not a request the page makes). It is a placeholder: no bulletin content.
- **Footer** [`disclaimer`], always visible at the bottom of the page or panel, small text: `Mô phỏng nghiên cứu – không phải cảnh báo. Research simulation – not a warning.`

### 6.2 Globe [`globe`]
- The three.js globe with coastlines, the track (past solid, forecast dashed) and a storm marker at the selected time [`storm-marker`]. In full mode, the place markers are labelled with province names.
- The demo label from section 4 [`demo-label`].
- **Track uncertainty circles:** three circles centred on the track position at now + 24 h, + 48 h and + 72 h. Their radii are 86, 148 and 217 km: the 2023 mean radii of JMA's 70% probability circles (SOURCES.md, `jma2023_prob_circle`). A small legend [`cone-legend`] reads `Vòng tròn: nơi tâm bão có thể đi qua`; the method (70%, JMA 2023 mean radii) is in the `Vùng gió mạnh là gì?` card (10.2). `window.__app.cone` is `[{ hours, lat, lon, radiusKm }]` for the three circles.
- The strong-wind area at the selected time is drawn as a filled shape around the marker, using the four quadrant radii.
- **The map view is fixed in both modes** (owner, 2026-11-12): no drag, no scroll or pinch zoom, no camera moves on the map. The view frames the whole track and all of Vietnam for the current layout (phone and desktop may differ). Only the satellite trip (6.7) moves the camera.
- **Full mode:** a time slider [`time-slider`] (a native `input type=range`) runs from the first point to the last in 3-hour steps, starts at now, and moves the storm marker. Beside it, the selected time [`time-readout`].
- **Easy mode:** no slider. The marker shows the storm at now.

### 6.3 Main panel
- The storm summary [`storm-summary`]: `Bây giờ ({time}): bão Yagi ở Biển Đông · sức gió cấp {n} (ước tính)`, where {time} is the demo now (`07:00, 05/09`) and {n} the level at now (130 kt → 17). It always describes now, never the slider time.
- The primary button `Nhà tôi có bị ảnh hưởng không?` [`btn-check`]:
  1. It asks for geolocation.
  2. **Granted:** use the coordinates, label the place `Vị trí của bạn` at the start of a sentence and on the map pin, and `vị trí của bạn` (lower case) inside a sentence.
  3. **Denied, failed, or no response in 8 s:** show the province picker [`province-picker`] (a native `select` of the 34 provinces) with the line `Không lấy được vị trí. Chọn tỉnh của bạn:`.
  4. Then (no camera move: the view is fixed) a pin [`place-pin`] marks the place, and the verdict card opens.
- **Verdict card** [`verdict`], with attribute `data-affected="true|false"`:
  - Affected: heading `Theo bản mô phỏng: {place} nằm trong vùng gió từ cấp 8 trở lên` [`verdict-head`]; line `Từ khoảng {firstInside} đến {lastInside}` [`verdict-when`]; `Sức gió mạnh nhất gần tâm bão: cấp {n} (ước tính)` [`verdict-wind`] from `peakWindKt`.
  - Not affected: heading `Theo bản mô phỏng: {place} nằm ngoài vùng gió từ cấp 8 trở lên` [`verdict-head`]; line `Tâm bão gần nhất cách {place} khoảng {km} km, lúc {time}` [`verdict-when`]; line `Nơi này vẫn có thể có gió cấp 6–7 và mưa lớn.` [`verdict-note`].
  - Both: no action list and no heading over actions. One link-styled button `Khuyến cáo phòng tránh bão của cơ quan chức năng` [`btn-advice`] opens the `Làm gì khi bão tới?` card (expanding `Tìm hiểu thêm` first in easy mode) and moves focus to its heading. It logs `learn_open` with `{ card: "prepare" }`.
  - The verdict uses the neutral storm colour for its left rule; no red (2.1).
  - The button `Chọn nơi khác` [`btn-recheck`] opens the province picker.
- **Timeline** [`timeline`] (full mode only): a list of provinces from `timeline()`, each row [`timeline-row`] showing the name and either `{firstInside} – {lastInside}` or `tâm bão cách {km} km`. The unaffected rows come under the sub-heading `Không có gió từ cấp 8 trở lên`. A row is affected when its `data-affected` is `true`. Tapping a row selects that province as the place.
- **Knowledge cards** [`learn`]: 3 cards, `Cấp gió là gì?`, `Vùng gió mạnh là gì?`, `Làm gì khi bão tới?`. Each card has a body and a source line [`learn-source`], all from SOURCES.md. In easy mode the cards are collapsed into one `Tìm hiểu thêm` disclosure.

### 6.4 Usui-chan [`assistant`]
- A 56 px portrait button [`assistant-avatar`] in the corner. Assets are copied from AstroSphere `src/assets/guide/usui-avatar.webp` and `usui-pose.webp`.
- **No warning pop-up** (2.1). Usui-chan never speaks unprompted; no `assistant-warning` element exists.
- **Tapping the avatar** opens the question sheet [`assistant-sheet`] with these chips [`chip`], each with `data-chip` set to its id:

  | id | Chip text | Action |
  |---|---|---|
  | `affected` | Nhà tôi có bị ảnh hưởng không? | runs the same flow as `btn-check` |
  | `when` | Khi nào bão tới chỗ tôi? | answers from the current verdict, or runs the check first |
  | `prepare` | Tôi cần chuẩn bị gì? | shows the 3 actions of 10.3 as the official advice, with the 10.3 source line under them |
  | `windlevel` | Cấp gió là gì? | shows the wind-level card text |
  | `radius` | Vùng gió mạnh là gì? | shows the radius card text |
  | `where` | Bão đang ở đâu? | highlights the storm marker (no camera move), answers with its position and time |
  | `source` | Dữ liệu này lấy từ đâu? | opens the satellite view |

  The answer text appears in the sheet [`assistant-answer`]. Voice: Usui-chan says "mình" to "bạn", at most two sentences, no emoji.
- Credit lines in settings [`credits`]: `Usui-chan, linh vật của CLB Thiên văn USAC`, `Đường đi bão: IBTrACS v04r01 (NOAA)`, `Đường bờ biển: Natural Earth`, `Tọa độ tỉnh: © những người đóng góp OpenStreetMap`.

### 6.5 Settings [`settings`]
- Dialog with:
  - Text size: `Vừa` / `Lớn` / `Rất lớn` [`set-text`, radios]. Root font size 16 / 20 / 24 px.
  - Theme: `Sáng` / `Tối` [`set-theme`]. The default follows `prefers-color-scheme`. Sets `data-theme` on `<html>`.
  - Mode: `Dễ dùng` / `Đầy đủ` [`set-mode`]. Default `Dễ dùng`.
- Choices are saved in `stormdemo.settings.v1`.
- `?mode=easy|full` overrides the mode for one page load and is not saved.
- Hidden export: the button `Xuất dữ liệu thử nghiệm` [`btn-export`] is visible only with `?test=1`.

### 6.6 First run [`onboarding`]
Shown when `stormdemo.settings.v1` is absent. Three steps. Steps 1 and 2 have `Tiếp` and `Bỏ qua`; step 3 has only `Bắt đầu`:
1. Text size, with a live preview.
2. Mode, with one line on each choice. The full-mode line is `Thêm thanh thời gian và danh sách các tỉnh.` (owner-approved 2026-11-13).
3. `Trang này có thể hỏi vị trí của bạn để biết bão có tới chỗ bạn không. Bạn có thể chọn tỉnh thay vì cho vị trí.`

Finishing or skipping saves the settings and never shows the onboarding again.

### 6.7 Satellite view [`satellite`]
- `btn-source` (or the `source` chip) flies the camera from the map to a close-up of the GK-2A model [`satellite-model`], placed at 0° latitude, 128.2° E, about 35,786 km above the surface. The flight takes 0.8–1.2 s out and the same back (owner: "much faster"); under reduced motion both are cuts.
- At the end the model fills about half of the view's shorter side, with Earth as a dim disc behind it and the dotted geostationary orbit through it.
- **The user can turn the model:** drag (mouse or one finger) orbits the camera around the model; scroll or pinch zooms between 0.6× and 2× of the arrival distance. A slow automatic turn runs while the user is not touching it, and stops under reduced motion. Keyboard: arrow keys turn the model when the view has focus.
- The model stays a pale-ink wireframe built in code: body box, AMI imager box, a small KSEM box, one solar wing of panels on a boom, a dish. Not to scale.
- **HUD** [`satellite-hud`]: a screen-space overlay in the same pale-ink line style: corner brackets around the view, and callout labels [`hud-label`] with fine leaders to anchor points on the model parts. The leaders follow the parts as the model turns; a label whose part faces away hides its leader. Labels are the strings of 10.6 only. Numbers in the HUD use a monospace system stack (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`).
- The info panel [`satellite-info`] has the facts of section 10.4 only, with the one source line at the end, plus the button `Quay lại bản đồ` [`btn-back`], which flies back to the map. Esc does the same.
- `window.__app.view` is `"map"` or `"satellite"`. `window.__app.satellite` exposes `{ yaw, pitch, zoom }` of the close-up camera.

### 6.8 Usui-chan animation
- The 56 px corner button [`assistant-avatar`] stays the static `usui-avatar.webp` portrait.
- Wherever Usui-chan speaks (the question sheet, onboarding step 1, the satellite view's first visit), a half-body Usui-chan [`assistant-figure`] is drawn from the club's model `usui-chan.glb` (copied from AstroSphere `public/models/`) in a small transparent canvas, about 120 px tall on phone and 160 px on desktop. Until it loads, or if WebGL fails, the `usui-pose.webp` image shows instead.
- Motion is a **library of reusable clips** built procedurally on the model's humanoid bones (`J_Bip_*`) and face shapes (`Fcl_*`), in `src/assistant/clips/`. Each clip is a pure function of time that returns bone rotations and face weights, so clips blend and are unit-testable:

  | Clip | What it does |
  |---|---|
  | `idle` | breathing, small sway, a blink every few seconds |
  | `hello` | one wave with the right hand, smile |
  | `talk` | mouth shapes cycling while text is appearing, small head motion |
  | `alert` | worried brows, hands drawn in, slight lean forward |
  | `point` | right arm points toward a screen direction given as a parameter |
  | `nod` | one nod |
  | `relief` | joyful eyes and smile, small bounce |
  | `think` | head tilt, hand toward chin |
  | `lookUp` | head and eyes up and to the side |

- Which clip plays where:

  | Context | Clips |
  |---|---|
  | onboarding step 1 | `hello`, then `idle` |
  | sheet opens | `hello` once per session, else `nod`, then `idle` |
  | chip `affected` / `when` with an affected answer | `alert` + `talk` |
  | same chips, unaffected answer | `relief` + `talk` |
  | chip `where` | `point` toward the storm marker + `talk` |
  | chips `prepare`, `windlevel`, `radius` | `nod` + `talk` |
  | chip `source`, satellite view first visit | `lookUp` + `talk` |
  | waiting for location | `think` |

- The current clip name is on the figure as `data-clip`.
- Under reduced motion, the figure holds a still neutral pose and never loops.
- Nothing is drawn while the figure is off screen or the tab is hidden. One render loop serves all figures.

## 7. Event log — `src/log/`

- Key `stormdemo.log.v1`. Each event: `{ session, t (ms since page open), type, data }`. The session is a random id made on page open.
- Types:
  - `open` with `{ mode, textSize, theme, width }`
  - `onboarding_done` / `onboarding_skip`
  - `check_start`
  - `geo_result` with `{ granted: boolean }`
  - `province_pick` with `{ id }`
  - `verdict_shown` with `{ affected, place, msSinceOpen }`
  - `assistant_open`
  - `chip` with `{ id }`
  - `setting` with `{ name, value }`
  - `slider` (throttled to one per 2 s)
  - `satellite_open`, `satellite_close`
  - `learn_open` with `{ card }`
- `btn-export` downloads `stormdemo-log-{session}.json` with all stored events, and a `Xóa dữ liệu` button [`btn-clear-log`] clears them.
- Nothing is sent over the network.

## 8. Test hooks (dev and `?test=1` only)

`window.__app` with:
- `view`
- `settings`
- `verdict` (the last result or null)
- `now` (ISO string)
- `cone` (section 6.2)
- `satellite` (section 6.7)
- `events()` (array)
- `ready` (a promise that resolves when the globe has drawn its first frame)
- `setPlace(lat, lon, label)`, which runs the verdict flow without geolocation.

## 9. Not in scope

Rainfall, landslide risk, voice, free-text chat, live data, accounts, analytics.

## 10. Approved content

Only the text below may state facts. It was signed off against the sources in `web/SOURCES.md` (ids in brackets). Put it in `vi.json` word for word. Each block ends with its source line, shown in small text.

### 10.1 Card "Cấp gió là gì?"
- `"Cấp gió" là bậc đo sức gió theo thang Bô-pho. Sức gió mạnh nhất của bão là tốc độ gió trung bình lớn nhất đo trong 2 phút.` [W1]
- `Áp thấp nhiệt đới: gió mạnh nhất cấp 6–7. Bão: từ cấp 8. Bão mạnh: cấp 10–11. Bão rất mạnh: cấp 12–15. Siêu bão: từ cấp 16 trở lên.` [W2]
- `Cấp 6–7 (39–61 km/giờ): cây cối rung chuyển, khó đi ngược gió. Cấp 8–9 (62–88 km/giờ): gãy cành cây, tốc mái nhà. Cấp 10–11 (89–117 km/giờ): đổ cây, đổ nhà, đổ cột điện. Từ cấp 12 (118 km/giờ trở lên): sức phá hoại cực kỳ lớn.` [W3]
- `Cấp gió trên trang này là ước tính: số liệu gốc của Mỹ tính gió trung bình trong 1 phút, còn Việt Nam tính trong 2 phút, nên cấp thật có thể thấp hơn một chút.` [b1, b2]
- Source line: `Nguồn: Quyết định 18/2021/QĐ-TTg; bản tin bão của Trung tâm Dự báo khí tượng thủy văn quốc gia; IBTrACS (NOAA).`

### 10.2 Card "Vùng gió mạnh là gì?"
- `Bản tin bão của Việt Nam gọi nơi có gió từ cấp 6 trở lên do bão gây ra là vùng gió mạnh.` [R1]
- `Trên bản đồ này, vùng tô màu quanh tâm bão là nơi có gió từ cấp 8 trở lên. Số liệu dùng ở đây không có vùng gió cấp 6, nên nơi ngoài vùng tô màu vẫn có thể có gió cấp 6–7.` [b2, SPEC 5.6]
- `Các vòng tròn cho biết nơi tâm bão có khoảng 70% khả năng đi vào sau 24, 48 và 72 giờ. Bản tin bão của Việt Nam cũng vẽ vòng tròn 70% như vậy.` [R2, jma2023_prob_circle]
- Source line: `Nguồn: Quyết định 18/2021/QĐ-TTg; Cơ quan Khí tượng Nhật Bản, báo cáo năm 2023; IBTrACS (NOAA).`

### 10.3 Card "Làm gì khi bão tới?" and the `prepare` chip
- The official advice shown by the `prepare` chip, in this order (not shown in the verdict card):
  1. `Cả nhà bàn trước chỗ trú ẩn an toàn nhất; khi chính quyền yêu cầu thì sơ tán ngay.` [B3]
  2. `Dự trữ đủ lương thực, nước uống, thuốc men và đồ dùng thiết yếu.` [B4]
  3. `Tuyệt đối không ra ngoài khi bão đang đổ bộ, trừ khi khẩn cấp và có hướng dẫn của chính quyền.` [D1]
- The card adds, under four headings:
  - `Trước bão`: `Theo dõi dự báo, cảnh báo và cập nhật diễn biến của bão để chủ động phòng tránh.` [B1, corrected wording], B2, B3, B4, B5, B6, B8.
  - `Giữ nhà`: H1, H2, H3, H4.
  - `Khi bão đổ bộ`: D1, D2.
  - `Sau bão`: A1, A2.
  All of these exactly as in SOURCES.md, Safety, Verified.
- Source line: `Nguồn: khuyến cáo của Cục Quản lý đê điều và Phòng, chống thiên tai (đăng trên Báo Luật sư Việt Nam); Cổng thông tin điện tử tỉnh Hà Tĩnh.`

### 10.4 Satellite panel
Heading `Vệ tinh GK-2A`, then these facts:
- `GK-2A là vệ tinh khí tượng của Hàn Quốc, phóng lên quỹ đạo vào tháng 12 năm 2018 và chính thức cung cấp dữ liệu từ ngày 25 tháng 7 năm 2019.` [F2, F4]
- F3, F5, F6, F7, F8, F9, F10, F11, as in SOURCES.md, GK-2A, Verified.
- `Hình vệ tinh trên màn hình chỉ là mô hình minh họa, không đúng tỉ lệ.` (own statement; nothing to cite)
- Source line: `Nguồn: Trung tâm Vệ tinh Khí tượng Quốc gia Hàn Quốc (NMSC), GK2A Fact Sheets; WMO OSCAR; Kim và cộng sự (2021), Remote Sensing.`

### 10.5 Usui-chan answers
- Each chip's answer is built only from 10.1–10.4 and the verdict.
- `where`: `Lúc {time}, tâm bão ở khoảng {lat}° Bắc, {lon}° Đông, sức gió cấp {n} (ước tính).`

### 10.6 Satellite HUD labels
- Header: `GK-2A · mô hình minh họa, không đúng tỉ lệ`
- `Quỹ đạo địa tĩnh · 128,2° Đông · cách mặt đất 35.786 km` [F3]
- on the AMI box: `AMI · 16 kênh ảnh` [F5]
- `Ảnh trọn đĩa Trái Đất: 10 phút một lần` [F6]
- `Độ phân giải: 0,5–2 km` [F7]
- on the KSEM box: `KSEM · theo dõi thời tiết vũ trụ` [F9]
- on the wing: `Tấm pin mặt trời`; on the dish: `Ăng-ten` (part names only, no claim)
