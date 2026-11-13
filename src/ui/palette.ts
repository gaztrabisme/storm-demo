// The colours the map draws the storm and the official-bulletin block with (DESIGN 3; SPEC 2.1). They equal the
// --storm and --bulletin tokens in styles.css; the wind area is the storm colour before transparency.
import type { Theme } from '../state';

export interface Palette {
  storm: string;
  stormFill: string;
  bulletin: string;
}

export const PALETTE: Record<Theme, Palette> = {
  light: { storm: '#3E5671', stormFill: '#3E5671', bulletin: '#2E6B57' },
  dark: { storm: '#9DB2C9', stormFill: '#9DB2C9', bulletin: '#7CC3A6' },
};
