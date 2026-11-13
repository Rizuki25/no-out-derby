import {
  ActiveMutatorInfo,
  ArenaBounds,
  ArenaId,
  Ball,
  GameEvent,
  MatchDurationOption,
  MutatorType,
  PhysicsParams,
  ARENA_CONSTANTS,
} from '../types.ts';
import { createArenaBounds } from '../engine/ArenaGeometry.ts';
import { createDefaultPhysicsParams } from '../engine/PhysicsEngine.ts';

export interface MutatorDefinition {
  type: MutatorType;
  label: string;
  subtitle: string;
  duration: number;
}

export const MUTATOR_CATALOG: Record<MutatorType, MutatorDefinition> = {
  giant_ball: {
    type: 'giant_ball',
    label: 'GIANT BALL!',
    subtitle: '2X BALL SIZE & HEAVY KNOCKBACK',
    duration: 18,
  },
  slippery_pitch: {
    type: 'slippery_pitch',
    label: 'SLIPPERY PITCH!',
    subtitle: 'ICE FLOOR - ZERO GRIP!',
    duration: 18,
  },
  pinball_mode: {
    type: 'pinball_mode',
    label: 'PINBALL MODE!',
    subtitle: '114% WALL BOUNCE BOOST!',
    duration: 18,
  },
  hot_potato: {
    type: 'hot_potato',
    label: 'HOT POTATO!',
    subtitle: 'TOUCH OR BALL EXPLODES IN 6S!',
    duration: 18,
  },
  wide_goals: {
    type: 'wide_goals',
    label: 'WIDE GOALS!',
    subtitle: '1.6X BIGGER GOAL MOUTHS!',
    duration: 18,
  },
  multi_ball: {
    type: 'multi_ball',
    label: 'DOUBLE TROUBLE!',
    subtitle: '2 BALLS ON THE PITCH!',
    duration: 18,
  },
};

export const ALL_MUTATORS: MutatorType[] = [
  'giant_ball',
  'slippery_pitch',
  'pinball_mode',
  'hot_potato',
  'wide_goals',
  'multi_ball',
];

export class MutatorManager {
  private active: ActiveMutatorInfo | null = null;
  private triggerSchedule: number[] = [];
  private triggeredIndices = new Set<number>();
  private usedMutators: MutatorType[] = [];
  private nextBallId = 100;
  private arenaId: ArenaId = 'classic';

  constructor(private readonly rng: () => number = Math.random) {}

  reset(durationSeconds: MatchDurationOption, enabled: boolean, arenaId: ArenaId = 'classic'): void {
    this.active = null;
    this.triggeredIndices.clear();
    this.usedMutators = [];
    this.arenaId = arenaId;
    if (!enabled) {
      this.triggerSchedule = [];
      return;
    }
    if (durationSeconds === 60) {
      this.triggerSchedule = [20, 40];
    } else if (durationSeconds === 120) {
      this.triggerSchedule = [30, 60, 90];
    } else {
      // Standard 90s PRD schedule: second 30 and second 60
      this.triggerSchedule = [30, 60];
    }
  }

  getActive(): ActiveMutatorInfo | null {
    return this.active;
  }

  update(
    dt: number,
    elapsedMatchSeconds: number,
    isGoldenGoal: boolean,
    balls: Ball[],
    params: PhysicsParams,
    bounds: ArenaBounds,
    events: GameEvent[]
  ): ArenaBounds {
    let updatedBounds = bounds;

    // Tick down active mutator (infiniteDuration mutators in Sandbox have durationSeconds >= 9000)
    if (this.active && this.active.durationSeconds < 9000) {
      this.active.remainingSeconds -= dt;
      if (this.active.remainingSeconds <= 0) {
        const endedType = this.active.type;
        this.active = null;
        updatedBounds = this.revertMutatorEffects(endedType, balls, params);
        events.push({ type: 'mutator_end', mutator: endedType });
      }
    }

    // Check trigger timestamps (don't trigger new mutator during Golden Goal unless already running)
    if (!isGoldenGoal && this.triggerSchedule.length > 0) {
      for (let i = 0; i < this.triggerSchedule.length; i++) {
        if (!this.triggeredIndices.has(i) && elapsedMatchSeconds >= this.triggerSchedule[i]) {
          this.triggeredIndices.add(i);
          const nextType = this.pickNextMutator();
          updatedBounds = this.activateMutator(nextType, balls, params, events);
        }
      }
    }

    return updatedBounds;
  }

  activateMutator(
    type: MutatorType,
    balls: Ball[],
    params: PhysicsParams,
    events: GameEvent[],
    infiniteDuration = false
  ): ArenaBounds {
    // Cleanly revert any previous active mutator before applying the new one
    if (this.active) {
      const prev = this.active.type;
      this.revertMutatorEffects(prev, balls, params);
      events.push({ type: 'mutator_end', mutator: prev });
    }

    const def = MUTATOR_CATALOG[type];
    const dur = infiniteDuration ? 9999 : def.duration;
    this.active = {
      type,
      label: def.label,
      subtitle: def.subtitle,
      remainingSeconds: dur,
      durationSeconds: dur,
    };
    this.usedMutators.push(type);

    this.resetPhysicsDefaults(params);

    switch (type) {
      case 'giant_ball': {
        params.ballRadius = ARENA_CONSTANTS.BASE_BALL_RADIUS * 2;
        params.ballMass = 3.5;
        for (const ball of balls) {
          ball.radius = params.ballRadius;
          ball.mass = params.ballMass;
        }
        break;
      }
      case 'slippery_pitch': {
        params.ballFriction = 0.9965;
        params.playerFriction = 0.96;
        break;
      }
      case 'pinball_mode': {
        params.wallRestitution = 1.14;
        params.maxBallSpeed = 445;
        params.pinballActive = true;
        break;
      }
      case 'hot_potato': {
        params.hotPotatoActive = true;
        for (const ball of balls) {
          ball.untouchedTimer = 0;
          ball.hotPotatoBeepAccum = 0;
        }
        break;
      }
      case 'wide_goals': {
        params.goalWidthMultiplier = 1.6;
        break;
      }
      case 'multi_ball': {
        if (balls.length < 2) {
          const b = createArenaBounds(params.goalWidthMultiplier, this.arenaId);
          const angle = (this.rng() - 0.5) * 1.4;
          const dir = this.rng() < 0.5 ? 1 : -1;
          balls.push({
            id: this.nextBallId++,
            x: b.centerX,
            y: b.centerY + (this.rng() < 0.5 ? -24 : 24),
            vx: Math.cos(angle) * 110 * dir,
            vy: Math.sin(angle) * 110,
            z: 18,
            vz: 40,
            radius: params.ballRadius,
            mass: params.ballMass,
            spin: 0,
            rollAngle: 0,
            lastTouchTeam: null,
            lastTouchPlayerId: null,
            lastKickPower: 0,
            untouchedTimer: 0,
            hotPotatoBeepAccum: 0,
            isExtraBall: true,
            carrierId: null,
          });
        }
        break;
      }
    }

    events.push({
      type: 'mutator_start',
      mutator: type,
      label: def.label,
      subtitle: def.subtitle,
    });

    return createArenaBounds(params.goalWidthMultiplier, this.arenaId);
  }

  /**
   * Ensures extra balls are synced after a goal kick-off while Multi-Ball is still active.
   */
  ensureMultiBallOnKickoff(balls: Ball[], params: PhysicsParams, bounds?: ArenaBounds): void {
    if (this.active?.type === 'multi_ball' && balls.length < 2) {
      const b = bounds ?? createArenaBounds(params.goalWidthMultiplier, this.arenaId);
      balls.push({
        id: this.nextBallId++,
        x: b.centerX,
        y: b.centerY + 22,
        vx: -70,
        vy: 35,
        z: 16,
        vz: 30,
        radius: params.ballRadius,
        mass: params.ballMass,
        spin: 0,
        rollAngle: 0,
        lastTouchTeam: null,
        lastTouchPlayerId: null,
        lastKickPower: 0,
        untouchedTimer: 0,
        hotPotatoBeepAccum: 0,
        isExtraBall: true,
        carrierId: null,
      });
      if (balls[0]) {
        balls[0].y = b.centerY - 22;
        balls[0].vx = 70;
        balls[0].vy = -35;
      }
    }
  }

  clearAll(balls: Ball[], params: PhysicsParams): ArenaBounds {
    const prev = this.active?.type ?? null;
    this.active = null;
    if (prev) {
      return this.revertMutatorEffects(prev, balls, params);
    }
    this.resetPhysicsDefaults(params);
    for (const ball of balls) {
      ball.radius = params.ballRadius;
      ball.mass = params.ballMass;
      ball.untouchedTimer = 0;
      ball.hotPotatoBeepAccum = 0;
    }
    return createArenaBounds(1.0, this.arenaId);
  }

  private resetPhysicsDefaults(params: PhysicsParams): PhysicsParams {
    const prevWindX = params.windX;
    const prevWindY = params.windY;
    const prevControlStyle = params.controlStyle;
    const defaults = createDefaultPhysicsParams(this.arenaId);
    Object.assign(params, defaults);
    params.windX = prevWindX;
    params.windY = prevWindY;
    params.controlStyle = prevControlStyle;
    return defaults;
  }

  private revertMutatorEffects(type: MutatorType, balls: Ball[], params: PhysicsParams): ArenaBounds {
    const defaults = this.resetPhysicsDefaults(params);

    if (type === 'giant_ball') {
      for (const ball of balls) {
        ball.radius = defaults.ballRadius;
        ball.mass = defaults.ballMass;
      }
    } else if (type === 'hot_potato') {
      for (const ball of balls) {
        ball.untouchedTimer = 0;
        ball.hotPotatoBeepAccum = 0;
      }
    } else if (type === 'multi_ball' && balls.length > 1) {
      // Keep primary ball (or the one closest to center if primary isn't first)
      const primaryIdx = balls.findIndex((b) => !b.isExtraBall);
      const keep = primaryIdx >= 0 ? balls[primaryIdx] : balls[0];
      balls.length = 0;
      keep.isExtraBall = false;
      balls.push(keep);
    }

    return createArenaBounds(defaults.goalWidthMultiplier, this.arenaId);
  }

  private pickNextMutator(): MutatorType {
    const candidates = ALL_MUTATORS.filter((m) => !this.usedMutators.includes(m));
    const pool = candidates.length > 0 ? candidates : ALL_MUTATORS;
    const idx = Math.floor(this.rng() * pool.length);
    return pool[idx];
  }
}
