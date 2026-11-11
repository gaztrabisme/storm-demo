// Frame loop for the globe, after AstroSphere src/runtime/frameLoop.ts:
//  - the tab is hidden -> the requestAnimationFrame is cancelled (nothing advances, nothing is drawn);
//  - on return the first frame has dt = 0, so time spent hidden is skipped.
// Unlike AstroSphere it runs only while something is dirty or moving: a still globe costs no frames.

export interface FrameLoop {
  /** Ask for one more frame. */
  markDirty(): void;
  dispose(): void;
}

/** `frame(now, dt)` draws and returns true while it needs the next frame (a flight in progress). */
export function startFrameLoop(frame: (now: number, dt: number) => boolean): FrameLoop {
  const hidden = (): boolean => document.hidden === true;
  let raf = 0;
  let dirty = true;
  let last = performance.now();

  function loop(now: number): void {
    raf = 0;
    if (hidden()) return;
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    dirty = false;
    if (frame(now, dt)) dirty = true;
    if (dirty && !raf && !hidden()) raf = requestAnimationFrame(loop);
  }

  function request(): void {
    if (!raf && !hidden()) {
      last = performance.now();
      raf = requestAnimationFrame(loop);
    }
  }

  const onVisibility = (): void => {
    if (hidden()) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else if (dirty) request();
  };
  document.addEventListener('visibilitychange', onVisibility);
  request();

  return {
    markDirty() {
      dirty = true;
      request();
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibility);
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
