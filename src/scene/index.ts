// Lazy entry to the 3D globe: the only path from UI code to three.js.
import type { GlobeController, GlobeInit } from './types';

export type { GlobeController, GlobeInit } from './types';

export async function loadGlobe(init: GlobeInit): Promise<GlobeController> {
  const m = await import('./boot');
  return m.createGlobe(init);
}
