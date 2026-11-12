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
  /** 1 when the part faces the viewer (its leader shows), per part. */
  facing: Uint8Array;
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
    el.append(n);
    at = i + m[0].length;
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

  // One callout per part: its label first (the leader starts beside it), the AMI callout with two lines under it.
  const text: Record<PartKey, string> = { ami: s.ami, ksem: s.ksem, wing: s.wing, dish: s.dish };
  const n = PART_ORDER.length;
  const blocks: HTMLElement[] = [];
  const leads: SVGPolylineElement[] = [];
  for (const key of PART_ORDER) {
    const b = document.createElement('div');
    b.className = 'sathud__callout';
    b.append(label('p', 'sathud__part', text[key]));
    if (key === 'ami') b.append(label('p', 'sathud__sub', s.fullDisk), label('p', 'sathud__sub', s.resolution));
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
    const bottom = h - footH - 24;
    stack(-1, f, top, bottom);
    stack(1, f, top, bottom);
    for (let i = 0; i < n; i++) {
      const left = side[i] === -1;
      const x = left ? Math.max(16, box[0] - 28 - bw[i]) : Math.min(w - 16 - bw[i], box[2] + 28);
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
      lead.setAttribute('points', `${r1(sx)},${r1(sy)} ${r1(ex)},${r1(sy)} ${r1(anchors[i * 2])},${r1(anchors[i * 2 + 1])}`);
    }
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
