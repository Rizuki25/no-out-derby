import { Team, TeamKitId } from '../types.ts';
import { PALETTE } from './Palette.ts';

export interface TeamKitPreset {
  id: TeamKitId;
  name: string;
  tag: string;
  primary: string;
  dark: string;
  light: string;
  trim: string;
  shorts: string;
  hair: string;
}

export const TEAM_KITS: Record<TeamKitId, TeamKitPreset> = {
  garuda: {
    id: 'garuda',
    name: 'GARUDA RED',
    tag: 'GRD',
    primary: PALETTE.teamAPrimary,
    dark: PALETTE.teamADark,
    light: PALETTE.teamALight,
    trim: PALETTE.pureWhite,
    shorts: PALETTE.inkBlack,
    hair: PALETTE.hairDark,
  },
  cyber: {
    id: 'cyber',
    name: 'CYBER BLUE',
    tag: 'CYB',
    primary: PALETTE.teamBPrimary,
    dark: PALETTE.teamBDark,
    light: PALETTE.teamBLight,
    trim: PALETTE.gold,
    shorts: PALETTE.deepNavy,
    hair: '#3b2419',
  },
  tarkam: {
    id: 'tarkam',
    name: 'TARKAM GOLD',
    tag: 'TRK',
    primary: '#f5a623',
    dark: '#a8640a',
    light: PALETTE.gold,
    trim: PALETTE.inkBlack,
    shorts: PALETTE.slateDark,
    hair: PALETTE.hairDark,
  },
  shadow: {
    id: 'shadow',
    name: 'SHADOW VIOLET',
    tag: 'SHD',
    primary: '#9b51e0',
    dark: '#5b2494',
    light: '#cf9fff',
    trim: PALETTE.iceCyan,
    shorts: PALETTE.inkBlack,
    hair: PALETTE.deepNavy,
  },
  street_lime: {
    id: 'street_lime',
    name: 'LIME STREET',
    tag: 'LIM',
    primary: '#27c96f',
    dark: '#157a43',
    light: '#7bf2aa',
    trim: PALETTE.pureWhite,
    shorts: PALETTE.deepNavy,
    hair: PALETTE.hairDark,
  },
  sunset: {
    id: 'sunset',
    name: 'SUNSET FLARE',
    tag: 'SUN',
    primary: '#ff6b35',
    dark: '#a63612',
    light: '#ffa987',
    trim: PALETTE.gold,
    shorts: PALETTE.deepNavy,
    hair: '#3b2419',
  },
};

export const TEAM_KIT_LIST: TeamKitId[] = [
  'garuda',
  'cyber',
  'tarkam',
  'shadow',
  'street_lime',
  'sunset',
];

export function getTeamKit(id?: TeamKitId, fallbackTeam: Team = 'A'): TeamKitPreset {
  if (id && TEAM_KITS[id]) {
    return TEAM_KITS[id];
  }
  return fallbackTeam === 'A' ? TEAM_KITS.garuda : TEAM_KITS.cyber;
}

export function cycleTeamKit(
  current: TeamKitId,
  otherTeamKit: TeamKitId,
  dir: 1 | -1
): TeamKitId {
  const len = TEAM_KIT_LIST.length;
  const startIdx = Math.max(0, TEAM_KIT_LIST.indexOf(current));
  for (let step = 1; step <= len; step++) {
    const idx = (startIdx + dir * step + len * 2) % len;
    const candidate = TEAM_KIT_LIST[idx];
    if (candidate !== otherTeamKit) {
      return candidate;
    }
  }
  return current;
}
