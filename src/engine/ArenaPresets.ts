import { ARENA_CONSTANTS, ArenaId, PitchSize } from '../types.ts';

export interface ArenaPreset {
  id: ArenaId;
  name: string;
  subtitle: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  chamfer: number;
  baseGoalHalfHeight: number;
  wallRestitution: number;
  hasWind: boolean;
}

export const ARENA_PRESETS: Record<ArenaId, ArenaPreset> = {
  classic: {
    id: 'classic',
    name: 'CLASSIC STADIUM',
    subtitle: 'BALANCED TURF & BOUNCE',
    left: ARENA_CONSTANTS.LEFT,
    right: ARENA_CONSTANTS.RIGHT,
    top: ARENA_CONSTANTS.TOP,
    bottom: ARENA_CONSTANTS.BOTTOM,
    chamfer: ARENA_CONSTANTS.CHAMFER,
    baseGoalHalfHeight: ARENA_CONSTANTS.BASE_GOAL_HALF_HEIGHT,
    wallRestitution: 0.89,
    hasWind: false,
  },
  concrete: {
    id: 'concrete',
    name: 'CONCRETE ALLEY',
    subtitle: 'NARROW COURT & HARD WALLS',
    left: 52,
    right: 428,
    top: 52,
    bottom: 240,
    chamfer: 24,
    baseGoalHalfHeight: 26,
    wallRestitution: 0.96,
    hasWind: false,
  },
  rooftop: {
    id: 'rooftop',
    name: 'ROOFTOP NIGHT',
    subtitle: 'SKYLINE & GENTLE SIDE WIND',
    left: 40,
    right: 440,
    top: 46,
    bottom: 246,
    chamfer: 30,
    baseGoalHalfHeight: 29,
    wallRestitution: 0.9,
    hasWind: true,
  },
};

export const ARENA_LIST: ArenaId[] = ['classic', 'concrete', 'rooftop'];

export interface PitchSizePreset {
  id: PitchSize;
  label: string;
  scale: number;
  goalScale: number;
}

export const PITCH_SIZE_PRESETS: Record<PitchSize, PitchSizePreset> = {
  standard: {
    id: 'standard',
    label: 'STANDARD (DEFAULT)',
    scale: 1.0,
    goalScale: 1.0,
  },
  large: {
    id: 'large',
    label: 'LARGE (1.8X AREA)',
    scale: 1.35,
    goalScale: 1.15,
  },
  xl: {
    id: 'xl',
    label: 'STADIUM XL (2.7X)',
    scale: 1.65,
    goalScale: 1.25,
  },
};

export const PITCH_SIZE_LIST: PitchSize[] = ['standard', 'large', 'xl'];
