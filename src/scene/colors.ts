// Scene colours. They carry meaning on the globe and are kept apart from the UI theme tokens.
// The track, circle, wind and pin colours match --storm, --cone and --pin in styles.css.
export const SCENE = {
  oceanTop: '#163b5c',
  oceanMid: '#1d4d76',
  land: '#56664a',
  coast: '#b9c4a8',
  grid: 'rgba(255,255,255,0.10)',
  ice: 'rgba(230,240,250,0.75)',
  past: 0xffffff,
  forecast: 0xffd27a,
  cone: 0xffb066,
  wind: 0xff5a36,
  provinceDot: '#f2f4f7',
  provinceRing: '#0b1622',
  satBody: 0xd9a441,
  satMetal: 0xd8dde3,
  satPanel: 0x2f5fa8,
} as const;
