/**
 * Curated 28-color high-contrast retro arcade palette (inspired by Endesga-32 / PICO-8).
 * Guarantees crisp visual separation between turf, white outlined ball, and red/blue teams.
 */
export const PALETTE = {
  // Backdrop & UI Dark tones
  inkBlack: '#0b0e14',
  deepNavy: '#141a26',
  slateDark: '#20293a',
  slateMid: '#374761',
  slateLight: '#687d9c',
  offWhite: '#f4f7fb',
  pureWhite: '#ffffff',

  // Turf (2 calm dark/rich greens for low eye fatigue & high ball contrast)
  turfDark: '#1e5b3a',
  turfLight: '#246b45',
  turfLine: '#72b886',

  // Concrete Alley Arena
  concreteDark: '#363b45',
  concreteLight: '#414754',
  concreteLine: '#e8c44d',
  brickWall: '#6e322e',

  // Rooftop Night Arena
  rooftopDark: '#1c3b4f',
  rooftopLight: '#22475e',
  rooftopLine: '#7ee0f5',
  skylineSilhouette: '#101522',

  // Ice Turf (Slippery Pitch mutator)
  iceDark: '#4d92b8',
  iceLight: '#6ab2d6',
  iceLine: '#d6f4ff',

  // Arena Walls & Goalposts
  wallTop: '#2c384d',
  wallFace: '#1a2230',
  wallBorder: '#8ca1bd',
  pinballGlow: '#ff9d2e',
  postMetal: '#dce5f2',
  postShadow: '#7b8ca6',
  netColor: '#b7c7db',

  // Team A (Crimson Red)
  teamAPrimary: '#e5384f',
  teamADark: '#9e1c32',
  teamALight: '#ff7582',

  // Team B (Electric Blue + Gold Trim)
  teamBPrimary: '#2f80ed',
  teamBDark: '#194a99',
  teamBLight: '#73b9ff',

  // Shared Accents & FX
  gold: '#ffd23f',
  amber: '#ff8f1f',
  skinLight: '#f6c39b',
  skinDark: '#c98862',
  hairDark: '#231b26',
  dangerRed: '#ff2e4c',
  iceCyan: '#8df0ff',
} as const;
