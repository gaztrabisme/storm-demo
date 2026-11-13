# Visual direction

Reader: whoever restyles the page. SPEC.md still decides behaviour, copy and test hooks; this file decides how it looks. Nothing here may change text, `data-test` names, or what the locked tests check.

## 1. Where the reader is standing

**Light theme:** at a forecaster's desk, looking at a storm-track chart printed on warm paper: a fine latitude/longitude grid with degree labels at the edges, coastlines in thin ink, the storm's path plotted point by point with dates beside it, and handwritten-style notes pulled out to the open sea with fine leaders.

**Dark theme:** the same chart on a satellite operator's night screen: deep navy ground, pale marks, a single cool accent.

The map is the page. The panel reads like the chart's caption column, not a stack of app cards.

## 2. The composed field: the storm track as a sequence of glyphs

The track is the main exhibit. Each 6-hour track point is one glyph:

| Part | Encodes | How |
|---|---|---|
| position | where the centre was or will be | geography (lat/lon) |
| dot area | wind level (cấp) at that time | area ∝ level, from `windLevel()`; a missing wind is a hollow ring, never a zero |
| fill | past or forecast | past: solid ink; forecast: open ring |
| date label | time | every 24 h (00:00 UTC+7 not required; use the data times), small sans, beside the dot on the side away from the coast |

- The line joining the dots is thin: past solid, forecast dotted. No thick dashed yellow.
- At the selected time the strong-wind area is a pale translucent fill of the accent with a 1 px edge; its quadrant notches stay (they are the data).
- The three 70% circles are dotted hairlines, labelled "24 giờ", "48 giờ", "72 giờ" on their outer edge, small italic.
- The user's place: a small ink ring with a dot, its name in serif beside it. Not a cartoon pin.

**Entrance specimen (replaces the strip legend):** in the open sea at the lower right (desktop) or folded under the map (phone), one real glyph drawn with the chart's own functions and sizes, with fine leaders to italic notes: "Chấm: vị trí tâm bão, 6 giờ một lần", "Chấm càng to, gió càng mạnh (cấp 6 · 10 · 14 · 17 shown at true size)", "Vùng tô: gió từ cấp 8 trở lên", "Vòng chấm: tâm bão có khoảng 70% khả năng đi vào". All legend wording must use only words already approved in SPEC 10 or the existing `vi.json` strings; any new string goes to the owner first. If the specimen needs new strings, keep the existing legend text and draw the specimen beside it.

**Annotations on the map**, Fragapane style: two or three notes at most, set in open sea, each joined by a fine curved leader to a small outlined dot: the "now" position (time and level), and the user's place once a verdict exists. Notes reuse existing strings; numbers are generated from data.

## 3. Palette by layer

| Layer | Light | Dark |
|---|---|---|
| ground (sea) | warm paper `#F3F0EA` | navy `#0E1622` |
| land | `#E4DED3` | `#1A2433` |
| coast, graticule | ink `#3A3F47` at 0.6 px; graticule dotted, lighter | `#8A97A8` |
| ink (text, past track) | `#1F232A` | `#E8ECF1` |
| storm (neutral) | slate blue `#3E5671` | pale steel `#9DB2C9` |
| official bulletin | deep green `#2E6B57` | sea green `#7CC3A6` |
| wind area fill | storm at 18 % | storm at 22 % |
| muted text | `#5F646C` | `#A3ADBA` |

- No red anywhere (SPEC 2.1): the storm colour is neutral and the page has no alarm colour. The storm colour belongs to the storm; the green belongs only to the official-bulletin block (a 4 px left rule, its label and its link).
- The storm colour is used only for the storm. Buttons are ink: the primary button is ink-filled with paper text; secondary buttons are 1 px ink outline, square corners.
- Verdict card: a 4 px storm-colour rule on the left; the heading in ink. No severity colour.
- Check every text/background pair ≥ 4.5:1 (the tests measure `verdict-head` and `storm-summary`).

## 4. Type

- No web fonts (SPEC 2). Two stacks only:
  - serif for the title, the verdict heading, place names on the map, and card headings: `"Noto Serif", Georgia, "Times New Roman", serif`;
  - sans for everything else: `system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`.
- Verdict heading: serif, the largest text on the page after the title. Map labels: small sans; legend notes: italic sans.
- Weight and italic separate levels; no ALL CAPS blocks.

## 5. Structure

- Square corners, no shadows, no card boxes. Separate panel sections with 1 px hairlines and space.
- Labels on the map have no background boxes; if a label crosses a line, give it a 2 px halo in the ground colour.
- The demo label sits top-left as a small italic line with a hairline under it, not a dark pill.
- Usui-chan's portrait stays 56 px; the question sheet is paper with a 1 px ink edge, no shadow.
- Official-bulletin block: one line under the top bar, paper ground, 4 px green rule on the left, the centre name as an underlined link. Footer disclaimer: small muted text, one line on desktop.
- Satellite view: dark ground in both themes (it is space), a dotted reference circle for the geostationary orbit labelled "35.786 km" from SOURCES F3, the model in pale ink.

## 6. Must not break

44 px targets, no horizontal scroll at 375 px, focus ring visible on both grounds, reduced motion, nothing drawn when hidden, every `data-test` element still present and visible where the tests expect it, theme background must differ between light and dark, small text (`verdict-source`, `learn-source`) smaller than the root size.
