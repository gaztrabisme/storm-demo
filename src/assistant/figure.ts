// Usui-chan's half-body figure [assistant-figure] (SPEC 6.8): the usui-pose.webp picture until the 3D model has
// loaded (or for good when it cannot load or WebGL fails), then a small transparent canvas.
// One render loop serves every figure. It draws only the figures on screen, nothing while the tab is hidden, at most
// 30 frames a second, and under reduced motion one still neutral pose per figure and no loop.
import poseUrl from '../assets/guide/usui-pose.webp';
import { t } from '../i18n';
import { CLIPS, blend, type ClipName, type Pose } from './clips';
import type { FigureRenderer } from './figure3d';

const MODEL_URL = `${import.meta.env.BASE_URL}models/usui-chan.glb`;
/** Cross-fade between clips (s). */
const FADE = 0.35;
const FRAME_MS = 1000 / 30;

/** How long Usui-chan talks for a line of text (ms): about 45 ms a character, 2-4.5 s. */
export const talkMs = (text: string): number => Math.min(4500, Math.max(2000, text.length * 45));

const reducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

interface Layer {
  clips: Array<{ name: ClipName; param?: unknown }>;
  /** performance.now() when it started. */
  start: number;
}

export interface PlayOptions {
  /** The parameter for `point` (a screen direction {x, y}, y up). */
  param?: unknown;
  /** How long the clips play before the figure goes back to idle (ms); omitted: until the next play. */
  holdMs?: number;
}

export interface Figure {
  readonly el: HTMLElement;
  /** Plays these clips together, then idle after `holdMs`. */
  play(names: ClipName[], opts?: PlayOptions): void;
  /** The clips playing now ([] under reduced motion). */
  readonly clips: readonly ClipName[];
  /** Removes the figure from the render loop for good. */
  dispose(): void;
}

class FigureImpl implements Figure {
  readonly el: HTMLElement;
  private img: HTMLImageElement;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private cur: Layer = { clips: [{ name: 'idle' }], start: performance.now() };
  private prev: Layer | null = null;
  private timer = 0;
  private io: IntersectionObserver | null = null;
  onScreen = false;
  /** Under reduced motion: the still pose still has to be drawn once. */
  stillDirty = true;
  clips: ClipName[] = [];

  constructor(className: string) {
    this.img = document.createElement('img');
    this.img.className = 'assistant-figure__img';
    this.img.src = poseUrl;
    this.img.alt = '';
    this.img.decoding = 'async';
    this.el = document.createElement('div');
    this.el.className = `assistant-figure ${className}`;
    this.el.dataset.test = 'assistant-figure';
    this.el.setAttribute('role', 'img');
    this.el.setAttribute('aria-label', t('assistant.poseAlt'));
    this.el.append(this.img);
    this.setClipAttr();
    try {
      this.io = new IntersectionObserver((es) => {
        for (const e of es) this.onScreen = e.isIntersecting;
        if (this.onScreen) {
          loadModel();
          this.stillDirty = true;
          kick();
        }
      });
      this.io.observe(this.el);
    } catch {
      this.onScreen = true;
    }
  }

  private setClipAttr(): void {
    this.clips = reducedMotion() ? [] : this.cur.clips.map((c) => c.name);
    this.el.dataset.clip = this.clips.join(' ');
  }

  play(names: ClipName[], opts: PlayOptions = {}): void {
    window.clearTimeout(this.timer);
    const now = performance.now();
    this.prev = this.cur;
    this.cur = { clips: names.map((name) => ({ name, param: name === 'point' ? opts.param : undefined })), start: now };
    this.setClipAttr();
    if (reducedMotion()) return;
    if (opts.holdMs !== undefined && !(names.length === 1 && names[0] === 'idle')) this.timer = window.setTimeout(() => this.play(['idle']), opts.holdMs);
    kick();
  }

  /** The pose at time `now` (ms): the current clips, cross-faded in over the previous ones. */
  pose(now: number): Pose {
    if (reducedMotion()) return { bones: {}, face: {} };
    const sample = (l: Layer, w: number) => l.clips.map((c) => ({ pose: CLIPS[c.name]((now - l.start) / 1000, c.param as never), weight: w }));
    const k = Math.min(1, (now - this.cur.start) / 1000 / FADE);
    const fade = k * k * (3 - 2 * k);
    if (fade >= 1 || !this.prev) {
      this.prev = null;
      return blend(sample(this.cur, 1));
    }
    return blend([...sample(this.prev, 1 - fade), ...sample(this.cur, fade)]);
  }

  /** Shown on screen now (in the viewport and not inside a hidden element). */
  shown(): boolean {
    return this.onScreen && this.el.isConnected && this.el.getClientRects().length > 0;
  }

  /** The model has loaded: the canvas replaces the picture. */
  attach(): void {
    if (this.canvas) return;
    const c = document.createElement('canvas');
    c.className = 'assistant-figure__canvas';
    const ctx = c.getContext('2d');
    if (!ctx) return;
    this.canvas = c;
    this.ctx = ctx;
    this.resize();
    this.el.append(c);
    this.img.remove();
    this.stillDirty = true;
  }

  /** Canvas pixels follow the element's CSS size and the device pixel ratio (at most 2). */
  private resize(): void {
    if (!this.canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(this.el.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.el.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.stillDirty = true;
    }
  }

  draw(r: FigureRenderer, now: number): void {
    if (!this.ctx) return;
    this.resize();
    r.draw(this.pose(now), this.ctx);
    this.stillDirty = false;
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.io?.disconnect();
    figures.delete(this);
  }
}

// ---- One shared render loop for all figures.
const figures = new Set<FigureImpl>();
let renderer: FigureRenderer | null = null;
let modelState: 'none' | 'loading' | 'ready' | 'failed' = 'none';
let raf = 0;
let lastDraw = 0;

function loadModel(): void {
  if (modelState !== 'none') return;
  modelState = 'loading';
  import('./figure3d')
    .then((m) => m.createFigureRenderer(MODEL_URL))
    .then(
      (r) => {
        renderer = r;
        modelState = 'ready';
        for (const f of figures) f.attach();
        kick();
      },
      (e: unknown) => {
        // No model or no WebGL: the figures keep the usui-pose.webp picture.
        modelState = 'failed';
        console.warn(e);
      },
    );
}

/** Until this time (performance.now()) figures are not drawn: a camera flight is running. */
let holdUntil = 0;
let holdTimer = 0;

/** Pauses figure drawing for `ms` (a camera flight), so the figures do not slow it. */
export function holdFigures(ms: number): void {
  holdUntil = Math.max(holdUntil, performance.now() + ms);
  window.clearTimeout(holdTimer);
  holdTimer = window.setTimeout(kick, holdUntil - performance.now() + 5);
}

function loop(now: number): void {
  raf = 0;
  if (!renderer || document.hidden || now < holdUntil) return;
  const shown = [...figures].filter((f) => f.shown());
  if (!shown.length) return;
  if (reducedMotion()) {
    for (const f of shown) if (f.stillDirty) f.draw(renderer, now);
    return;
  }
  if (now - lastDraw >= FRAME_MS - 2) {
    lastDraw = now;
    for (const f of shown) f.draw(renderer, now);
  }
  raf = requestAnimationFrame(loop);
}

function kick(): void {
  if (!raf && renderer && !document.hidden) raf = requestAnimationFrame(loop);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  } else {
    for (const f of figures) f.stillDirty = true;
    kick();
  }
});

/** A new figure, idle until it is told to play. `className` sets its place and size (assistant.css). */
export function createFigure(className = ''): Figure {
  const f = new FigureImpl(className);
  figures.add(f);
  if (renderer) f.attach();
  return f;
}
