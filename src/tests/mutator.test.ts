import { describe, expect, it } from 'vitest';
import { createArenaBounds } from '../engine/ArenaGeometry.ts';
import { createDefaultPhysicsParams, PhysicsEngine } from '../engine/PhysicsEngine.ts';
import { MutatorManager } from '../game/MutatorManager.ts';
import { ARENA_CONSTANTS, Ball, FIXED_DT, GameEvent, MutatorType, Player } from '../types.ts';

function makeBall(): Ball {
  return {
    id: 1,
    x: ARENA_CONSTANTS.CENTER_X,
    y: ARENA_CONSTANTS.CENTER_Y,
    vx: 0,
    vy: 0,
    z: 0,
    vz: 0,
    radius: ARENA_CONSTANTS.BASE_BALL_RADIUS,
    mass: 1,
    spin: 0,
    rollAngle: 0,
    lastTouchTeam: null,
    lastTouchPlayerId: null,
    lastKickPower: 0,
    untouchedTimer: 0,
    hotPotatoBeepAccum: 0,
    isExtraBall: false,
  };
}

describe('MutatorManager', () => {
  it('triggers mutators at 30s and 60s in a 90s match without duplicates', () => {
    const manager = new MutatorManager(() => 0.15);
    manager.reset(90, true);
    const balls = [makeBall()];
    const params = createDefaultPhysicsParams();
    let bounds = createArenaBounds(1.0);
    const events: GameEvent[] = [];

    bounds = manager.update(FIXED_DT, 29.9, false, balls, params, bounds, events);
    expect(manager.getActive()).toBeNull();

    bounds = manager.update(FIXED_DT, 30.0, false, balls, params, bounds, events);
    const first = manager.getActive()?.type;
    expect(first).toBeDefined();

    // Expire first mutator (18s)
    for (let i = 0; i < 18 * 60 + 2; i++) {
      bounds = manager.update(FIXED_DT, 30.0 + (i + 1) * FIXED_DT, false, balls, params, bounds, events);
    }
    expect(manager.getActive()).toBeNull();

    // Advance to 60s
    bounds = manager.update(FIXED_DT, 60.0, false, balls, params, bounds, events);
    const second = manager.getActive()?.type;
    expect(second).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('applies and cleanly reverts every single one of the 6 mutators', () => {
    const allTypes: MutatorType[] = [
      'giant_ball',
      'slippery_pitch',
      'pinball_mode',
      'hot_potato',
      'wide_goals',
      'multi_ball',
    ];
    const manager = new MutatorManager(() => 0.5);

    for (const type of allTypes) {
      manager.reset(90, true);
      const balls = [makeBall()];
      const params = createDefaultPhysicsParams();
      const events: GameEvent[] = [];

      let bounds = manager.activateMutator(type, balls, params, events);
      expect(manager.getActive()?.type).toBe(type);

      if (type === 'giant_ball') {
        expect(balls[0].radius).toBe(ARENA_CONSTANTS.BASE_BALL_RADIUS * 2);
        expect(balls[0].mass).toBeGreaterThan(2);
      } else if (type === 'slippery_pitch') {
        expect(params.playerFriction).toBeGreaterThan(0.94);
      } else if (type === 'pinball_mode') {
        expect(params.wallRestitution).toBeGreaterThan(1.1);
      } else if (type === 'hot_potato') {
        expect(params.hotPotatoActive).toBe(true);
      } else if (type === 'wide_goals') {
        expect(bounds.goalBottomY - bounds.goalTopY).toBeGreaterThan(80);
      } else if (type === 'multi_ball') {
        expect(balls.length).toBe(2);
      }

      // Now expire mutator completely
      for (let i = 0; i < 18 * 60 + 5; i++) {
        bounds = manager.update(FIXED_DT, 31 + i * FIXED_DT, false, balls, params, bounds, events);
      }

      expect(manager.getActive()).toBeNull();
      expect(balls.length).toBe(1);
      expect(balls[0].radius).toBe(ARENA_CONSTANTS.BASE_BALL_RADIUS);
      expect(balls[0].mass).toBe(1.0);
      expect(params.wallRestitution).toBeCloseTo(0.89, 2);
      expect(params.hotPotatoActive).toBe(false);
      expect(bounds.goalBottomY - bounds.goalTopY).toBe(ARENA_CONSTANTS.BASE_GOAL_HALF_HEIGHT * 2);
    }
  });

  it('triggers Hot Potato explosion at 6 seconds untouched and knocks players back', () => {
    const engine = new PhysicsEngine();
    const params = createDefaultPhysicsParams();
    params.hotPotatoActive = true;
    const bounds = createArenaBounds(1.0);
    const ball = makeBall();
    const nearbyPlayer: Player = {
      id: 9,
      team: 'A',
      role: 'outfield',
      humanSlot: 1,
      x: ball.x - 28,
      y: ball.y,
      vx: 0,
      vy: 0,
      radius: ARENA_CONSTANTS.PLAYER_RADIUS,
      facingX: 1,
      facingY: 0,
      isCharging: false,
      chargeTime: 0,
      kickSwingTimer: 0,
      kickSwingPower: 0,
      kickSwingDirX: 1,
      kickSwingDirY: 0,
      dashTimer: 0,
      dashCooldown: 0,
      dashDirX: 1,
      dashDirY: 0,
      stunTimer: 0,
      kickContactCooldown: 0,
      animState: 'idle',
      animTime: 0,
      aiState: 'CHASE_BALL',
      aiDecisionTimer: 0,
      aiTargetX: 0,
      aiTargetY: 0,
      aiWantCharge: false,
      aiChargeTarget: 0,
      aiWantDash: false,
    };

    let boomCount = 0;
    for (let i = 0; i < 6 * 60 + 5; i++) {
      const res = engine.step(FIXED_DT, [ball], [nearbyPlayer], new Map(), bounds, params, true);
      boomCount += res.events.filter((e) => e.type === 'hot_potato_boom').length;
    }

    expect(boomCount).toBe(1);
    expect(nearbyPlayer.vx).toBeLessThan(-80);
    expect(nearbyPlayer.stunTimer).toBeGreaterThan(0);
    expect(Math.hypot(ball.vx, ball.vy)).toBeGreaterThan(100);
  });
});
