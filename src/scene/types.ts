// The globe controller boundary. UI code imports only these types and scene/index.ts;
// three.js lives behind the lazy import in scene/index.ts.
import type { ConeCircle, LatLon, Province, Track } from '../storm/verdict';
import type { Mode } from '../state';
import type { HudStrings } from './hud';

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
  /** Read at the start of each satellite flight: true turns it into a cut. */
  reducedMotion(): boolean;
  /** Accessible names for the overlays. */
  labels: { storm: string; pin: string; satellite: string; reset: string; hud: HudStrings };
  /**
   * Elements that stay over the globe for a layout (the demo label, the key on a desktop). Read when the layout
   * changes, so the region (the zoom-1 view) frames the track and Vietnam in the part of the globe they leave open; province
   * names behind them are left out.
   */
  covers?: () => Element[];
  /** Elements over the globe that chart labels and notes keep clear of, without changing the framing (the question sheet). */
  avoid?: () => Element[];
  /** A cover whose size change re-frames the map at once (the key, whose height follows the map scale). */
  frameAround?: Element;
  /** Called when the map scale settles: the dot scale (storm/glyph.ts) and px per km at the view centre. */
  onMetrics?: (m: { scale: number; pxPerKm: number }) => void;
  /** Called after an input moved the map (SPEC 6.2), with the new zoom; the caller throttles the log. */
  onMapMove?: (zoom: number) => void;
  /** Called when btn-map-reset is pressed. */
  onMapReset?: () => void;
  /** Called after a drag that only pulled the map and sprang back to where it started (SPEC 6.2), with the zoom; the caller throttles the log. */
  onMapPull?: (zoom: number) => void;
}

/**
 * DOM overlays the controller owns and positions over the 3D objects:
 * [data-test="storm-marker"], [data-test="place-pin"], [data-test="satellite-model"].
 */
export interface GlobeController {
  /** Resolves once the first frame has been drawn. */
  readonly ready: Promise<void>;
  onReady(cb: () => void): void;
  /** Province names on the map in full mode. The mode never moves the map (SPEC 6.2). */
  setMode(mode: Mode): void;
  /** Storm marker and wind area at this time (ms). */
  setTime(ms: number): void;
  /** Pin the place; null removes the pin. The view does not move. */
  setPlace(place: (LatLon & { label?: string }) | null): void;
  /** Highlight the storm marker for a few seconds (the `where` chip); no camera move. */
  highlightStorm(): void;
  /** Fly out to the GK-2A close-up (0.82 s, a cut under reduced motion). */
  showSatellite(): void;
  /** The close-up camera (SPEC 6.7): yaw and pitch in radians, zoom as a share of the arrival distance. */
  satellite(): { yaw: number; pitch: number; zoom: number };
  /** Fly back to the map view the trip left from. */
  back(): void;
  /** The map view (SPEC 6.2, 8): zoom 1-4 and the surface point at the view's centre. */
  mapView(): { zoom: number; lat: number; lon: number };
  dispose(): void;
}

export type CreateGlobe = (init: GlobeInit) => GlobeController;
