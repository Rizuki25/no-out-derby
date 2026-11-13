export const NATIVE_WIDTH = 480;
export const NATIVE_HEIGHT = 270;

export const FIXED_DT = 1 / 60;
export const PHYSICS_SUBSTEPS = 4;

export type Team = 'A' | 'B';

export type ArenaId = 'classic' | 'concrete' | 'rooftop';
export type ControlStyle = 'classic' | 'dribble';
export type TeamKitId = 'garuda' | 'cyber' | 'tarkam' | 'shadow' | 'street_lime' | 'sunset';

export type GameMode =
  | '1v1_ai'
  | '2v2_ai'
  | '3v3_ai'
  | 'derby_cup_1v1'
  | 'derby_cup_2v2'
  | 'derby_cup_3v3'
  | '1v1_local'
  | '2v2_local'
  | '3v3_local'
  | '2v2_coop'
  | '3v3_coop'
  | 'practice_sandbox';
export type AIDifficulty = 'rookie' | 'pro' | 'tarkam';
export type MatchDurationOption = 60 | 90 | 120;

export type PerkType =
  | 'turbo_boots'
  | 'iron_leg'
  | 'quick_dash'
  | 'banana_curve'
  | 'steel_body'
  | 'magnet_touch';

export interface TeamModifiers {
  moveSpeedMult: number;
  shotPowerMult: number;
  dashCooldownMult: number;
  spinMult: number;
  stunMult: number;
  kickReachBonus: number;
}

export type MutatorType =
  | 'giant_ball'
  | 'slippery_pitch'
  | 'pinball_mode'
  | 'hot_potato'
  | 'wide_goals'
  | 'multi_ball';

export type PlayerAnimState = 'idle' | 'run' | 'kick' | 'dash' | 'stun';

export type AIState = 'CHASE_BALL' | 'ALIGN_SHOT' | 'DEFEND_GOAL' | 'RECOVER';

export interface Vec2 {
  x: number;
  y: number;
}

export interface ArenaBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
  chamfer: number;
  centerX: number;
  centerY: number;
  goalTopY: number;
  goalBottomY: number;
  goalDepth: number;
  postRadius: number;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  z: number;
  vz: number;
  radius: number;
  mass: number;
  spin: number;
  rollAngle: number;
  lastTouchTeam: Team | null;
  lastTouchPlayerId: number | null;
  lastKickPower: number;
  /** Seconds elapsed since last player touch/kick (used by Hot Potato) */
  untouchedTimer: number;
  /** Seconds between tick warning beeps during Hot Potato */
  hotPotatoBeepAccum: number;
  isExtraBall: boolean;
  /** Player ID currently dribbling/carrying this ball in Dribble mode */
  carrierId?: number | null;
  /** Brief boosted speed & trail window after a One-Timer volley */
  oneTimerTimer?: number;
}

export interface Player {
  id: number;
  team: Team;
  role: 'outfield' | 'keeper';
  /** 1 for Player 1, 2 for Player 2, null for AI */
  humanSlot: 1 | 2 | null;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  facingX: number;
  facingY: number;
  isCharging: boolean;
  chargeTime: number;
  /** Active kick swing window after releasing button (gives forgiving responsive kicks) */
  kickSwingTimer: number;
  kickSwingPower: number;
  kickSwingDirX: number;
  kickSwingDirY: number;
  dashTimer: number;
  dashCooldown: number;
  dashDirX: number;
  dashDirY: number;
  stunTimer: number;
  /** Brief cooldown after touching/kicking ball to prevent double impulse in same swing */
  kickContactCooldown: number;
  /** Brief cooldown before re-picking up ball in Dribble mode (after kicking or being tackled) */
  pickupCooldown?: number;
  animState: PlayerAnimState;
  animTime: number;
  aiState: AIState;
  aiDecisionTimer: number;
  aiTargetX: number;
  aiTargetY: number;
  aiWantCharge: boolean;
  aiChargeTarget: number;
  aiWantDash: boolean;
  /** Visual jersey number (1-4) */
  shirtNumber: number;
}

export interface PlayerInput {
  moveX: number;
  moveY: number;
  kickHeld: boolean;
  kickJustReleased: boolean;
  dashJustPressed: boolean;
  switchJustPressed: boolean;
}

export interface MatchConfig {
  mode: GameMode;
  arena: ArenaId;
  controlStyle?: ControlStyle;
  teamAKit?: TeamKitId;
  teamBKit?: TeamKitId;
  difficulty: AIDifficulty;
  durationSeconds: MatchDurationOption;
  mutatorsEnabled: boolean;
  replayEnabled?: boolean;
}

export interface MatchStats {
  teamAShots: number;
  teamBShots: number;
  wallBounces: number;
  tackles: number;
  topBallSpeed: number;
  teamASaves: number;
  teamBSaves: number;
  teamASteals: number;
  teamABankShots: number;
  teamAOneTimers: number;
}

export interface ActiveMutatorInfo {
  type: MutatorType;
  label: string;
  subtitle: string;
  remainingSeconds: number;
  durationSeconds: number;
}

export type MatchPhase =
  | 'MENU'
  | 'KICKOFF'
  | 'PLAYING'
  | 'GOAL_CELEBRATION'
  | 'REPLAY'
  | 'GOLDEN_GOAL_INTRO'
  | 'PAUSED'
  | 'FULL_TIME'
  | 'PERK_SELECT'
  | 'CUP_CHAMPION';

export type GameEvent =
  | {
      type: 'kick';
      x: number;
      y: number;
      power: number;
      curved: boolean;
      playerId: number;
      team: Team;
      isOneTimer?: boolean;
    }
  | { type: 'wall_bounce'; x: number; y: number; speed: number; isPinball: boolean }
  | { type: 'post_clang'; x: number; y: number; speed: number }
  | { type: 'save'; x: number; y: number; team: Team; speed: number }
  | { type: 'dash'; x: number; y: number; team: Team }
  | { type: 'tackle'; x: number; y: number; team: Team; stoleBall?: boolean }
  | { type: 'goal'; scoringTeam: Team; x: number; y: number; isGoldenGoal: boolean; highlightTag?: string }
  | { type: 'hot_potato_tick'; x: number; y: number; urgency: number }
  | { type: 'hot_potato_boom'; x: number; y: number }
  | { type: 'mutator_start'; mutator: MutatorType; label: string; subtitle: string }
  | { type: 'mutator_end'; mutator: MutatorType }
  | { type: 'whistle'; kind: 'kickoff' | 'fulltime' | 'golden_goal' }
  | { type: 'countdown_beep'; final: boolean };

export interface PhysicsParams {
  ballFriction: number;
  wallRestitution: number;
  arenaBaseRestitution: number;
  maxBallSpeed: number;
  ballRadius: number;
  ballMass: number;
  playerAccel: number;
  playerFriction: number;
  playerMaxSpeed: number;
  goalWidthMultiplier: number;
  hotPotatoActive: boolean;
  pinballActive: boolean;
  windX: number;
  windY: number;
  controlStyle?: ControlStyle;
}

export const ARENA_CONSTANTS = {
  LEFT: 36,
  RIGHT: 444,
  TOP: 44,
  BOTTOM: 248,
  CHAMFER: 32,
  CENTER_X: 240,
  CENTER_Y: 146,
  BASE_GOAL_HALF_HEIGHT: 29, // 58 px opening
  GOAL_DEPTH: 18,
  POST_RADIUS: 4.5,
  PLAYER_RADIUS: 7.5,
  KEEPER_RADIUS: 6,
  BASE_BALL_RADIUS: 5,
  MAX_CHARGE_TIME: 0.6,
  DASH_DURATION: 0.17,
  DASH_COOLDOWN: 1.2,
  DASH_SPEED: 255,
  STUN_DURATION: 0.36,
} as const;
