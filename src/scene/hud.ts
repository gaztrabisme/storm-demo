// The satellite close-up's HUD (SPEC 6.7, labels SPEC 10.6): a screen-space overlay in pale ink over the 3D view.
// Corner brackets around the view, the header and the orbit line at the lower left, and one callout per model
// part (AMI, KSEM, wing, dish) with a fine leader to its anchor on the model. The callouts sit in two columns
// beside the model, on the side of their anchor, and follow the anchors as the model turns.
// Per frame it only moves elements and rewrites leader points; it allocates no arrays or vectors.
import type { PartKey } from './satellite';

export interface HudStrings {
  header: string;
  orbit: string;
  ami: string;
  fullDisk: string;
  resolution: string;
  ksem: string;
  wing: string;
  dish: string;
}

/** What the HUD needs from a frame: the model's box on screen and each part's anchor. */
export interface HudFrame {
  width: number;
  height: number;
  /** Model box on screen: x0, y0, x1, y1. */
  box: Float32Array;
  /** Anchors on screen, x and y per part, in PART_ORDER. */
  anchors: Float32Array;
  /** 1 when the camera sees the part's anchor (its leader shows), per part. */
  facing: Uint8Array;
  /** Each part's box on screen (x0, y0, x1, y1 per part, in PART_ORDER): the other leaders keep off it. */
  parts: Float32Array;
}

export const PART_ORDER: readonly PartKey[] = ['ami', 'ksem', 'wing', 'dish'];

const SVG = 'http://www.w3.org/2000/svg';
/** Digits with their separators (128,2 · 35.786 · 0,5–2), set in the monospace stack (SPEC 6.7). */
const NUMBER = /\d[\d.,–]*/g;

/** A hud-label element whose numbers are in mono spans; the "2" of the name GK-2A stays in the text face. */
function label(tag: string, cls: string, text: string): HTMLElement {
  const el = document.createElement(tag);
  el.dataset.test = 'hud-label';
  el.className = cls;
  let at = 0;
  for (const m of text.matchAll(NUMBER)) {
    const i = m.index ?? 0;
    if (/GK-$/.test(text.slice(0, i)) && /^2A/.test(text.slice(i))) continue;
    if (i > at) el.append(text.slice(at, i));
    const n = document.createElement('span');
    n.className = 'sathud__num';
    n.textContent = m[0];
    // The number and its unit (the word after it, or a degree sign) never break apart.
    const unit = /^(°|\s\S+)/.exec(text.slice(i + m[0].length))?.[0] ?? '';
    if (unit) {
      const keep = document.createElement('span');
      keep.className = 'sathud__keep';
      keep.append(n, unit);
      el.append(keep);
    } else el.append(n);
    at = i + m[0].length + unit.length;
  }
  if (at < text.length) el.append(text.slice(at));
  return el;
}

export function createHud(container: HTMLElement, s: HudStrings, viewLabel: string) {
  // [satellite]: the close-up view. It takes focus (Tab, or a press on the view) so the arrow keys turn the model.
  const root = document.createElement('div');
  root.dataset.test = 'satellite';
  root.className = 'satview';
  root.tabIndex = 0;
  root.setAttribute('role', 'application');
  root.setAttribute('aria-label', viewLabel);
  root.hidden = true;

  const hud = document.createElement('div');
  hud.dataset.test = 'satellite-hud';
  hud.className = 'sathud';
  root.append(hud);

  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'sathud__lines');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  hud.append(svg);
  const brackets = document.createElementNS(SVG, 'path');
  brackets.setAttribute('class', 'sathud__bracket');
  svg.append(brackets);

  const foot = document.createElement('div');
  foot.className = 'sathud__foot';
  foot.append(label('p', 'sathud__head', s.header), label('p', 'sathud__orbit', s.orbit));
  hud.append(foot);

  // The AMI callout's two detail lines.
  const amiSubs = document.createElement('div');
  amiSubs.className = 'sathud__subs';
  amiSubs.append(label('p', 'sathud__sub', s.fullDisk), label('p', 'sathud__sub', s.resolution));

  // One callout per part: its label first (the leader starts beside it), the AMI callout with two lines under it.
  const text: Record<PartKey, string> = { ami: s.ami, ksem: s.ksem, wing: s.wing, dish: s.dish };
  const n = PART_ORDER.length;
  const blocks: HTMLElement[] = [];
  const leads: SVGPolylineElement[] = [];
  for (const key of PART_ORDER) {
    const b = document.createElement('div');
    b.className = 'sathud__callout';
    b.append(label('p', 'sathud__part', text[key]));
    if (key === 'ami') b.append(amiSubs);
    hud.append(b);
    blocks.push(b);
    const l = document.createElementNS(SVG, 'polyline');
    l.setAttribute('class', 'sathud__lead');
    svg.append(l);
    leads.push(l);
  }
  container.append(root);

  // Sizes, measured when the HUD shows and whenever a callout or the footer changes size (text size setting).
  const bw = new Float32Array(n);
  const bh = new Float32Array(n);
  /** Height of each callout's first line: the leader starts at its middle. */
  const lh = new Float32Array(n);
  let footH = 0;
  let measured = false;
  function measure(): void {
    for (let i = 0; i < n; i++) {
      bw[i] = blocks[i].offsetWidth;
      bh[i] = blocks[i].offsetHeight;
      lh[i] = (blocks[i].firstElementChild as HTMLElement).offsetHeight;
    }
    footH = foot.offsetHeight;
    measured = bw[0] > 0;
  }
  const ro = new ResizeObserver(() => {
    measured = false;
  });
  for (const b of blocks) ro.observe(b);
  ro.observe(foot);

  // Layout state, kept between frames.
  const side = new Int8Array(n); // -1 left column, 1 right column, 0 not placed yet
  const bx = new Float32Array(n).fill(NaN);
  const by = new Float32Array(n).fill(NaN);
  const y = new Float32Array(n);
  const order = new Int8Array(n);
  const leadOn = new Uint8Array(n).fill(2);
  const faceOn = new Uint8Array(n).fill(2);
  let bracketW = -1;
  let bracketH = -1;

  const r1 = (v: number) => Math.round(v * 2) / 2;

  /** Stack the callouts of one column: sorted by anchor height, at least GAP apart, inside [top, bottom]. */
  const GAP = 14;
  function stack(col: number, f: HudFrame, top: number, bottom: number): void {
    let k = 0;
    for (let i = 0; i < n; i++) if (side[i] === col) order[k++] = i;
    for (let a = 1; a < k; a++) {
      const v = order[a];
      let b = a - 1;
      while (b >= 0 && f.anchors[order[b] * 2 + 1] > f.anchors[v * 2 + 1]) {
        order[b + 1] = order[b];
        b--;
      }
      order[b + 1] = v;
    }
    let at = top;
    for (let a = 0; a < k; a++) {
      const i = order[a];
      y[i] = Math.max(at, f.anchors[i * 2 + 1] - lh[i] / 2);
      at = y[i] + bh[i] + GAP;
    }
    let lim = bottom;
    for (let a = k - 1; a >= 0; a--) {
      const i = order[a];
      if (y[i] + bh[i] > lim) y[i] = Math.max(top, lim - bh[i]);
      lim = y[i] - GAP;
    }
  }

  function frame(f: HudFrame): void {
    if (!measured) measure();
    const { width: w, height: h, box, anchors } = f;
    if (w !== bracketW || h !== bracketH) {
      bracketW = w;
      bracketH = h;
      svg.setAttribute('width', String(w));
      svg.setAttribute('height', String(h));
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const i = 8;
      const a = 20;
      brackets.setAttribute(
        'd',
        `M${i + a},${i}H${i}V${i + a}M${w - i - a},${i}H${w - i}V${i + a}` + `M${i},${h - i - a}V${h - i}H${i + a}M${w - i},${h - i - a}V${h - i}H${w - i - a}`,
      );
    }
    const cx = (box[0] + box[2]) / 2;
    for (let i = 0; i < n; i++) {
      const ax = anchors[i * 2];
      if (side[i] === 0) side[i] = ax < cx ? -1 : 1;
      else if (side[i] === -1 && ax > cx + 10) side[i] = 1;
      else if (side[i] === 1 && ax < cx - 10) side[i] = -1;
    }
    const top = 52;
    // The callouts' distance from the model's box: less on a narrow view, where the columns are short of room.
    const gapX = w < 560 ? 18 : 28;
    const bottom = h - footH - 24;
    stack(-1, f, top, bottom);
    stack(1, f, top, bottom);
    for (let i = 0; i < n; i++) {
      const left = side[i] === -1;
      const x = left ? Math.max(16, box[0] - gapX - bw[i]) : Math.min(w - 16 - bw[i], box[2] + gapX);
      const xr = r1(x);
      const yr = r1(y[i]);
      const blk = blocks[i];
      if (xr !== bx[i] || yr !== by[i]) {
        bx[i] = xr;
        by[i] = yr;
        blk.style.transform = `translate(${xr}px, ${yr}px)`;
      }
      blk.classList.toggle('sathud__callout--left', left);
      const facing = f.facing[i];
      if (faceOn[i] !== facing) {
        faceOn[i] = facing;
        blk.classList.toggle('sathud__callout--away', facing === 0);
      }
      const lead = leads[i];
      if (leadOn[i] !== facing) {
        leadOn[i] = facing;
        lead.style.display = facing ? '' : 'none';
      }
      if (!facing) continue;
      const sx = left ? xr + bw[i] + 4 : xr - 4;
      const sy = yr + lh[i] / 2;
      const ex = left ? sx + 12 : sx - 12;
      lead.setAttribute('points', route(f, i, sx, sy, ex, anchors[i * 2], anchors[i * 2 + 1]));
    }
  }

  /** True when the segment a-b crosses the box (x0, y0, x1, y1), grown by PAD. */
  const PAD = 4;
  function crosses(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): boolean {
    x0 -= PAD;
    y0 -= PAD;
    x1 += PAD;
    y1 += PAD;
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const clip = (p: number, q: number): boolean => {
      if (Math.abs(p) < 1e-9) return q >= 0;
      const r = q / p;
      if (p < 0) {
        if (r > t1) return false;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return false;
        if (r < t1) t1 = r;
      }
      return true;
    };
    return clip(-dx, ax - x0) && clip(dx, x1 - ax) && clip(-dy, ay - y0) && clip(dy, y1 - ay) && t0 < t1;
  }

  /** The boxes on screen of the shown parts other than part i that do not hold its anchor. */
  function blocked(f: HudFrame, i: number, ax: number, ay: number, bx: number, by: number): number {
    for (let k = 0; k < n; k++) {
      if (k === i || !f.facing[k]) continue;
      const x0 = f.parts[k * 4];
      const y0 = f.parts[k * 4 + 1];
      const x1 = f.parts[k * 4 + 2];
      const y1 = f.parts[k * 4 + 3];
      const tx = f.anchors[i * 2];
      const ty = f.anchors[i * 2 + 1];
      if (tx > x0 - PAD && tx < x1 + PAD && ty > y0 - PAD && ty < y1 + PAD) continue;
      if (crosses(ax, ay, bx, by, x0, y0, x1, y1)) return k;
    }
    return -1;
  }

  /**
   * The leader's points: from the label (s) out to the elbow (e), then to the anchor (a). When the straight run from
   * the elbow would cross another part on screen, the elbow bends above or below that part instead.
   */
  function route(f: HudFrame, i: number, sx: number, sy: number, ex: number, ax: number, ay: number): string {
    const head = `${r1(sx)},${r1(sy)} ${r1(ex)},${r1(sy)}`;
    const k = blocked(f, i, ex, sy, ax, ay);
    if (k >= 0) {
      const y0 = f.parts[k * 4 + 1] - PAD - 3;
      const y1 = f.parts[k * 4 + 3] + PAD + 3;
      const ys = Math.abs(y0 - ay) <= Math.abs(y1 - ay) ? [y0, y1] : [y1, y0];
      for (const yc of ys) {
        // A bend straight up or down from the elbow, then on to the anchor.
        if (blocked(f, i, ex, sy, ex, yc) < 0 && blocked(f, i, ex, yc, ax, ay) < 0) return `${head} ${r1(ex)},${r1(yc)} ${r1(ax)},${r1(ay)}`;
        // Up or down, across above or below the part, then straight to the anchor.
        if (blocked(f, i, ex, sy, ex, yc) < 0 && blocked(f, i, ex, yc, ax, yc) < 0 && blocked(f, i, ax, yc, ax, ay) < 0) {
          return `${head} ${r1(ex)},${r1(yc)} ${r1(ax)},${r1(yc)} ${r1(ax)},${r1(ay)}`;
        }
      }
    }
    return `${head} ${r1(ax)},${r1(ay)}`;
  }

  return {
    root,
    frame,
    show(on: boolean): void {
      if (root.hidden === !on) return;
      root.hidden = !on;
      if (on) {
        measured = false;
        side.fill(0);
      } else if (root.contains(document.activeElement)) root.blur();
    },
    dispose(): void {
      ro.disconnect();
      root.remove();
    },
  };
}

export type Hud = ReturnType<typeof createHud>;
