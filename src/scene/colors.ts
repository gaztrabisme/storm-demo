// Scene colours for the parts drawn in WebGL (the Earth textures and the satellite model). The chart marks
// drawn over the globe (scene/chart.ts) use the CSS tokens in styles.css; these values match DESIGN 3.

export interface EarthPalette {
  sea: string;
  land: string;
  coast: string;
}

/** Earth texture palettes: the paper chart (light theme) and the night screen (dark theme). */
export const EARTH: Record<'light' | 'dark', EarthPalette> = {
  light: { sea: '#f3f0ea', land: '#e4ded3', coast: '#3a3f47' },
  dark: { sea: '#0e1622', land: '#1a2433', coast: '#8a97a8' },
};

/** The GK-2A model, in pale ink (DESIGN 5). */
export const SCENE = {
  satBody: 0xd9dde3,
  satMetal: 0xb7bec8,
  satPanel: 0x7d8796,
} as const;
