import { ARENA_LIST } from '../engine/ArenaPresets.ts';
import { TEAM_KIT_LIST, cycleTeamKit } from '../render/TeamKits.ts';
import {
  AIDifficulty,
  ArenaId,
  ControlStyle,
  GameMode,
  MatchConfig,
  MatchDurationOption,
  MatchStats,
  Team,
  TeamKitId,
} from '../types.ts';

export interface CareerRecordsData {
  matchesPlayed: number;
  wins: number;
  losses: number;
  goalsScored: number;
  mostGoalsInMatch: number;
  bankShots: number;
  oneTimerGoals: number;
  saves: number;
  steals: number;
  topBallSpeed: number;
  cupTrophies: number;
  currentWinStreak: number;
  bestWinStreak: number;
}

export interface CompletedMatchSummary {
  isPracticeSandbox: boolean;
  winner: Team | null;
  scoreA: number;
  stats: MatchStats;
  wonCupTournament?: boolean;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RECORDS_KEY = 'no_out_derby_career_records_v1';
const PREFS_KEY = 'no_out_derby_preferences_v1';

const VALID_MODES = new Set<GameMode>([
  '1v1_ai',
  '2v2_ai',
  '3v3_ai',
  'derby_cup_1v1',
  'derby_cup_2v2',
  'derby_cup_3v3',
  '1v1_local',
  '2v2_local',
  '3v3_local',
  '2v2_coop',
  '3v3_coop',
  'practice_sandbox',
]);
const VALID_ARENAS = new Set<ArenaId>(ARENA_LIST);
const VALID_KITS = new Set<TeamKitId>(TEAM_KIT_LIST);
const VALID_DIFFS = new Set<AIDifficulty>(['rookie', 'pro', 'tarkam']);
const VALID_DURS = new Set<MatchDurationOption>([60, 90, 120]);
const VALID_CTRL = new Set<ControlStyle>(['classic', 'dribble']);

export function createEmptyCareerRecords(): CareerRecordsData {
  return {
    matchesPlayed: 0,
    wins: 0,
    losses: 0,
    goalsScored: 0,
    mostGoalsInMatch: 0,
    bankShots: 0,
    oneTimerGoals: 0,
    saves: 0,
    steals: 0,
    topBallSpeed: 0,
    cupTrophies: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
  };
}

function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

function toSafeCount(val: unknown): number {
  return typeof val === 'number' && Number.isFinite(val) && val >= 0 ? Math.floor(val) : 0;
}

export class CareerRecordsStore {
  private readonly storage: StorageLike | null;
  private records: CareerRecordsData;

  constructor(storage?: StorageLike | null) {
    this.storage = storage === undefined ? getBrowserStorage() : storage;
    this.records = this.loadRecordsFromStorage();
  }

  private loadRecordsFromStorage(): CareerRecordsData {
    const empty = createEmptyCareerRecords();
    if (!this.storage) return empty;
    try {
      const raw = this.storage.getItem(RECORDS_KEY);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as Partial<CareerRecordsData>;
      return {
        matchesPlayed: toSafeCount(parsed.matchesPlayed),
        wins: toSafeCount(parsed.wins),
        losses: toSafeCount(parsed.losses),
        goalsScored: toSafeCount(parsed.goalsScored),
        mostGoalsInMatch: toSafeCount(parsed.mostGoalsInMatch),
        bankShots: toSafeCount(parsed.bankShots),
        oneTimerGoals: toSafeCount(parsed.oneTimerGoals),
        saves: toSafeCount(parsed.saves),
        steals: toSafeCount(parsed.steals),
        topBallSpeed: toSafeCount(parsed.topBallSpeed),
        cupTrophies: toSafeCount(parsed.cupTrophies),
        currentWinStreak: toSafeCount(parsed.currentWinStreak),
        bestWinStreak: toSafeCount(parsed.bestWinStreak),
      };
    } catch {
      return empty;
    }
  }

  private persistRecords(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(RECORDS_KEY, JSON.stringify(this.records));
    } catch {
      // Ignore quota / privacy mode write errors gracefully
    }
  }

  getRecords(): CareerRecordsData {
    return { ...this.records };
  }

  resetRecords(): CareerRecordsData {
    this.records = createEmptyCareerRecords();
    if (this.storage) {
      try {
        this.storage.removeItem(RECORDS_KEY);
      } catch {
        // Ignore removal error
      }
    }
    return this.getRecords();
  }

  recordCompletedMatch(summary: CompletedMatchSummary): CareerRecordsData {
    if (summary.isPracticeSandbox) {
      return this.getRecords();
    }

    this.records.matchesPlayed += 1;
    if (summary.winner === 'A') {
      this.records.wins += 1;
      this.records.currentWinStreak += 1;
      this.records.bestWinStreak = Math.max(
        this.records.bestWinStreak,
        this.records.currentWinStreak
      );
    } else if (summary.winner === 'B') {
      this.records.losses += 1;
      this.records.currentWinStreak = 0;
    }

    const goalsA = Math.max(0, Math.floor(summary.scoreA));
    this.records.goalsScored += goalsA;
    this.records.mostGoalsInMatch = Math.max(this.records.mostGoalsInMatch, goalsA);
    this.records.bankShots += Math.max(0, Math.floor(summary.stats.teamABankShots));
    this.records.oneTimerGoals += Math.max(0, Math.floor(summary.stats.teamAOneTimers));
    this.records.saves += Math.max(0, Math.floor(summary.stats.teamASaves));
    this.records.steals += Math.max(0, Math.floor(summary.stats.teamASteals));
    this.records.topBallSpeed = Math.max(
      this.records.topBallSpeed,
      Math.max(0, Math.round(summary.stats.topBallSpeed))
    );

    if (summary.wonCupTournament) {
      this.records.cupTrophies += 1;
    }

    this.persistRecords();
    return this.getRecords();
  }

  loadPreferences(defaults: MatchConfig): { config: MatchConfig; muted: boolean } {
    const fallbackConfig: MatchConfig = { ...defaults };
    if (!this.storage) return { config: fallbackConfig, muted: false };

    try {
      const raw = this.storage.getItem(PREFS_KEY);
      if (!raw) return { config: fallbackConfig, muted: false };
      const parsed = JSON.parse(raw) as Partial<MatchConfig> & { muted?: boolean };

      const mode = parsed.mode && VALID_MODES.has(parsed.mode) ? parsed.mode : fallbackConfig.mode;
      const arena =
        parsed.arena && VALID_ARENAS.has(parsed.arena) ? parsed.arena : fallbackConfig.arena;
      const controlStyle =
        parsed.controlStyle && VALID_CTRL.has(parsed.controlStyle)
          ? parsed.controlStyle
          : fallbackConfig.controlStyle;
      const difficulty =
        parsed.difficulty && VALID_DIFFS.has(parsed.difficulty)
          ? parsed.difficulty
          : fallbackConfig.difficulty;
      const durationSeconds =
        parsed.durationSeconds && VALID_DURS.has(parsed.durationSeconds)
          ? parsed.durationSeconds
          : fallbackConfig.durationSeconds;
      const teamAKit =
        parsed.teamAKit && VALID_KITS.has(parsed.teamAKit)
          ? parsed.teamAKit
          : fallbackConfig.teamAKit ?? 'garuda';
      let teamBKit =
        parsed.teamBKit && VALID_KITS.has(parsed.teamBKit)
          ? parsed.teamBKit
          : fallbackConfig.teamBKit ?? 'cyber';
      if (teamBKit === teamAKit) {
        teamBKit = cycleTeamKit(teamBKit, teamAKit, 1);
      }

      return {
        config: {
          ...fallbackConfig,
          mode,
          arena,
          controlStyle,
          teamAKit,
          teamBKit,
          difficulty,
          durationSeconds,
          mutatorsEnabled:
            typeof parsed.mutatorsEnabled === 'boolean'
              ? parsed.mutatorsEnabled
              : fallbackConfig.mutatorsEnabled,
        },
        muted: Boolean(parsed.muted),
      };
    } catch {
      return { config: fallbackConfig, muted: false };
    }
  }

  savePreferences(config: MatchConfig, muted: boolean): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        PREFS_KEY,
        JSON.stringify({
          mode: config.mode,
          arena: config.arena,
          controlStyle: config.controlStyle ?? 'dribble',
          teamAKit: config.teamAKit ?? 'garuda',
          teamBKit: config.teamBKit ?? 'cyber',
          difficulty: config.difficulty,
          mutatorsEnabled: config.mutatorsEnabled,
          durationSeconds: config.durationSeconds,
          muted,
        })
      );
    } catch {
      // Ignore write failures
    }
  }
}
