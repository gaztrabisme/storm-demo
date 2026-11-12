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

/** The GK-2A model, a line drawing in pale ink on the colour of space (DESIGN 5; --space-ink, --space). */
export const SCENE = {
  satInk: 0xc9d2de,
  satFill: 0x070b12,
} as const;
