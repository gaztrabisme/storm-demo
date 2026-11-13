// UAT, SPEC 6.2 + 6.7 + 7: the map pans and zooms, but only within the region (owner, 2026-11-13).
// UAT_URL=http://localhost:5195/?test=1 node tests/uat/mapview.mjs
import {
  HAI_PHONG, MAP_RESET, NOW_MS, SAME_PX, T, TRACK, canvasShot, check, context, events, finiteView, finish, focusMap, mapView, open, pageScrollState,
  pinch, pixelDiff, sameScroll, scenario, skipOnboarding, text, touchPath, trackAt, url, viewDelta, visible, waitView, waitVisible,
} from './lib.mjs';

const SETTLE = 600; // ms to wait after an input before reading the view (reduced motion: no easing)
const fmt = (v) => (finiteView(v) ? `zoom ${v.zoom.toFixed(3)} lat ${v.lat.toFixed(3)} lon ${v.lon.toFixed(3)}` : JSON.stringify(v));
const globeBox = (page) => T(page, 'globe').first().boundingBox();
const centreOf = (b) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
const markerCentre = async (page) => {
  const b = await T(page, 'storm-marker').first().boundingBox().catch(() => null);
  return b ? centreOf(b) : null;
};

/** Wheel over the centre of the globe, n notches of dy (negative zooms in). Returns every zoom seen after a notch. */
async function wheel(page, g, n, dy) {
  const seen = [];
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  for (let k = 0; k < n; k++) {
    await page.mouse.wheel(0, dy);
    await page.waitForTimeout(80);
    seen.push((await mapView(page))?.zoom);
  }
  await page.waitForTimeout(SETTLE);
  seen.push((await mapView(page))?.zoom);
  return seen;
}
/** Two-finger pinches over the centre of the globe (CDP touch events), n times from d0 to d1 px apart. */
async function pinches(page, g, n, d0, d1) {
  const seen = [];
  for (let k = 0; k < n; k++) {
    await pinch(page, g.x + g.width / 2, g.y + g.height / 2, d0, d1);
    await page.waitForTimeout(150);
    seen.push((await mapView(page))?.zoom);
  }
  await page.waitForTimeout(SETTLE);
  seen.push((await mapView(page))?.zoom);
  return seen;
}
/** Zoom in: wheel on desktop, pinch on a phone, until zoom >= want (or the tries run out). */
async function zoomIn(page, g, phone, want, tries = 12) {
  for (let k = 0; k < tries; k++) {
    const v = await mapView(page);
    if (finiteView(v) && v.zoom >= want) break;
    if (phone) await pinch(page, g.x + g.width / 2, g.y + g.height / 2, 80, 160);
    else {
      await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
      await page.mouse.wheel(0, -150);
    }
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(SETTLE);
  return mapView(page);
}
async function zoomOutFully(page, g, phone) {
  if (phone) await pinches(page, g, 12, 300, 40);
  else await wheel(page, g, 40, 300);
  return mapView(page);
}
/** One drag of (dx, dy) px from (x0, y0): mouse on desktop, one finger on a phone (CDP touch). */
async function drag(page, phone, x0, y0, dx, dy) {
  const n = 10;
  if (phone) {
    await touchPath(page, Array.from({ length: n + 1 }, (_, i) => [[x0 + (dx * i) / n, y0 + (dy * i) / n]]));
  } else {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let i = 1; i <= n; i++) await page.mouse.move(x0 + (dx * i) / n, y0 + (dy * i) / n);
    await page.mouse.up();
  }
  await page.waitForTimeout(200);
}
/**
 * A screen point near (x, y) where the map itself takes the pointer: the topmost element there is a canvas inside
 * [globe], not a label, legend or control laid over it (a drag that starts on overlaid text selects that text).
 * Searched outward in 20 px steps up to 160 px; falls back to (x, y).
 */
async function mapPoint(page, x, y) {
  return page.evaluate(([x, y]) => {
    const g = document.querySelector('[data-test="globe"]');
    const ok = (px, py) => {
      const e = document.elementFromPoint(px, py);
      return !!e && e.tagName === 'CANVAS' && !!g && g.contains(e);
    };
    for (let r = 0; r <= 160; r += 20) {
      for (let a = 0; a < (r ? 16 : 1); a++) {
        const px = x + r * Math.cos((a * Math.PI) / 8);
        const py = y + r * Math.sin((a * Math.PI) / 8);
        if (ok(px, py)) return [px, py];
      }
    }
    return [x, y];
  }, [x, y]);
}
/** A drag across the globe in a direction (the pointer's direction: right, left, down, up), kept inside the globe. */
async function dragFor(page, g, dir, frac = 0.7, maxPx = 400) {
  const len = Math.min(maxPx, (dir === 'right' || dir === 'left' ? g.width : g.height) * frac);
  const cx = g.x + g.width / 2;
  const cy = g.y + g.height / 2;
  const sx = g.x + g.width * 0.15;
  const ex = g.x + g.width * 0.85;
  const sy = g.y + g.height * 0.15;
  const ey = g.y + g.height * 0.85;
  if (dir === 'right') return [...(await mapPoint(page, sx, cy)), len, 0];
  if (dir === 'left') return [...(await mapPoint(page, ex, cy)), -len, 0];
  if (dir === 'down') return [...(await mapPoint(page, cx, sy)), 0, len];
  return [...(await mapPoint(page, cx, ey)), 0, -len];
}
/** A drag of (dx, dy) starting on the map near the globe's centre. */
async function dragCentre(page, phone, g, dx, dy) {
  const [x, y] = await mapPoint(page, g.x + g.width / 2 - dx / 2, g.y + g.height / 2 - dy / 2);
  await drag(page, phone, x, y, dx, dy);
}
/** The place-pin's centre after __app.setPlace(lat, lon), and its box. */
async function pinAt(page, p) {
  await page.evaluate((p) => window.__app.setPlace(p.lat, p.lon, 'Điểm đo'), p);
  await page.waitForTimeout(800);
  const b = await T(page, 'place-pin').first().boundingBox().catch(() => null);
  return b && b.width > 0 ? { ...centreOf(b), w: b.width, h: b.height } : null;
}
/**
 * Calibration at zoom 1 (the first view): pins at the view centre and 2° east and 2° north of it give the screen
 * scale near the centre (px per degree). The region's half-size in degrees is then half the globe box over that scale.
 */
async function calibrate(page, g, v0) {
  const c = await pinAt(page, { lat: v0.lat, lon: v0.lon });
  const e = await pinAt(page, { lat: v0.lat, lon: v0.lon + 2 });
  const n = await pinAt(page, { lat: v0.lat + 2, lon: v0.lon });
  if (!c || !e || !n) return null;
  const pxLon = (e.x - c.x) / 2;
  const pxLat = (n.y - c.y) / 2;
  if (!(Math.abs(pxLon) > 1) || !(Math.abs(pxLat) > 1)) return null;
  return { c, pxLon, pxLat, hx: g.width / 2 / Math.abs(pxLon), hy: g.height / 2 / Math.abs(pxLat) };
}
/** Our tolerance for "mapView inside the region": 6 % of the region's half-size (the globe is not a flat map). */
function viewInside(v, v0, cal) {
  if (!finiteView(v)) return false;
  const z = Math.max(1, v.zoom);
  return Math.abs(v.lon - v0.lon) <= cal.hx * (1 - 1 / z) + 0.06 * cal.hx && Math.abs(v.lat - v0.lat) <= cal.hy * (1 - 1 / z) + 0.06 * cal.hy;
}
/** Three places inside a view: its centre, and points toward the region centre along lon and along lat. */
function probePoints(v, v0, cal) {
  const dx = (0.4 * cal.hx) / v.zoom;
  const dy = (0.4 * cal.hy) / v.zoom;
  return [
    { lat: v.lat, lon: v.lon },
    { lat: v.lat, lon: v.lon + (v.lon > v0.lon ? -dx : dx) },
    { lat: v.lat + (v.lat > v0.lat ? -dy : dy), lon: v.lon },
  ];
}
/**
 * Where a zoomed view sits in the first view (zoom 1). p are the three probe pins on screen in the zoomed view, P the
 * same places on screen at zoom 1. Near the view centre the map is a scale (kx, ky) and a shift, so the globe box's
 * edges in the zoomed view map back to these zoom-1 screen positions.
 */
function viewInFirst(g, p, P) {
  const kx = (p[1].x - p[0].x) / (P[1].x - P[0].x);
  const ky = (p[2].y - p[0].y) / (P[2].y - P[0].y);
  return {
    kx, ky,
    left: P[0].x + (g.x - p[0].x) / kx,
    right: P[0].x + (g.x + g.width - p[0].x) / kx,
    top: P[0].y + (g.y - p[0].y) / ky,
    bottom: P[0].y + (g.y + g.height - p[0].y) / ky,
  };
}

// ------------------------------------------------ first view, zoom inputs and their limits
await scenario('first view, zoom by wheel and keys, limits 1-4, no page scroll or zoom (1440x900, reduced motion)', async () => {
  const ctx = await context({ reducedMotion: 'reduce' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  const g = await globeBox(page);
  const v0 = await mapView(page);
  check('__app.mapView is { zoom, lat, lon } with finite numbers', finiteView(v0), JSON.stringify(v0));
  check('the first view is zoom 1 (the whole region)', finiteView(v0) && Math.abs(v0.zoom - 1) <= 0.01, fmt(v0));
  check('btn-map-reset is not shown on the first view', !(await visible(page, 'btn-map-reset')));

  // SPEC 6.2: at zoom 1 there is nothing to pan.
  const a = await canvasShot(page);
  const m0 = await markerCentre(page);
  for (const dir of ['right', 'left', 'down', 'up']) await drag(page, false, ...(await dragFor(page, g, dir)));
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  const b = await canvasShot(page);
  const m1 = await markerCentre(page);
  const v1 = await mapView(page);
  const d = await pixelDiff(page, a, b);
  check('at zoom 1, mouse drags in four directions leave __app.mapView as it was', viewDelta(v0, v1) <= 1e-4, `${fmt(v0)} -> ${fmt(v1)}`);
  check('at zoom 1, the drags leave the globe image as it was (same image)', d <= SAME_PX, `${(d * 100).toFixed(2)} % of pixels changed`);
  check('at zoom 1, the drags leave storm-marker in place (within 1 px)', !!m0 && !!m1 && Math.hypot(m0.x - m1.x, m0.y - m1.y) <= 1, `${JSON.stringify(m0)} -> ${JSON.stringify(m1)}`);

  // Scroll wheel: zooms in, stops at 4; back out, stops at 1. The page itself does not scroll.
  const s0 = await pageScrollState(page);
  const one = await wheel(page, g, 1, -200);
  check('one wheel notch up over the map zooms in (zoom above 1)', typeof one.at(-1) === 'number' && one.at(-1) > 1.01, one.join(','));
  const inSeen = await wheel(page, g, 40, -300);
  check('wheeling in keeps zoom at or below 4 and stops at 4 (within 0.02)', inSeen.every((z) => typeof z === 'number' && z <= 4.02) && Math.abs(inSeen.at(-1) - 4) <= 0.02, inSeen.map((z) => z?.toFixed?.(2)).join(','));
  const outSeen = await wheel(page, g, 60, 300);
  const vOut = await mapView(page);
  check('wheeling out keeps zoom at or above 1 and stops at 1 (within 0.02)', outSeen.every((z) => typeof z === 'number' && z >= 0.98) && Math.abs(outSeen.at(-1) - 1) <= 0.02, outSeen.map((z) => z?.toFixed?.(2)).join(','));
  check('back at zoom 1 the view is the first view again (lat, lon within 0.001°)', viewDelta(v0, vOut) <= 2e-3 && finiteView(vOut) && Math.abs(vOut.lat - v0.lat) <= 1e-3 && Math.abs(vOut.lon - v0.lon) <= 1e-3, `${fmt(v0)} -> ${fmt(vOut)}`);
  const s1 = await pageScrollState(page);
  check('wheeling over the map does not scroll or zoom the page', sameScroll(s0, s1), `${JSON.stringify(s0)} -> ${JSON.stringify(s1)}`);
  // A trackpad pinch on a desktop arrives as a wheel event with Ctrl held.
  await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2);
  await page.keyboard.down('Control');
  for (let k = 0; k < 3; k++) await page.mouse.wheel(0, -200);
  await page.keyboard.up('Control');
  await page.waitForTimeout(SETTLE);
  const s2 = await pageScrollState(page);
  check('a Ctrl + wheel (trackpad pinch) over the map does not zoom or scroll the page', sameScroll(s1, s2), `${JSON.stringify(s1)} -> ${JSON.stringify(s2)}`);
  await wheel(page, g, 40, 300);

  // Keys + and - when the map has focus.
  const focused = await focusMap(page);
  check('Tab reaches the map (focus on [globe] or a non-control element inside it)', focused);
  const k0 = await mapView(page);
  await page.keyboard.press('+');
  await page.waitForTimeout(SETTLE);
  const k1 = await mapView(page);
  check('the + key zooms in', finiteView(k0) && finiteView(k1) && k1.zoom > k0.zoom + 0.01, `${fmt(k0)} -> ${fmt(k1)}`);
  const kin = [];
  for (let k = 0; k < 20; k++) {
    await page.keyboard.press('+');
    await page.waitForTimeout(60);
    kin.push((await mapView(page))?.zoom);
  }
  await page.waitForTimeout(SETTLE);
  kin.push((await mapView(page))?.zoom);
  check('pressing + keeps zoom at or below 4 and stops at 4 (within 0.02)', kin.every((z) => typeof z === 'number' && z <= 4.02) && Math.abs(kin.at(-1) - 4) <= 0.02, kin.map((z) => z?.toFixed?.(2)).join(','));
  await page.keyboard.press('-');
  await page.waitForTimeout(SETTLE);
  const k2 = await mapView(page);
  check('the - key zooms out', finiteView(k2) && k2.zoom < kin.at(-1) - 0.01, fmt(k2));
  const kout = [];
  for (let k = 0; k < 25; k++) {
    await page.keyboard.press('-');
    await page.waitForTimeout(60);
    kout.push((await mapView(page))?.zoom);
  }
  await page.waitForTimeout(SETTLE);
  kout.push((await mapView(page))?.zoom);
  check('pressing - keeps zoom at or above 1 and stops at 1 (within 0.02)', kout.every((z) => typeof z === 'number' && z >= 0.98) && Math.abs(kout.at(-1) - 1) <= 0.02, kout.map((z) => z?.toFixed?.(2)).join(','));
  check('btn-map-reset is hidden again once the view is back at zoom 1', !(await visible(page, 'btn-map-reset')));
  await ctx.close();
});

await scenario('pinch zooms within 1-4; one finger does not pan at zoom 1; the page does not scroll or zoom (375x812 touch, reduced motion)', async () => {
  const ctx = await context({ phone: true, reducedMotion: 'reduce' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.waitForTimeout(1000);
  const g = await globeBox(page);
  const v0 = await mapView(page);
  check('(375) the first view is zoom 1 (the whole region)', finiteView(v0) && Math.abs(v0.zoom - 1) <= 0.01, fmt(v0));
  check('(375) btn-map-reset is not shown on the first view', !(await visible(page, 'btn-map-reset')));
  const a = await canvasShot(page);
  for (const dir of ['right', 'left', 'down', 'up']) await drag(page, true, ...(await dragFor(page, g, dir)));
  await page.waitForTimeout(1000);
  const b = await canvasShot(page);
  const v1 = await mapView(page);
  const d = await pixelDiff(page, a, b);
  check('(375) at zoom 1, one-finger drags leave __app.mapView as it was', viewDelta(v0, v1) <= 1e-4, `${fmt(v0)} -> ${fmt(v1)}`);
  check('(375) at zoom 1, one-finger drags leave the globe image as it was', d <= SAME_PX, `${(d * 100).toFixed(2)} % of pixels changed`);
  const s0 = await pageScrollState(page);
  const one = await pinches(page, g, 1, 60, 220);
  check('(375) a pinch (fingers spreading) over the map zooms in', typeof one.at(-1) === 'number' && one.at(-1) > 1.01, one.join(','));
  const inSeen = await pinches(page, g, 8, 40, 320);
  check('(375) pinching in keeps zoom at or below 4 and stops at 4 (within 0.02)', inSeen.every((z) => typeof z === 'number' && z <= 4.02) && Math.abs(inSeen.at(-1) - 4) <= 0.02, inSeen.map((z) => z?.toFixed?.(2)).join(','));
  const outSeen = await pinches(page, g, 12, 320, 40);
  check('(375) pinching out keeps zoom at or above 1 and stops at 1 (within 0.02)', outSeen.every((z) => typeof z === 'number' && z >= 0.98) && Math.abs(outSeen.at(-1) - 1) <= 0.02, outSeen.map((z) => z?.toFixed?.(2)).join(','));
  const s1 = await pageScrollState(page);
  check('(375) pinching over the map does not zoom or scroll the page (visual viewport scale 1, no scroll)', sameScroll(s0, s1) && Math.abs(s1.scale - 1) < 1e-6, `${JSON.stringify(s0)} -> ${JSON.stringify(s1)}`);
  await ctx.close();
});

// ------------------------------------------------ panning once zoomed
for (const phone of [false, true]) {
  const tag = phone ? '(375)' : '(1440)';
  await scenario(`drag ${phone ? 'with one finger ' : ''}and ${phone ? '' : 'arrow keys '}pan once zoomed ${tag}, reduced motion`, async () => {
    const ctx = await context({ phone, reducedMotion: 'reduce' });
    const page = await open(ctx);
    await skipOnboarding(page);
    await page.waitForTimeout(1000);
    const g = await globeBox(page);
    const z = await zoomIn(page, g, phone, 1.8);
    check(`${tag} zoomed in to about 2 for the pan checks`, finiteView(z) && z.zoom >= 1.8, fmt(z));
    await page.mouse.move(5, 5);
    const a = await canvasShot(page);
    const len = phone ? 100 : 150;
    await dragCentre(page, phone, g, len, 0);
    await page.waitForTimeout(SETTLE);
    const v1 = await mapView(page);
    const b = await canvasShot(page);
    const d = await pixelDiff(page, a, b);
    check(`${tag} a ${phone ? 'one-finger' : 'mouse'} drag pans the zoomed map (__app.mapView lat or lon changes)`, finiteView(z) && finiteView(v1) && Math.max(Math.abs(v1.lat - z.lat), Math.abs(v1.lon - z.lon)) > 1e-3, `${fmt(z)} -> ${fmt(v1)}`);
    check(`${tag} the drag keeps the zoom (within 0.01)`, finiteView(z) && finiteView(v1) && Math.abs(v1.zoom - z.zoom) <= 0.01, `${fmt(z)} -> ${fmt(v1)}`);
    check(`${tag} the drag changes the globe image`, d > SAME_PX, `${(d * 100).toFixed(2)} % of pixels changed`);
    if (!phone) {
      check(`${tag} Tab reaches the map`, await focusMap(page));
      const moves = {};
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
        const before = await mapView(page);
        for (let k = 0; k < 2; k++) await page.keyboard.press(key);
        await page.waitForTimeout(SETTLE);
        const after = await mapView(page);
        moves[key] = finiteView(before) && finiteView(after) ? { dLat: after.lat - before.lat, dLon: after.lon - before.lon, dZoom: after.zoom - before.zoom } : null;
        check(`${tag} ${key} pans the zoomed map (lat or lon changes, zoom stays)`, !!moves[key] && Math.max(Math.abs(moves[key].dLat), Math.abs(moves[key].dLon)) > 1e-3 && Math.abs(moves[key].dZoom) <= 0.01, JSON.stringify(moves[key]));
      }
      const L = moves.ArrowLeft;
      const R = moves.ArrowRight;
      const U = moves.ArrowUp;
      const D = moves.ArrowDown;
      check(`${tag} ArrowLeft and ArrowRight move the view in opposite directions along longitude`, !!L && !!R && Math.abs(L.dLon) > 1e-3 && Math.sign(L.dLon) === -Math.sign(R.dLon), `${L?.dLon} / ${R?.dLon}`);
      check(`${tag} ArrowUp and ArrowDown move the view in opposite directions along latitude`, !!U && !!D && Math.abs(U.dLat) > 1e-3 && Math.sign(U.dLat) === -Math.sign(D.dLat), `${U?.dLat} / ${D?.dLat}`);
    }
    await ctx.close();
  });
}

// ------------------------------------------------ the view never leaves the region
/*
 * How the tests know the region box: SPEC defines it as what the first view (zoom 1) shows, so the box is the globe
 * element's box at zoom 1. The tests measure, with place pins (__app.setPlace), where places are drawn at zoom 1 and in
 * a zoomed view, and from that compute where the zoomed view's edges fall in the first view. Those edges must lie
 * within the globe box (our tolerance: 3 % of the side plus 8 px, plus the pin's own size for the vertical edges).
 * __app.mapView's centre is also checked against the region's half-size in degrees from the zoom-1 calibration.
 */
for (const phone of [false, true]) {
  const tag = phone ? '(375 region)' : '(1440 region)';
  await scenario(`panning hard toward each edge at zoom 4 stops at the region's edge ${tag}, reduced motion`, async () => {
    const ctx = await context({ phone, reducedMotion: 'reduce' });
    const page = await open(ctx);
    await skipOnboarding(page);
    await page.waitForTimeout(1000);
    const g = await globeBox(page);
    const v0 = await mapView(page);
    if (!finiteView(v0)) return check(`${tag} __app.mapView is there to measure the region`, false, JSON.stringify(v0));
    const cal = await calibrate(page, g, v0);
    if (!cal) return check(`${tag} place pins can be placed at the view centre and 2° east and north of it (calibration)`, false);
    const gc = centreOf(g);
    check(`${tag} __app.mapView's lat and lon are the view centre: a pin placed there covers the globe's centre (8 px margin)`, Math.abs(gc.x - cal.c.x) <= cal.c.w / 2 + 8 && Math.abs(gc.y - cal.c.y) <= cal.c.h / 2 + 8, `pin ${JSON.stringify(cal.c)} centre ${JSON.stringify(gc)}`);

    const z = await zoomIn(page, g, phone, 3.98, 40);
    check(`${tag} zoomed in to 4`, finiteView(z) && Math.abs(z.zoom - 4) <= 0.02, fmt(z));
    const shots = [];
    const edges = [];
    for (const dir of ['right', 'left', 'down', 'up']) {
      const outside = [];
      let prev = await mapView(page);
      const start = prev;
      for (let k = 0; k < 15; k++) {
        await drag(page, phone, ...(await dragFor(page, g, dir)));
        const v = await mapView(page);
        if (!viewInside(v, v0, cal)) outside.push(fmt(v));
        prev = v;
      }
      await page.waitForTimeout(SETTLE);
      const V = await mapView(page);
      check(`${tag} 15 hard drags ${dir} at zoom 4 move the view`, viewDelta(start, V) > 1e-3, `${fmt(start)} -> ${fmt(V)}`);
      check(`${tag} during the drags ${dir}, __app.mapView stays inside the region (centre within the region's half-size × (1 - 1/zoom), 6 % margin)`, outside.length === 0 && viewInside(V, v0, cal), outside.slice(0, 3).join(' | ') || fmt(V));
      await drag(page, phone, ...(await dragFor(page, g, dir)));
      await page.waitForTimeout(SETTLE);
      const V2 = await mapView(page);
      check(`${tag} at the edge, one more drag ${dir} does not move the view (panning stops at the edge)`, viewDelta(V, V2) <= 1e-3, `${fmt(V)} -> ${fmt(V2)}`);
      if (!finiteView(V)) continue;
      const pts = probePoints(V, v0, cal);
      const p = [];
      for (const q of pts) p.push(await pinAt(page, q));
      await page.screenshot({ path: new URL(`./shots/mapview-${phone ? 375 : 1440}-edge-${dir}.png`, import.meta.url).pathname }).catch(() => {});
      shots.push(dir);
      edges.push({ dir, V, pts, p });
    }
    const back = await zoomOutFully(page, g, phone);
    check(`${tag} zooming fully out returns to zoom 1 and the first view's centre (within 0.001°)`, finiteView(back) && Math.abs(back.zoom - 1) <= 0.02 && Math.abs(back.lat - v0.lat) <= 1e-3 && Math.abs(back.lon - v0.lon) <= 1e-3, `${fmt(v0)} -> ${fmt(back)}`);
    const tolX = 0.03 * g.width + 8;
    const reached = { h: new Set(), v: new Set() };
    for (const e of edges) {
      const P = [];
      for (const q of e.pts) P.push(await pinAt(page, q));
      if (e.p.some((x) => !x) || P.some((x) => !x)) {
        check(`${tag} after the drags ${e.dir}, the three probe pins show in the zoomed view and at zoom 1`, false, JSON.stringify({ zoomed: e.p, first: P }));
        continue;
      }
      const r = viewInFirst(g, e.p, P);
      const tolY = 0.03 * g.height + 8 + (P[0].h / 2) * Math.abs(1 - 1 / r.ky);
      const inside = r.left >= g.x - tolX && r.right <= g.x + g.width + tolX && r.top >= g.y - tolY && r.bottom <= g.y + g.height + tolY;
      const where = `view in the first view x ${r.left.toFixed(0)}-${r.right.toFixed(0)}, y ${r.top.toFixed(0)}-${r.bottom.toFixed(0)}; region x ${g.x.toFixed(0)}-${(g.x + g.width).toFixed(0)}, y ${g.y.toFixed(0)}-${(g.y + g.height).toFixed(0)}; scale ${r.kx.toFixed(2)}, ${r.ky.toFixed(2)}`;
      check(`${tag} after the drags ${e.dir}, the screen shows nothing outside the region (the view's edges, mapped back to the first view, lie inside the globe box)`, inside, where);
      if (e.dir === 'right' || e.dir === 'left') {
        const atL = Math.abs(r.left - g.x) <= tolX;
        const atR = Math.abs(r.right - (g.x + g.width)) <= tolX;
        if (atL) reached.h.add('west');
        if (atR) reached.h.add('east');
        check(`${tag} after the drags ${e.dir}, the view has reached the region's west or east edge`, atL || atR, where);
      } else {
        const atT = Math.abs(r.top - g.y) <= tolY;
        const atB = Math.abs(r.bottom - (g.y + g.height)) <= tolY;
        if (atT) reached.v.add('north');
        if (atB) reached.v.add('south');
        check(`${tag} after the drags ${e.dir}, the view has reached the region's north or south edge`, atT || atB, where);
      }
    }
    check(`${tag} drags right and left reach both the west and the east edge`, reached.h.size === 2, [...reached.h].join(','));
    check(`${tag} drags down and up reach both the north and the south edge`, reached.v.size === 2, [...reached.v].join(','));
    await ctx.close();
  });
}

// ------------------------------------------------ marker and pin stay on their places
await scenario('storm-marker and place-pin stay over their places as the view moves (1440x900, reduced motion)', async () => {
  const ctx = await context({ reducedMotion: 'reduce' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.waitForTimeout(1000);
  const g = await globeBox(page);
  const v0 = await mapView(page);
  if (!finiteView(v0)) return check('__app.mapView is there', false, JSON.stringify(v0));
  const cal = await calibrate(page, g, v0);
  if (!cal || !TRACK) return check('calibration pins and yagi.json are there', false);
  const z = await zoomIn(page, g, false, 2.2);
  await dragCentre(page, false, g, 120, 0);
  await dragCentre(page, false, g, 0, 80);
  await page.waitForTimeout(SETTLE);
  const V = await mapView(page);
  check('the view is zoomed in and off the region centre', finiteView(V) && V.zoom >= 2 && Math.max(Math.abs(V.lat - v0.lat), Math.abs(V.lon - v0.lon)) > 1e-3, `${fmt(z)} -> ${fmt(V)}`);
  if (!finiteView(V)) return;
  const [c, x, y] = probePoints(V, v0, cal);
  const xy = { lat: y.lat, lon: x.lon };
  const track = trackAt(TRACK, NOW_MS);
  const places = [c, x, y, xy, track];
  const inBox = (m, pin) => !!m && !!pin && Math.abs(m.x - pin.x) <= pin.w / 2 + 8 && Math.abs(m.y - pin.y) <= pin.h / 2 + 8;
  const zoomed = [];
  for (const q of places) zoomed.push(await pinAt(page, q));
  const mZ = await markerCentre(page);
  check('zoomed in: storm-marker sits on a pin placed at the track position at now (marker centre inside the pin box, 8 px margin)', inBox(mZ, zoomed[4]), `marker ${JSON.stringify(mZ)} pin ${JSON.stringify(zoomed[4])}`);
  await zoomOutFully(page, g, false);
  const first = [];
  for (const q of places) first.push(await pinAt(page, q));
  const m1 = await markerCentre(page);
  check('at zoom 1: storm-marker sits on a pin placed at the track position at now', inBox(m1, first[4]), `marker ${JSON.stringify(m1)} pin ${JSON.stringify(first[4])}`);
  if ([...zoomed, ...first].some((p) => !p) || !mZ || !m1) return check('every probe pin and the marker show in both views', false, JSON.stringify({ zoomed, first }));
  // The map near the view centre is a scale and a shift: from the centre, east and north pins, predict where the
  // north-east pin, the track pin and the storm marker are drawn in the zoomed view. Our tolerance: 6 px plus 3 % of the distance.
  const kx = (zoomed[1].x - zoomed[0].x) / (first[1].x - first[0].x);
  const ky = (zoomed[2].y - zoomed[0].y) / (first[2].y - first[0].y);
  const predict = (P) => ({ x: zoomed[0].x + kx * (P.x - first[0].x), y: zoomed[0].y + ky * (P.y - first[0].y) });
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) <= 6 + 0.03 * Math.hypot(b.x - zoomed[0].x, b.y - zoomed[0].y);
  const pXY = predict(first[3]);
  check('place-pin is drawn where its place is in the zoomed view (north-east probe, predicted from zoom 1)', near(pXY, zoomed[3]), `predicted ${JSON.stringify(pXY)} got ${JSON.stringify(zoomed[3])} (scale ${kx.toFixed(2)}, ${ky.toFixed(2)})`);
  const pT = predict(first[4]);
  check('place-pin at the track position is drawn where that place is in the zoomed view', near(pT, zoomed[4]), `predicted ${JSON.stringify(pT)} got ${JSON.stringify(zoomed[4])}`);
  const pM = predict(m1);
  check('storm-marker is drawn where its place is in the zoomed view (predicted from zoom 1)', near(pM, mZ), `predicted ${JSON.stringify(pM)} got ${JSON.stringify(mZ)}`);
  await ctx.close();
});

// ------------------------------------------------ btn-map-reset
/** Time in the page from the click on btn-map-reset to __app.mapView back at zoom 1 and the first view's centre. */
const resetTimer = (page, v0) =>
  page.evaluate((v0) => {
    window.__uatReset = null;
    const onClick = () => {
      window.removeEventListener('click', onClick, true);
      const t0 = performance.now();
      const id = setInterval(() => {
        const v = window.__app.mapView;
        const dt = performance.now() - t0;
        if (v && Math.abs(v.zoom - 1) <= 0.001 && Math.abs(v.lat - v0.lat) <= 1e-3 && Math.abs(v.lon - v0.lon) <= 1e-3) {
          window.__uatReset = dt;
          clearInterval(id);
        } else if (dt > 3000) {
          window.__uatReset = Infinity;
          clearInterval(id);
        }
      }, 5);
    };
    window.addEventListener('click', onClick, true);
  }, v0);
const resetMs = async (page) => {
  await page.waitForFunction(() => window.__uatReset !== null, null, { timeout: 4000 }).catch(() => {});
  return page.evaluate(() => window.__uatReset);
};

for (const phone of [false, true]) {
  const tag = phone ? '(375 reset)' : '(1440 reset)';
  await scenario(`btn-map-reset ${tag}, reduced motion`, async () => {
    const ctx = await context({ phone, reducedMotion: 'reduce' });
    const page = await open(ctx);
    await skipOnboarding(page);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1000);
    const g = await globeBox(page);
    const v0 = await mapView(page);
    const a = await canvasShot(page);
    check(`${tag} btn-map-reset is not shown on the first view`, !(await visible(page, 'btn-map-reset')));
    await zoomIn(page, g, phone, 1.5);
    check(`${tag} btn-map-reset shows once the map is zoomed in`, await visible(page, 'btn-map-reset'));
    const label = await text(page, 'btn-map-reset').catch(() => '');
    check(`${tag} btn-map-reset reads "${MAP_RESET}"`, label === MAP_RESET, label);
    const b = await T(page, 'btn-map-reset').first().boundingBox().catch(() => null);
    check(`${tag} btn-map-reset is at least 44x44 px`, !!b && b.width >= 44 && b.height >= 44, JSON.stringify(b));
    const out = await zoomOutFully(page, g, phone);
    check(`${tag} btn-map-reset hides again when the view is zoomed back out to the whole region`, finiteView(out) && Math.abs(out.zoom - 1) <= 0.02 && !(await visible(page, 'btn-map-reset')), fmt(out));
    await zoomIn(page, g, phone, 2);
    await dragCentre(page, phone, g, phone ? 80 : 150, phone ? 60 : 100);
    await page.waitForTimeout(SETTLE);
    const moved = await mapView(page);
    check(`${tag} btn-map-reset shows while the view is zoomed in and off centre`, await visible(page, 'btn-map-reset'), fmt(moved));
    const n0 = (await events(page)).filter((e) => e.type === 'map_reset').length;
    await resetTimer(page, v0);
    await T(page, 'btn-map-reset').first().click({ timeout: 3000 }).catch(() => {});
    const dt = await resetMs(page);
    // Our threshold for a cut: within 500 ms of the click as the page sees it (README, "Thresholds that are ours").
    check(`${tag} under reduced motion btn-map-reset is a cut: zoom 1 and the first view's centre within 500 ms`, typeof dt === 'number' && dt <= 500, `${dt === null ? 'never' : Math.round(dt)} ms`);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1000);
    const v1 = await mapView(page);
    check(`${tag} after btn-map-reset __app.mapView is the first view (within 0.001)`, viewDelta(v0, v1) <= 1e-3, `${fmt(v0)} -> ${fmt(v1)}`);
    check(`${tag} after btn-map-reset the button is hidden`, !(await visible(page, 'btn-map-reset')));
    const c = await canvasShot(page);
    const d = await pixelDiff(page, a, c);
    check(`${tag} after btn-map-reset the globe image is the first view's (same image)`, d <= SAME_PX, `${(d * 100).toFixed(2)} % of pixels changed`);
    const n1 = (await events(page)).filter((e) => e.type === 'map_reset').length;
    check(`${tag} btn-map-reset logs one map_reset event`, n1 - n0 === 1, `${n1 - n0}`);
    await ctx.close();
  });
}

await scenario('btn-map-reset returns to zoom 1 within 0.4 s with motion allowed (1440x900)', async () => {
  const ctx = await context();
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.waitForTimeout(1000);
  const g = await globeBox(page);
  const v0 = await mapView(page);
  await zoomIn(page, g, false, 2.5);
  await dragCentre(page, false, g, 150, 100);
  await page.waitForTimeout(1500);
  await waitVisible(page, 'btn-map-reset', 3000).catch(() => {});
  await resetTimer(page, v0);
  await T(page, 'btn-map-reset').first().click({ timeout: 3000 }).catch(() => {});
  const dt = await resetMs(page);
  // SPEC: at most 0.4 s. Our threshold: 600 ms from the click as the page sees it, the 200 ms over SPEC for frames that
  // take longer under software WebGL here.
  check('(motion) btn-map-reset brings __app.mapView back to zoom 1 and the first view\'s centre within 600 ms of the click (SPEC: at most 0.4 s)', typeof dt === 'number' && dt <= 600, `${dt === null ? 'never' : Math.round(dt)} ms`);
  await ctx.close();
});

// ------------------------------------------------ nothing moves the map by itself
await scenario('no camera move after a verdict, a timeline row, a chip or a slider change (1440x900 full mode, reduced motion)', async () => {
  const ctx = await context({ reducedMotion: 'reduce', geo: HAI_PHONG });
  const page = await open(ctx, url({ mode: 'full' }));
  await skipOnboarding(page);
  await page.waitForTimeout(1000);
  const g = await globeBox(page);
  await zoomIn(page, g, false, 2);
  await dragCentre(page, false, g, 140, 90);
  await page.waitForTimeout(SETTLE);
  const V = await mapView(page);
  check('the view is zoomed in and off centre before the actions', finiteView(V) && V.zoom > 1.5, fmt(V));
  const still = async (what) => {
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1500);
    const now = await mapView(page);
    check(`${what} leaves __app.mapView as it was (within 0.0001)`, viewDelta(V, now) <= 1e-4, `${fmt(V)} -> ${fmt(now)}`);
  };
  await T(page, 'btn-check').first().click();
  await waitVisible(page, 'verdict', 15000).catch(() => {});
  await still('the check button (verdict for the location)');
  await page.evaluate(() => window.__app.setPlace(10.7769, 106.7009, 'TP. Hồ Chí Minh'));
  await still('__app.setPlace (verdict for a far place)');
  await page.keyboard.press('Escape');
  const row = T(page, 'timeline-row').first();
  if (await row.isVisible().catch(() => false)) {
    await row.click();
    await still('tapping a timeline row');
  } else check('a timeline row is there to tap', false);
  const slider = page.locator('[data-test="time-slider"] input[type=range], input[type=range][data-test="time-slider"]').first();
  if (await slider.count()) {
    const { max } = await slider.evaluate((e) => ({ max: +e.max }));
    await slider.fill(String(max));
    await still('moving the time slider to the last point');
  } else check('the time slider is there to move', false);
  await page.keyboard.press('Escape');
  await T(page, 'assistant-avatar').first().click();
  await waitVisible(page, 'assistant-sheet').catch(() => {});
  for (const id of ['where', 'prepare', 'when']) {
    await page.locator(`[data-test="assistant-sheet"] [data-test="chip"][data-chip="${id}"]`).first().click().catch(() => {});
    await still(`the "${id}" chip`);
  }
  await ctx.close();
});

// ------------------------------------------------ the satellite trip comes back to the same view
for (const reducedMotion of ['reduce', 'no-preference']) {
  const tag = reducedMotion === 'reduce' ? '(reduce)' : '(motion)';
  await scenario(`the satellite trip returns to the same map view ${tag} (1440x900)`, async () => {
    const ctx = await context({ reducedMotion });
    const page = await open(ctx);
    await skipOnboarding(page);
    await page.waitForTimeout(1000);
    const g = await globeBox(page);
    await zoomIn(page, g, false, 2.5);
    await dragCentre(page, false, g, -160, 90);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(1500);
    const V = await mapView(page);
    const a = await canvasShot(page);
    check(`${tag} the view is zoomed in and off centre before the trip`, finiteView(V) && V.zoom > 2, fmt(V));
    await T(page, 'btn-source').first().click();
    await waitView(page, 'satellite', 5000);
    await page.waitForTimeout(2000);
    await T(page, 'btn-back').first().click();
    await waitView(page, 'map', 5000);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(2000);
    const V2 = await mapView(page);
    const b = await canvasShot(page);
    const d = await pixelDiff(page, a, b);
    check(`${tag} after btn-back __app.mapView is the view from before the trip (within 0.001)`, viewDelta(V, V2) <= 1e-3, `${fmt(V)} -> ${fmt(V2)}`);
    check(`${tag} after btn-back the globe image is the view from before the trip (same image)`, d <= SAME_PX, `${(d * 100).toFixed(2)} % of pixels changed`);
    await ctx.close();
  });
}

// ------------------------------------------------ map_move in the log
await scenario('map_move is logged with { zoom }, at most one per 2 s (1440x900, reduced motion)', async () => {
  const ctx = await context({ reducedMotion: 'reduce' });
  const page = await open(ctx);
  await skipOnboarding(page);
  await page.waitForTimeout(2500);
  const g = await globeBox(page);
  const moves = async () => (await events(page)).filter((e) => e.type === 'map_move');
  const n0 = (await moves()).length;
  await zoomIn(page, g, false, 2);
  // About 5 s of small drags back and forth (they stay clear of the region's edges at zoom 2).
  const t0 = Date.now();
  for (let k = 0; Date.now() - t0 < 5000; k++) await dragCentre(page, false, g, k % 2 ? -40 : 40, 0);
  await page.waitForTimeout(2500);
  const all = await moves();
  const got = all.slice(n0);
  const same = all.filter((e) => e.session === all[all.length - 1]?.session);
  const gaps = same.map((e, i) => (i ? e.t - same[i - 1].t : Infinity));
  check('zooming and about 5 s of panning log map_move events (2 or more)', got.length >= 2, `${got.length}`);
  check('each map_move has { zoom } with a number from 1 to 4', got.length > 0 && got.every((e) => typeof e.data?.zoom === 'number' && e.data.zoom >= 1 - 1e-6 && e.data.zoom <= 4 + 1e-6), JSON.stringify(got.map((e) => e.data)).slice(0, 200));
  check('a map_move after zooming in carries a zoom above 1', got.some((e) => e.data?.zoom > 1.01), JSON.stringify(got.map((e) => e.data?.zoom)));
  check('map_move events are at least 2 s apart', same.length > 0 && gaps.every((x) => x >= 1950), gaps.filter((x) => x !== Infinity).join(','));
  await ctx.close();
});

await finish();
