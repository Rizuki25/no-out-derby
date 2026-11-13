import { AIDifficulty, ArenaId, PerkType, TeamModifiers } from '../types.ts';

export interface PerkDefinition {
  type: PerkType;
  name: string;
  shortDesc: string;
}

export const PERK_CATALOG: Record<PerkType, PerkDefinition> = {
  turbo_boots: {
    type: 'turbo_boots',
    name: 'TURBO BOOTS',
    shortDesc: '+15% MOVE SPEED',
  },
  iron_leg: {
    type: 'iron_leg',
    name: 'IRON LEG',
    shortDesc: '+18% SHOT POWER',
  },
  quick_dash: {
    type: 'quick_dash',
    name: 'QUICK DASH',
    shortDesc: '-25% DASH COOLDOWN',
  },
  banana_curve: {
    type: 'banana_curve',
    name: 'BANANA CURVE',
    shortDesc: '+65% CURVE SPIN',
  },
  steel_body: {
    type: 'steel_body',
    name: 'STEEL BODY',
    shortDesc: '-50% STUN DURATION',
  },
  magnet_touch: {
    type: 'magnet_touch',
    name: 'MAGNET TOUCH',
    shortDesc: '+3PX KICK REACH',
  },
};

const ALL_PERKS: PerkType[] = [
  'turbo_boots',
  'iron_leg',
  'quick_dash',
  'banana_curve',
  'steel_body',
  'magnet_touch',
];

export interface CupRoundConfig {
  roundNumber: 1 | 2 | 3;
  title: string;
  opponentName: string;
  difficulty: AIDifficulty;
  arena: ArenaId;
}

export const CUP_ROUNDS: CupRoundConfig[] = [
  {
    roundNumber: 1,
    title: 'QUARTER FINAL',
    opponentName: 'VILLAGE FC',
    difficulty: 'rookie',
    arena: 'classic',
  },
  {
    roundNumber: 2,
    title: 'SEMI FINAL',
    opponentName: 'ALLEY SHARKS',
    difficulty: 'pro',
    arena: 'concrete',
  },
  {
    roundNumber: 3,
    title: 'GRAND FINAL',
    opponentName: 'SKYLINE LEGENDS',
    difficulty: 'tarkam',
    arena: 'rooftop',
  },
];

export function createDefaultTeamModifiers(): TeamModifiers {
  return {
    moveSpeedMult: 1.0,
    shotPowerMult: 1.0,
    dashCooldownMult: 1.0,
    spinMult: 1.0,
    stunMult: 1.0,
    kickReachBonus: 0,
  };
}

export function computeModifiersFromPerks(perks: PerkType[]): TeamModifiers {
  const mod = createDefaultTeamModifiers();
  for (const perk of perks) {
    switch (perk) {
      case 'turbo_boots':
        mod.moveSpeedMult *= 1.15;
        break;
      case 'iron_leg':
        mod.shotPowerMult *= 1.18;
        break;
      case 'quick_dash':
        mod.dashCooldownMult *= 0.75;
        break;
      case 'banana_curve':
        mod.spinMult *= 1.65;
        break;
      case 'steel_body':
        mod.stunMult *= 0.5;
        break;
      case 'magnet_touch':
        mod.kickReachBonus += 3.0;
        break;
    }
  }
  return mod;
}

export class DerbyCupState {
  public active = false;
  public is2v2 = false;
  public currentRoundIndex = 0; // 0, 1, 2
  public earnedPerks: PerkType[] = [];
  public perkChoices: PerkType[] = [];
  public totalGoalsScored = 0;
  public totalGoalsConceded = 0;

  constructor(private readonly rng: () => number = Math.random) {}

  startNewCup(is2v2: boolean): CupRoundConfig {
    this.active = true;
    this.is2v2 = is2v2;
    this.currentRoundIndex = 0;
    this.earnedPerks = [];
    this.perkChoices = [];
    this.totalGoalsScored = 0;
    this.totalGoalsConceded = 0;
    return this.getCurrentRound();
  }

  reset(): void {
    this.active = false;
    this.currentRoundIndex = 0;
    this.earnedPerks = [];
    this.perkChoices = [];
    this.totalGoalsScored = 0;
    this.totalGoalsConceded = 0;
  }

  getCurrentRound(): CupRoundConfig {
    return CUP_ROUNDS[Math.min(CUP_ROUNDS.length - 1, this.currentRoundIndex)];
  }

  isFinalRound(): boolean {
    return this.currentRoundIndex >= CUP_ROUNDS.length - 1;
  }

  getTeamAModifiers(): TeamModifiers {
    return computeModifiersFromPerks(this.earnedPerks);
  }

  recordRoundScore(goalsFor: number, goalsAgainst: number): void {
    this.totalGoalsScored += goalsFor;
    this.totalGoalsConceded += goalsAgainst;
  }

  preparePerkOffer(): PerkType[] {
    const available = ALL_PERKS.filter((p) => !this.earnedPerks.includes(p));
    const pool = available.length >= 3 ? [...available] : [...ALL_PERKS];
    const picked: PerkType[] = [];
    while (picked.length < 3 && pool.length > 0) {
      const idx = Math.floor(this.rng() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    this.perkChoices = picked;
    return this.perkChoices;
  }

  selectPerkAndAdvance(choiceIndex: number): CupRoundConfig {
    const perk = this.perkChoices[choiceIndex] ?? this.perkChoices[0];
    if (perk) {
      this.earnedPerks.push(perk);
    }
    this.perkChoices = [];
    this.currentRoundIndex = Math.min(CUP_ROUNDS.length - 1, this.currentRoundIndex + 1);
    return this.getCurrentRound();
  }
}
