// The globe controller boundary. UI code imports only these types and scene/index.ts;
// three.js lives behind the lazy import in scene/index.ts.
import type { ConeCircle, LatLon, Province, Track } from '../storm/verdict';
import type { Mode } from '../state';

export interface GlobeInit {
  /** The [data-test="globe"] element. The controller adds its canvas and the DOM overlays inside it. */
  container: HTMLElement;
  track: Track;
  nowMs: number;
  /** Selected time at start (ms). */
  timeMs: number;
  mode: Mode;
  cone: ConeCircle[];
  provinces: readonly Province[];
  /** Read at the moment of each camera move: true turns flights into cuts. */
  reducedMotion(): boolean;
  /** Accessible names for the overlays. */
  labels: { storm: string; pin: string; satellite: string };
}

/**
 * DOM overlays the controller owns and positions over the 3D objects:
 * [data-test="storm-marker"], [data-test="place-pin"], [data-test="satellite-model"].
 */
export interface GlobeController {
  /** Resolves once the first frame has been drawn. */
  readonly ready: Promise<void>;
  onReady(cb: () => void): void;
  /** easy: camera locked over Vietnam, no input. full: drag rotates, wheel or pinch zooms. */
  setMode(mode: Mode): void;
  /** Storm marker and wind area at this time (ms). */
  setTime(ms: number): void;
  /** Pin the place and frame it with the track; null removes the pin. */
  flyToPlace(place: LatLon | null): void;
  /** Frame the storm at the selected time. */
  flyToStorm(): void;
  /** Fly out to the GK-2A satellite (3-5 s, a cut under reduced motion). */
  showSatellite(): void;
  /** Fly back to the view before showSatellite(). */
  back(): void;
  dispose(): void;
}

export type CreateGlobe = (init: GlobeInit) => GlobeController;
