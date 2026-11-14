import type {
  AIDifficulty,
  ArenaId,
  ControlStyle,
  GameMode,
  MatchDurationOption,
  PitchSize,
  TeamKitId,
} from '../types.js';

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const ROOM_CODE_LENGTH = 4;
export const ROOM_TTL_SECONDS = 180;
export const MAX_CANDIDATES_PER_SIDE = 32;

export type OnlineGameMode =
  | '1v1_local'
  | '2v2_local'
  | '3v3_local'
  | '4v4_local'
  | '2v2_coop'
  | '3v3_coop'
  | '4v4_coop';

export const ONLINE_MODE_OPTIONS: ReadonlyArray<{
  value: OnlineGameMode;
  label: string;
  shortLabel: string;
}> = [
  { value: '1v1_local', label: '1V1 VERSUS (ONLINE)', shortLabel: '1V1 VS' },
  { value: '2v2_local', label: '2V2 VERSUS (ONLINE)', shortLabel: '2V2 VS' },
  { value: '3v3_local', label: '3V3 (GK+2) VERSUS', shortLabel: '3V3 VS' },
  { value: '4v4_local', label: '4V4 (GK+3) VERSUS XL', shortLabel: '4V4 VS' },
  { value: '2v2_coop', label: '2V2 CO-OP VS AI', shortLabel: '2V2 CO-OP' },
  { value: '3v3_coop', label: '3V3 CO-OP VS AI', shortLabel: '3V3 CO-OP' },
  { value: '4v4_coop', label: '4V4 CO-OP VS AI XL', shortLabel: '4V4 CO-OP' },
];

export interface OnlineRoomConfig {
  mode: OnlineGameMode;
  arena: ArenaId;
  pitchSize: PitchSize;
  controlStyle: ControlStyle;
  teamAKit: TeamKitId;
  teamBKit: TeamKitId;
  difficulty: AIDifficulty;
  durationSeconds: MatchDurationOption;
  mutatorsEnabled: boolean;
}

export interface SessionDescriptionDTO {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface IceCandidateDTO {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export interface RoomRecord {
  code: string;
  hostSecret: string;
  createdAt: number;
  config: OnlineRoomConfig;
  hostOffer: SessionDescriptionDTO;
  hostCandidates: IceCandidateDTO[];
  guestAnswer: SessionDescriptionDTO | null;
  guestCandidates: IceCandidateDTO[];
}

export interface PublicRoomState {
  code: string;
  createdAt: number;
  config: OnlineRoomConfig;
  hostOffer: SessionDescriptionDTO;
  hostCandidates: IceCandidateDTO[];
  guestAnswer: SessionDescriptionDTO | null;
  guestCandidates: IceCandidateDTO[];
}

export type SignalingActionPayload =
  | {
      action: 'create';
      config: OnlineRoomConfig;
      hostOffer: SessionDescriptionDTO;
      hostCandidates?: IceCandidateDTO[];
    }
  | {
      action: 'join';
      code: string;
      guestAnswer: SessionDescriptionDTO;
      guestCandidates?: IceCandidateDTO[];
    }
  | {
      action: 'candidate';
      code: string;
      role: 'host' | 'guest';
      candidate: IceCandidateDTO;
    }
  | {
      action: 'close';
      code: string;
      hostSecret: string;
    };

/** Normalizes user-entered room codes into valid uppercase 4-char codes. */
export function sanitizeRoomCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH);
}

/** Checks whether a normalized code matches our unambiguous 4-character alphabet. */
export function isValidRoomCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LENGTH) return false;
  for (let i = 0; i < code.length; i++) {
    if (!ROOM_CODE_ALPHABET.includes(code[i])) return false;
  }
  return true;
}

/** Generates a random 4-character room code without visually ambiguous characters. */
export function generateRoomCode(rand: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    const idx = Math.floor(rand() * ROOM_CODE_ALPHABET.length) % ROOM_CODE_ALPHABET.length;
    out += ROOM_CODE_ALPHABET[idx];
  }
  return out;
}

/** Maps any menu GameMode to the closest supported Online P2P format. */
export function toOnlineGameMode(mode: GameMode): OnlineGameMode {
  if (mode === '2v2_coop' || mode === '3v3_coop' || mode === '4v4_coop') return mode;
  if (mode === '2v2_ai' || mode === 'derby_cup_2v2' || mode === '2v2_local') return '2v2_local';
  if (mode === '3v3_ai' || mode === 'derby_cup_3v3' || mode === '3v3_local') return '3v3_local';
  if (mode === '4v4_ai' || mode === 'derby_cup_4v4' || mode === '4v4_local') return '4v4_local';
  return '1v1_local';
}

/** Returns true if Guest controls Team A alongside Host instead of opposing Team B. */
export function isOnlineCoopMode(mode: GameMode): boolean {
  return mode === '2v2_coop' || mode === '3v3_coop' || mode === '4v4_coop';
}
